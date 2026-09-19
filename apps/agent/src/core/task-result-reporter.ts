import fs from 'node:fs/promises'
import path from 'node:path'
import type { AgentEnv } from '../config/env'

/**
 * Delivery of task results to the manager.
 *
 * Reporting used to be fire-and-forget: a single fetch, and any failure was
 * logged and dropped. That lost the outcome of work the Agent had already
 * done — the firewall rule was applied, the user was created, but the manager
 * never found out and left the task in 'running' until the stale-task reaper
 * timed it out.
 *
 * Two mechanisms close that gap:
 *  - retry with exponential backoff, for a manager that is briefly unreachable
 *    or restarting,
 *  - a disk spool, so a result survives the Agent itself restarting (or the
 *    host rebooting) mid-delivery.
 *
 * Results are keyed by task id and the manager rejects a second report for the
 * same task, so redelivery is safe.
 *
 * Every timing value here is a constant rather than a setting. These govern an
 * internal recovery mechanism that should simply work; there is no deployment
 * in which an operator needs to retune them, and each setting would be public
 * surface to document and keep compatible forever. Tests inject a temporary
 * `spoolDir` through the options argument instead.
 */

export interface TaskResultReport {
  status: 'success' | 'failed'
  result: Record<string, unknown>
  errorMessage?: string
}

interface SpooledResult extends TaskResultReport {
  taskId: string
  /** When the Agent first tried to deliver this, for operator diagnostics. */
  spooledAt: string
}

export interface ReporterOptions {
  /** Overrides the spool location. Intended for tests. */
  spoolDir?: string
}

/** A report POST is a small request; past this the manager is not answering. */
const REPORT_TIMEOUT_MS = 15_000

/** Delays double from here: 1s, 2s, 4s. */
const BASE_RETRY_DELAY_MS = 1_000

/** Attempts before a result is written to the spool. */
const MAX_ATTEMPTS = 4

/** How often spooled results are retried. */
const FLUSH_INTERVAL_MS = 60_000

/**
 * Cap on spooled results, so a manager that stays unreachable for a long time
 * cannot fill the node's disk. Oldest entries are dropped first — they are the
 * ones most likely to have already been reaped and superseded on the manager.
 */
const MAX_SPOOLED_RESULTS = 1_000

/**
 * Agent state lives outside the install directory so an upgrade that replaces
 * /opt/vpn-agent cannot discard undelivered results.
 */
const SPOOL_DIR = '/var/lib/vpn-agent/task-results'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolveSpoolDir(options?: ReporterOptions): string {
  return path.resolve(options?.spoolDir ?? SPOOL_DIR)
}

function spoolPath(dir: string, taskId: string): string {
  // Task ids are UUIDv7, so filenames sort chronologically.
  return path.join(dir, `${taskId}.json`)
}

/**
 * Guards against a task id turning into a path traversal. Ids come from the
 * manager, but a spool filename is used to build a path and read back later.
 */
function isSafeTaskId(taskId: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(taskId)
}

/** True when the manager's answer means retrying can never succeed. */
function isTerminalStatus(status: number): boolean {
  // 408 and 429 are 4xx but explicitly transient.
  if (status === 408 || status === 429) return false
  // 404 (task deleted), 403 (not our task), 409 (already finalised — usually by
  // the stale-task reaper) are all final. Re-sending forever cannot fix them.
  return status >= 400 && status < 500
}

interface DeliveryOutcome {
  delivered: boolean
  /** Retrying is pointless; drop the result instead of spooling it. */
  terminal: boolean
  detail?: string
}

async function deliver(
  env: AgentEnv,
  taskId: string,
  report: TaskResultReport,
): Promise<DeliveryOutcome> {
  try {
    const response = await fetch(`${env.AGENT_MANAGER_URL}/api/v1/tasks/${taskId}/result`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.AGENT_SECRET_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: report.status,
        result: report.result,
        errorMessage: report.errorMessage,
      }),
      // Without this a half-open connection blocks delivery indefinitely.
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    })

    if (response.ok) return { delivered: true, terminal: false }

    const body = await response.text().catch(() => '')
    return {
      delivered: false,
      terminal: isTerminalStatus(response.status),
      detail: `HTTP ${response.status} - ${body}`,
    }
  } catch (err) {
    // Network error, DNS failure, or our own timeout: all retryable.
    return { delivered: false, terminal: false, detail: (err as Error).message }
  }
}

/** Persist a result so it survives an Agent restart. */
async function spool(dir: string, taskId: string, report: TaskResultReport): Promise<void> {
  if (!isSafeTaskId(taskId)) {
    console.error(`[reporter] Refusing to spool result for malformed task id: ${taskId}`)
    return
  }

  const entry: SpooledResult = { taskId, spooledAt: new Date().toISOString(), ...report }
  const target = spoolPath(dir, taskId)
  const temp = `${target}.tmp`

  try {
    await fs.mkdir(dir, { recursive: true })
    // Write-then-rename: a crash mid-write must not leave a half-written entry
    // that fails to parse on the next flush.
    await fs.writeFile(temp, JSON.stringify(entry), { mode: 0o600 })
    await fs.rename(temp, target)
    console.warn(`[reporter] Spooled result for task ${taskId} to ${target} for later delivery`)
    await pruneSpool(dir)
  } catch (err) {
    // Nothing further we can do; the manager's reaper will eventually time the
    // task out and an operator can retry it.
    console.error(`[reporter] Failed to spool result for task ${taskId}: ${(err as Error).message}`)
  }
}

async function listSpooled(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir)
    // UUIDv7 filenames sort chronologically, so this is oldest-first.
    return entries.filter((name) => name.endsWith('.json')).sort()
  } catch {
    // No spool directory means nothing pending.
    return []
  }
}

async function pruneSpool(dir: string): Promise<void> {
  const files = await listSpooled(dir)
  if (files.length <= MAX_SPOOLED_RESULTS) return

  const excess = files.slice(0, files.length - MAX_SPOOLED_RESULTS)
  for (const name of excess) {
    await fs.unlink(path.join(dir, name)).catch(() => {})
  }
  console.warn(
    `[reporter] Spool exceeded ${MAX_SPOOLED_RESULTS} entries; dropped ${excess.length} oldest result(s)`,
  )
}

/**
 * Reports a task result, retrying transient failures and spooling to disk if
 * every attempt fails.
 *
 * Never throws: a reporting problem must not break the poll loop.
 */
export async function reportTaskResult(
  env: AgentEnv,
  taskId: string,
  report: TaskResultReport,
  options?: ReporterOptions,
): Promise<boolean> {
  try {
    return await deliverWithRetry(env, taskId, report, resolveSpoolDir(options))
  } catch (err) {
    // Belt and braces. The callers treat this as infallible, so an unexpected
    // fault here must not escape into the poll loop.
    console.error(
      `[reporter] Unexpected error reporting task ${taskId}: ${(err as Error).message}`,
    )
    return false
  }
}

async function deliverWithRetry(
  env: AgentEnv,
  taskId: string,
  report: TaskResultReport,
  dir: string,
): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const outcome = await deliver(env, taskId, report)

    if (outcome.delivered) {
      if (attempt > 1) {
        console.log(`[reporter] ✓ Task ${taskId} result reported on attempt ${attempt}`)
      } else {
        console.log(`[reporter] ✓ Task ${taskId} result reported successfully`)
      }
      // A successful send may be a redelivery of something still spooled.
      await discardSpooled(dir, taskId)
      return true
    }

    if (outcome.terminal) {
      // The manager will never accept this. Most often 409: the reaper already
      // timed the task out. Dropping it is correct — re-sending cannot win.
      console.error(
        `[reporter] Task ${taskId} result rejected permanently, giving up: ${outcome.detail}`,
      )
      await discardSpooled(dir, taskId)
      return false
    }

    if (attempt < MAX_ATTEMPTS) {
      const delay = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1)
      console.warn(
        `[reporter] Task ${taskId} result delivery failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${outcome.detail}. Retrying in ${delay}ms`,
      )
      await sleep(delay)
    } else {
      console.error(
        `[reporter] Task ${taskId} result delivery failed after ${MAX_ATTEMPTS} attempt(s): ${outcome.detail}`,
      )
    }
  }

  await spool(dir, taskId, report)
  return false
}

async function discardSpooled(dir: string, taskId: string): Promise<void> {
  if (!isSafeTaskId(taskId)) return
  await fs.unlink(spoolPath(dir, taskId)).catch(() => {})
}

/**
 * Attempts delivery of every spooled result once.
 *
 * Called at startup — results spooled before a restart are exactly the ones at
 * risk of being lost — and then periodically.
 */
export async function flushSpooledResults(
  env: AgentEnv,
  options?: ReporterOptions,
): Promise<number> {
  const dir = resolveSpoolDir(options)
  const files = await listSpooled(dir)
  if (files.length === 0) return 0

  console.log(`[reporter] Flushing ${files.length} spooled task result(s)`)
  let delivered = 0

  for (const name of files) {
    const file = path.join(dir, name)

    let entry: SpooledResult
    try {
      entry = JSON.parse(await fs.readFile(file, 'utf8')) as SpooledResult
    } catch (err) {
      // Unreadable or corrupt: it can never be delivered, so drop it rather
      // than retrying it forever.
      console.error(`[reporter] Discarding unreadable spooled result ${name}: ${(err as Error).message}`)
      await fs.unlink(file).catch(() => {})
      continue
    }

    const taskId = entry.taskId ?? path.basename(name, '.json')
    const outcome = await deliver(env, taskId, entry)

    if (outcome.delivered) {
      console.log(`[reporter] ✓ Delivered spooled result for task ${taskId}`)
      await fs.unlink(file).catch(() => {})
      delivered++
      continue
    }

    if (outcome.terminal) {
      console.warn(
        `[reporter] Dropping spooled result for task ${taskId}, manager rejected it permanently: ${outcome.detail}`,
      )
      await fs.unlink(file).catch(() => {})
      continue
    }

    // Still unreachable. Leave the rest on disk for the next flush instead of
    // hammering a manager that is evidently down.
    console.warn(
      `[reporter] Manager still unreachable (${outcome.detail}); ${files.length - delivered} result(s) remain spooled`,
    )
    break
  }

  return delivered
}

/**
 * Periodically retries spooled results. Returns a stop handle.
 */
export function startResultFlusher(
  env: AgentEnv,
  options?: ReporterOptions,
): { stop: () => void } {
  void flushSpooledResults(env, options).catch(() => undefined)

  const timer = setInterval(() => {
    void flushSpooledResults(env, options).catch(() => undefined)
  }, FLUSH_INTERVAL_MS)

  // Never hold the process open for this.
  if (timer.unref) timer.unref()

  return {
    stop: () => clearInterval(timer),
  }
}

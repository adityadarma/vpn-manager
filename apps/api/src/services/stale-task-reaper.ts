import type { Knex } from 'knex'

/**
 * Finalises tasks that were claimed by an agent but never reported back.
 *
 * `claimPendingTasks` flips a task to 'running' the moment an agent polls for
 * it. Nothing moves it out of that state except the agent's own result report
 * (POST /tasks/:id/result). So any agent that dies, restarts, or fails to
 * deliver its report leaves the task 'running' forever: `completed_at` stays
 * null, the UI shows no duration, and the retry endpoint refuses it because
 * retry only accepts 'failed'.
 *
 * This sweeper closes that gap by marking sufficiently old 'running' tasks as
 * 'failed' with an explicit timeout message, which also makes them retryable.
 *
 * Note this is a liveness guess, not a fact: the agent may have applied the
 * change successfully and only lost the report. The error message says so
 * rather than claiming the work did not happen. Every task action is written to
 * be idempotent, so a retry after a false timeout is safe.
 */
export class StaleTaskReaper {
  private db: Knex
  private intervalId: NodeJS.Timeout | null = null
  private readonly intervalMs: number
  private readonly timeoutMs: number

  constructor(
    db: Knex,
    intervalMs: number = 60_000, // Sweep every 1 minute
    timeoutMs: number = 10 * 60_000, // Give up on a claimed task after 10 minutes
  ) {
    this.db = db
    this.intervalMs = intervalMs
    this.timeoutMs = timeoutMs
  }

  start(): void {
    if (this.intervalId) {
      console.warn('[StaleTaskReaper] Already running')
      return
    }

    console.log(
      `[StaleTaskReaper] Starting (sweep every ${this.intervalMs}ms, task timeout ${this.timeoutMs}ms)`,
    )

    // Sweep once at boot: tasks orphaned by the previous shutdown are exactly
    // the ones most likely to be stuck.
    void this.sweep()

    this.intervalId = setInterval(() => {
      void this.sweep()
    }, this.intervalMs)

    // Never hold the process open for this.
    if (this.intervalId.unref) this.intervalId.unref()
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
      console.log('[StaleTaskReaper] Stopped')
    }
  }

  /** Fail every 'running' task claimed longer ago than the timeout. */
  async sweep(): Promise<number> {
    const cutoff = new Date(Date.now() - this.timeoutMs)

    try {
      const stale = await this.db('tasks')
        .where({ status: 'running' })
        .where(function () {
          // Rows claimed before the started_at column existed, or written by an
          // older API build, have no claim time. Fall back to created_at so they
          // are still reaped rather than living forever.
          this.where('started_at', '<', cutoff).orWhere(function () {
            this.whereNull('started_at').andWhere('created_at', '<', cutoff)
          })
        })
        .select('id', 'node_id', 'action')

      if (stale.length === 0) return 0

      const staleIds = stale.map((task: { id: string }) => task.id)
      const timeoutMinutes = Math.round(this.timeoutMs / 60_000)

      // Re-check status inside the UPDATE. A result report racing this sweep
      // must win: it carries the agent's real outcome, this only carries a
      // guess.
      const reaped = await this.db('tasks')
        .whereIn('id', staleIds)
        .where({ status: 'running' })
        .update({
          status: 'failed',
          error_message:
            `Task timed out after ${timeoutMinutes} minute(s) without a result from the agent. ` +
            `The agent may have applied the change and failed to report it — retry is safe because task actions are idempotent.`,
          completed_at: new Date(),
        })

      if (reaped > 0) {
        console.warn(`[StaleTaskReaper] Timed out ${reaped} stale task(s):`)
        for (const task of stale) {
          console.warn(`  - ${task.action} (${task.id}) on node ${task.node_id}`)
        }
      }
      return reaped
    } catch (err) {
      // Never let a sweep failure take down the process.
      console.error(`[StaleTaskReaper] Sweep failed: ${(err as Error).message}`)
      return 0
    }
  }
}

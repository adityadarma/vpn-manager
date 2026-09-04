import type { Knex } from 'knex'

/**
 * Secret handling for task payloads.
 *
 * Some task payloads necessarily carry a secret: `generate_client_cert` passes
 * the private-key passphrase to the agent, which feeds it to EasyRSA via
 * EASYRSA_PASSOUT. The value cannot simply be omitted — the agent needs it.
 *
 * So it is handled in two ways instead:
 *
 *  1. `stripTaskPayloadSecrets` removes it from the stored row as soon as the
 *     agent reports the task's result, i.e. the moment it is no longer needed.
 *     That bounds how long a cleartext passphrase sits in the database to the
 *     lifetime of the task rather than forever.
 *
 *  2. `redactTaskPayload` masks it on the way out of `GET /tasks`, which used
 *     to return `t.*` and therefore handed the passphrase to any admin.
 */
export const SENSITIVE_TASK_PAYLOAD_FIELDS = ['password'] as const

const REDACTED = '[REDACTED]'

/**
 * Parse a payload column into an object.
 *
 * The column is `json`, which knex returns as a string on SQLite/MySQL but as
 * an already-parsed object on PostgreSQL, so both shapes must be handled.
 */
function parsePayload(payload: unknown): Record<string, unknown> | null {
  if (payload === null || payload === undefined) return null
  if (typeof payload === 'object') return payload as Record<string, unknown>
  if (typeof payload !== 'string') return null
  try {
    const parsed = JSON.parse(payload)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/**
 * Returns the payload with sensitive fields masked, preserving the original
 * representation (string in, string out) so API responses keep their shape.
 */
export function redactTaskPayload<T>(payload: T): T | string {
  const parsed = parsePayload(payload)
  if (!parsed) return payload

  let touched = false
  const out: Record<string, unknown> = { ...parsed }
  for (const field of SENSITIVE_TASK_PAYLOAD_FIELDS) {
    // Only mask when a value is actually present; `undefined`/null carry nothing.
    if (out[field] !== undefined && out[field] !== null) {
      out[field] = REDACTED
      touched = true
    }
  }
  if (!touched) return payload

  return typeof payload === 'string' ? JSON.stringify(out) : (out as unknown as T)
}

/** Applies `redactTaskPayload` to each row's `payload` field. */
export function redactTaskRows<T extends { payload?: unknown }>(rows: T[]): T[] {
  return rows.map((row) =>
    row.payload === undefined ? row : { ...row, payload: redactTaskPayload(row.payload) },
  )
}

/**
 * Permanently drops sensitive fields from a stored task payload.
 *
 * Called once the agent reports a result: at that point the secret has been
 * consumed and keeping it serves no purpose. Best-effort — a failure here must
 * not fail the agent's result report, so the caller logs and continues.
 */
export async function stripTaskPayloadSecrets(db: Knex, taskId: string): Promise<boolean> {
  const task = await db('tasks').where({ id: taskId }).first()
  if (!task) return false

  const parsed = parsePayload(task.payload)
  if (!parsed) return false

  const present = SENSITIVE_TASK_PAYLOAD_FIELDS.filter(
    (f) => parsed[f] !== undefined && parsed[f] !== null,
  )
  if (present.length === 0) return false

  const cleaned: Record<string, unknown> = { ...parsed }
  for (const field of present) delete cleaned[field]

  await db('tasks')
    .where({ id: taskId })
    .update({ payload: JSON.stringify(cleaned) })

  return true
}

import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  // Keep the most recently created active session before enforcing the invariant.
  // Older duplicate rows came from concurrent heartbeat and event-monitor reports.
  await knex.raw(`
    UPDATE vpn_sessions
    SET disconnected_at = CURRENT_TIMESTAMP,
        disconnect_reason = 'duplicate_session_reconciled'
    WHERE id IN (
      SELECT id FROM (
        SELECT id,
          ROW_NUMBER() OVER (
            PARTITION BY node_id, credential_id
            ORDER BY connected_at DESC, id DESC
          ) AS row_number
        FROM vpn_sessions
        WHERE disconnected_at IS NULL AND credential_id IS NOT NULL
      )
      WHERE row_number > 1
    )
  `)

  await knex.raw(`
    CREATE UNIQUE INDEX idx_vpn_sessions_active_credential_node
    ON vpn_sessions (node_id, credential_id)
    WHERE disconnected_at IS NULL AND credential_id IS NOT NULL
  `)
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS idx_vpn_sessions_active_credential_node')
}

import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('vpn_sessions', (table) => {
    table.string('credential_id', 36).nullable()
    table.foreign('credential_id').references('id').inTable('user_node_certificates').onDelete('SET NULL')
    table.index(['credential_id', 'connected_at'], 'idx_vpn_sessions_credential_connected')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('vpn_sessions', (table) => {
    table.dropIndex(['credential_id', 'connected_at'], 'idx_vpn_sessions_credential_connected')
    table.dropForeign(['credential_id'])
    table.dropColumn('credential_id')
  })
}

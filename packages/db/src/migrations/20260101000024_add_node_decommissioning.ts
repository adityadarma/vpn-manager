import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('vpn_nodes', (table) => {
    table.timestamp('decommissioned_at').nullable()
    table.string('decommissioned_by', 36).nullable().references('id').inTable('users').onDelete('SET NULL')
    table.text('decommission_reason').nullable()
    table.timestamp('token_revoked_at').nullable()
    table.index('decommissioned_at')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('vpn_nodes', (table) => {
    table.dropIndex(['decommissioned_at'])
    table.dropColumn('token_revoked_at')
    table.dropColumn('decommission_reason')
    table.dropColumn('decommissioned_by')
    table.dropColumn('decommissioned_at')
  })
}

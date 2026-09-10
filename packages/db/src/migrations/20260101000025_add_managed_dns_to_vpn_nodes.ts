import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('vpn_nodes', (table) => {
    table.boolean('managed_dns_enabled').notNullable().defaultTo(false)
    table.boolean('managed_dns_capable').notNullable().defaultTo(false)
    table.integer('dns_config_revision').notNullable().defaultTo(0)
    table.string('dns_sync_status', 20).notNullable().defaultTo('disabled')
    table.text('dns_last_sync_error').nullable()
    table.timestamp('dns_last_synced_at').nullable()
    table.string('dns_config_hash', 71).nullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('vpn_nodes', (table) => {
    table.dropColumn('managed_dns_enabled')
    table.dropColumn('managed_dns_capable')
    table.dropColumn('dns_config_revision')
    table.dropColumn('dns_sync_status')
    table.dropColumn('dns_last_sync_error')
    table.dropColumn('dns_last_synced_at')
    table.dropColumn('dns_config_hash')
  })
}

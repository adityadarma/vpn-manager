import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('groups', (table) => {
    table.string('id', 36).primary().notNullable()
    table.string('name', 100).notNullable().unique()
    table.string('description', 500).nullable()
    table.string('vpn_subnet', 18).nullable().defaultTo(null).comment('VPN subnet for this group, e.g. 10.8.1.0/24')
    table.timestamps(true, true)
  })

  // Add VPN columns to users table after groups exist (for the foreign key)
  await knex.schema.alterTable('users', (table) => {
    table.string('vpn_ip', 15).nullable().defaultTo(null).comment('Auto-assigned VPN IP')
    table.string('vpn_group_id', 36).nullable().defaultTo(null).comment('Primary group for VPN IP')
    table.foreign('vpn_group_id').references('id').inTable('groups').onDelete('SET NULL')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.dropForeign(['vpn_group_id'])
    table.dropColumn('vpn_ip')
    table.dropColumn('vpn_group_id')
  })
  
  await knex.schema.dropTableIfExists('groups')
}


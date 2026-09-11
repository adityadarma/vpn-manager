import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('groups', (table) => {
    table.dropColumn('vpn_subnet')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('groups', (table) => {
    table.string('vpn_subnet', 18).nullable().defaultTo(null).comment('VPN subnet for this group, e.g. 10.8.1.0/24')
  })
}

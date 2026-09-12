import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('user_node_certificates', (table) => {
    table.timestamp('last_vpn_connect').nullable()
  })

  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('last_vpn_connect')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.timestamp('last_vpn_connect').nullable()
  })

  await knex.schema.alterTable('user_node_certificates', (table) => {
    table.dropColumn('last_vpn_connect')
  })
}

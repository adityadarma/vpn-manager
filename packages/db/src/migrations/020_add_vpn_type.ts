import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('vpn_nodes', (table) => {
    table.string('vpn_type', 20).defaultTo('openvpn').notNullable()
    table.text('public_key').nullable()
    table.integer('endpoint_port').nullable()
    table.text('private_key').nullable()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('vpn_nodes', (table) => {
    table.dropColumn('vpn_type')
    table.dropColumn('public_key')
    table.dropColumn('endpoint_port')
    table.dropColumn('private_key')
  })
}

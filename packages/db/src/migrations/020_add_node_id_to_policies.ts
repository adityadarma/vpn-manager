import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('vpn_policies', (table) => {
    table.string('node_id', 36).nullable()
    table.foreign('node_id').references('id').inTable('vpn_nodes').onDelete('CASCADE')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('vpn_policies', (table) => {
    table.dropForeign(['node_id'])
    table.dropColumn('node_id')
  })
}

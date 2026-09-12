import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('node_networks', (table) => {
    table.string('node_id', 36).notNullable().references('id').inTable('vpn_nodes').onDelete('CASCADE')
    table.string('network_id', 36).notNullable().references('id').inTable('networks').onDelete('CASCADE')
    table.primary(['node_id', 'network_id'])
    table.timestamps(true, true)
    table.index('node_id')
    table.index('network_id')
  })
}

export async function down(knex: Knex): Promise<void> { await knex.schema.dropTableIfExists('node_networks') }

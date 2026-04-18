import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('node_networks', (table) => {
    table.string('node_id', 36).notNullable()
    table.foreign('node_id').references('id').inTable('vpn_nodes').onDelete('CASCADE')
    table.string('network_id', 36).notNullable()
    table.foreign('network_id').references('id').inTable('networks').onDelete('CASCADE')
    table.timestamps(true, true)

    table.primary(['node_id', 'network_id'])
    table.index('node_id')
    table.index('network_id')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('node_networks')
}

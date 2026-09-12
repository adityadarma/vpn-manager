import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('group_networks', (table) => {
    table.string('group_id', 36).notNullable().references('id').inTable('groups').onDelete('CASCADE')
    table.string('network_id', 36).notNullable().references('id').inTable('networks').onDelete('CASCADE')
    table.primary(['group_id', 'network_id'])
    table.timestamps(true, true)
  })
}

export async function down(knex: Knex): Promise<void> { await knex.schema.dropTableIfExists('group_networks') }

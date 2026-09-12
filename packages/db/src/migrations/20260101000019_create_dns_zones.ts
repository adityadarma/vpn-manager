import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('dns_zones', (table) => {
    table.string('id', 36).primary().notNullable()
    table.string('name', 253).notNullable().unique()
    table.string('description', 500).nullable()
    table.boolean('enabled').notNullable().defaultTo(true)
    table.timestamps(true, true)
  })
}

export async function down(knex: Knex): Promise<void> { await knex.schema.dropTableIfExists('dns_zones') }

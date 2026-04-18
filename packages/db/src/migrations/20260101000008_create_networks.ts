import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('networks', (table) => {
    table.string('id', 36).primary().notNullable()
    table.string('name', 100).notNullable()
    table.string('cidr', 50).notNullable().unique()
    table.string('description', 500).nullable()
    table.timestamps(true, true)
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('networks')
}

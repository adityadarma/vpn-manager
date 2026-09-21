import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('notification_channels', (table) => {
    table.string('id', 36).primary().notNullable()
    table.string('name', 100).notNullable()
    table.enu('type', ['slack', 'telegram']).notNullable()
    table.text('config_encrypted').notNullable()
    table.boolean('enabled').notNullable().defaultTo(true)
    table.timestamps(true, true)
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('notification_channels')
}

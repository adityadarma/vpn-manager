import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('notification_channels', (table) => {
    table.enu('minimum_severity', ['warning', 'critical']).notNullable().defaultTo('warning')
    table.json('events').nullable()
    table.boolean('send_resolved').notNullable().defaultTo(true)
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('notification_channels', (table) => {
    table.dropColumns('minimum_severity', 'events', 'send_resolved')
  })
}

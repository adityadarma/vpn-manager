import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('notification_deliveries', (table) => {
    table.string('id', 36).primary().notNullable()
    table
      .string('outbox_id', 36)
      .notNullable()
      .references('id')
      .inTable('notification_outbox')
      .onDelete('CASCADE')
    table
      .string('alert_id', 36)
      .notNullable()
      .references('id')
      .inTable('alerts')
      .onDelete('CASCADE')
    table
      .string('channel_id', 36)
      .notNullable()
      .references('id')
      .inTable('notification_channels')
      .onDelete('CASCADE')
    table.enu('status', ['pending', 'delivered', 'failed']).notNullable().defaultTo('pending')
    table.integer('attempt_count').notNullable().defaultTo(0)
    table.timestamp('next_attempt_at').notNullable().defaultTo(knex.fn.now())
    table.integer('response_status').nullable()
    table.text('error_message').nullable()
    table.timestamp('delivered_at').nullable()
    table.timestamps(true, true)
    table.unique(['outbox_id', 'channel_id'], { indexName: 'uq_delivery_outbox_channel' })
    table.index(['status', 'next_attempt_at'], 'idx_deliveries_retry')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('notification_deliveries')
}

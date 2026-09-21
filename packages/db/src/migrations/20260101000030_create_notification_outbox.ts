import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('notification_outbox', (table) => {
    table.string('id', 36).primary().notNullable()
    table
      .string('alert_id', 36)
      .notNullable()
      .references('id')
      .inTable('alerts')
      .onDelete('CASCADE')
    table.enu('notification_status', ['open', 'resolved']).notNullable()
    table.enu('status', ['pending', 'processed']).notNullable().defaultTo('pending')
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now())
    table.timestamp('processed_at').nullable()
    table.index(['status', 'created_at'], 'idx_notification_outbox_pending')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('notification_outbox')
}

import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('alerts', (table) => {
    table.string('id', 36).primary().notNullable()
    table.string('dedup_key', 255).notNullable()
    table.string('event', 100).notNullable()
    table.enu('severity', ['warning', 'critical']).notNullable()
    table.enu('status', ['open', 'acknowledged', 'resolved']).notNullable().defaultTo('open')
    table.string('resource_type', 50).notNullable()
    table.string('resource_id', 100).notNullable()
    table.string('resource_name', 255).notNullable()
    table.text('summary').notNullable()
    table.json('details').nullable()
    table.integer('occurrence_count').notNullable().defaultTo(1)
    table.timestamp('first_occurred_at').notNullable()
    table.timestamp('last_occurred_at').notNullable()
    table.timestamp('acknowledged_at').nullable()
    table
      .string('acknowledged_by', 36)
      .nullable()
      .references('id')
      .inTable('users')
      .onDelete('SET NULL')
    table.timestamp('resolved_at').nullable()
    table.timestamps(true, true)
    table.unique(['dedup_key'], { indexName: 'uq_alerts_dedup_key' })
    table.index(['status', 'last_occurred_at'], 'idx_alerts_status_last_seen')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('alerts')
}

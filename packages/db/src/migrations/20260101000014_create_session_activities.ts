import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('session_activities', (table) => {
    table.string('id', 36).primary().notNullable()
    table.string('session_id', 36).notNullable()
    table.foreign('session_id').references('id').inTable('vpn_sessions').onDelete('CASCADE')
    table.timestamp('recorded_at').notNullable().defaultTo(knex.fn.now())
    table.bigInteger('bytes_sent_delta').notNullable().defaultTo(0)
    table.bigInteger('bytes_received_delta').notNullable().defaultTo(0)
    table.bigInteger('bytes_sent_total').notNullable().defaultTo(0)
    table.bigInteger('bytes_received_total').notNullable().defaultTo(0)
    table.integer('latency_ms').nullable()
    table.decimal('packet_loss_percent', 5, 2).nullable()
    table.timestamps(true, true)
    
    table.index(['session_id', 'recorded_at'])
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('session_activities')
}

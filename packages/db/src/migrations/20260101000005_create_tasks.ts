import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('tasks', (table) => {
    table.string('id', 36).primary().notNullable()
    table.string('node_id', 36).notNullable()
    table.foreign('node_id').references('id').inTable('vpn_nodes').onDelete('CASCADE')
    table.string('action', 100).notNullable()
    table.json('payload').notNullable()
    table.enu('status', ['pending', 'running', 'done', 'failed']).notNullable().defaultTo('pending')
    table.json('result').nullable()
    table.text('error_message').nullable()
    table.timestamp('completed_at').nullable()
    table.timestamps(true, true)
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('tasks')
}

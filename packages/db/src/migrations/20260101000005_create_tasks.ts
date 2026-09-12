import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('tasks', (table) => {
    table.string('id', 36).primary().notNullable()
    table.string('node_id', 36).notNullable().references('id').inTable('vpn_nodes').onDelete('CASCADE')
    table.string('action', 100).notNullable()
    table.json('payload').notNullable()
    table.enu('status', ['pending', 'running', 'done', 'failed']).notNullable().defaultTo('pending')
    table.json('result').nullable()
    table.text('error_message').nullable()
    table.timestamp('completed_at').nullable()
    table.timestamps(true, true)
    table.index(['node_id', 'status', 'created_at'], 'idx_tasks_node_status_created')
  })
}

export async function down(knex: Knex): Promise<void> { await knex.schema.dropTableIfExists('tasks') }

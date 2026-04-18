import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('connection_attempts', (table) => {
    table.string('id', 36).primary().notNullable()
    table.string('user_id', 36).nullable()
    table.foreign('user_id').references('id').inTable('users').onDelete('SET NULL')
    table.string('node_id', 36).nullable()
    table.foreign('node_id').references('id').inTable('vpn_nodes').onDelete('SET NULL')
    table.string('username', 255).notNullable()
    table.string('real_ip', 45).notNullable()
    table.string('failure_reason', 255).notNullable()
    table.timestamp('attempted_at').notNullable().defaultTo(knex.fn.now())
    table.text('error_details').nullable()
    table.timestamps(true, true)
    
    table.index(['user_id', 'attempted_at'])
    table.index(['real_ip', 'attempted_at'])
    table.index(['attempted_at'])
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('connection_attempts')
}

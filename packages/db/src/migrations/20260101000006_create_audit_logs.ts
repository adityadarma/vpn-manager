import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('audit_logs', (table) => {
    table.string('id', 36).primary().notNullable()
    table.string('user_id', 36).nullable()
    table.foreign('user_id').references('id').inTable('users').onDelete('SET NULL')
    table.string('username', 100).notNullable()
    table.string('action', 100).notNullable()
    table.string('resource_type', 50).notNullable()
    table.string('resource_id', 36).nullable()
    table.text('details').nullable()
    table.string('ip_address', 45).nullable()
    table.string('user_agent', 500).nullable()
    table.string('session_id', 36).nullable()
    table.foreign('session_id').references('id').inTable('vpn_sessions').onDelete('SET NULL')
    table.text('metadata').nullable().comment('JSON field for additional context')
    table.timestamps(true, true)
    
    table.index(['user_id'])
    table.index(['action'])
    table.index(['resource_type'])
    table.index(['session_id'])
    table.index(['created_at'])
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('audit_logs')
}

import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('system_settings', (table) => {
    table.string('id', 20).primary().notNullable()
    table.integer('session_retention_days').nullable().defaultTo(90)
    table.integer('task_retention_days').nullable().defaultTo(30)
    table.integer('audit_retention_days').nullable().defaultTo(180)
    table.integer('alert_retention_days').nullable().defaultTo(90)
    table.integer('delivery_retention_days').nullable().defaultTo(30)
    table.integer('dns_revision_retention_days').nullable().defaultTo(90)
    table.timestamp('last_cleanup_at').nullable()
    table.json('last_cleanup_result').nullable()
    table.string('updated_by', 36).nullable().references('id').inTable('users').onDelete('SET NULL')
    table.timestamps(true, true)
  })
  await knex('system_settings').insert({ id: 'system' })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('system_settings')
}

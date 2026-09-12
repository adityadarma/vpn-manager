import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('node_dns_revisions', (table) => {
    table.string('id', 36).primary().notNullable()
    table.string('node_id', 36).notNullable().references('id').inTable('vpn_nodes').onDelete('CASCADE')
    table.integer('revision').notNullable()
    table.string('config_hash', 71).notNullable()
    table.string('status', 20).notNullable().defaultTo('pending')
    table.string('task_id', 36).nullable().references('id').inTable('tasks').onDelete('SET NULL')
    table.text('error_message').nullable()
    table.timestamp('applied_at').nullable()
    table.timestamps(true, true)
    table.unique(['node_id', 'revision'], { indexName: 'idx_node_dns_revisions_node_revision_unique' })
    table.index(['node_id', 'status', 'created_at'], 'idx_node_dns_revisions_node_status_created')
  })
}

export async function down(knex: Knex): Promise<void> { await knex.schema.dropTableIfExists('node_dns_revisions') }

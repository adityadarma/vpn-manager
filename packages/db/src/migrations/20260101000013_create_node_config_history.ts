import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('node_config_history', (table) => {
    table.string('id', 36).primary().notNullable()
    table.string('node_id', 36).notNullable()
    table.foreign('node_id').references('id').inTable('vpn_nodes').onDelete('CASCADE')
    table.string('changed_by', 36).nullable()
    table.foreign('changed_by').references('id').inTable('users')
    table.text('old_config').nullable().comment('Old configuration (JSON)')
    table.text('new_config').notNullable().comment('New configuration (JSON)')
    table.text('change_summary').nullable().comment('Summary of changes')
    table.timestamps(true, true)
    
    table.index(['node_id', 'changed_by', 'created_at'])
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('node_config_history')
}

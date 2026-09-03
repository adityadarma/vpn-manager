import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('tasks', (table) => {
    // Index for agent polling: WHERE node_id = ? AND status = 'pending' ORDER BY created_at
    table.index(['node_id', 'status', 'created_at'], 'idx_tasks_node_status_created')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('tasks', (table) => {
    table.dropIndex([], 'idx_tasks_node_status_created')
  })
}

import type { Knex } from 'knex'

/**
 * Records when a task was claimed by an agent.
 *
 * Without this there is no way to tell a task that started 10 seconds ago from
 * one whose agent died an hour ago: `created_at` only says when the task was
 * enqueued, which can be long before it is claimed. The stale-task reaper needs
 * the claim time to decide what has actually timed out.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('tasks', (table) => {
    table.timestamp('started_at').nullable()
    // The reaper scans by (status, started_at) across all nodes.
    table.index(['status', 'started_at'], 'idx_tasks_status_started')
  })

  // Tasks already stuck in 'running' predate this column. Backfill from
  // created_at so the reaper can see and finalise them on its first sweep
  // instead of leaving them orphaned forever.
  await knex('tasks').where({ status: 'running' }).whereNull('started_at').update({
    started_at: knex.ref('created_at'),
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('tasks', (table) => {
    table.dropIndex(['status', 'started_at'], 'idx_tasks_status_started')
    table.dropColumn('started_at')
  })
}

import type { Knex } from 'knex'

export interface AgentTask {
  id: string
  action: string
  payload: Record<string, unknown>
  created_at: Date | string
}

export async function claimPendingTasks(db: Knex, nodeId: string): Promise<AgentTask[]> {
  const hasPendingWork = await db('tasks')
    .where({ node_id: nodeId, status: 'pending' })
    .select('id')
    .first()
  if (!hasPendingWork) return []

  const claimedIds = await db.transaction(async (trx) => {
    const pendingTasks = await trx('tasks')
      .where({ node_id: nodeId, status: 'pending' })
      .orderBy('created_at', 'asc')
      .select('id')
    const ids = pendingTasks.map((task: { id: string }) => task.id)
    if (ids.length === 0) return []

    // `started_at` is what the stale-task reaper measures against. It must be
    // written in the same statement that claims the task, otherwise a crash
    // between the two leaves a 'running' row the reaper cannot age out.
    await trx('tasks')
      .whereIn('id', ids)
      .where({ status: 'pending' })
      .update({ status: 'running', started_at: new Date() })
    return ids
  })

  if (claimedIds.length === 0) return []
  const tasks = await db('tasks')
    .whereIn('id', claimedIds)
    .orderBy('created_at', 'asc')
    .select('id', 'action', 'payload', 'created_at')
  return tasks.map((task: any) => ({
    ...task,
    payload: typeof task.payload === 'string' ? JSON.parse(task.payload) : task.payload,
  }))
}

export async function waitForPendingTasks(
  db: Knex,
  nodeId: string,
  waitMs: number,
): Promise<AgentTask[]> {
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(1_000, deadline - Date.now())))
    const tasks = await claimPendingTasks(db, nodeId)
    if (tasks.length > 0) return tasks
  }
  return []
}

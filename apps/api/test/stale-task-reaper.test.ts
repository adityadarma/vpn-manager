import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildApp } from '../src/app'
import type { FastifyInstance } from 'fastify'
import { v7 as uuidv7 } from 'uuid'
import { StaleTaskReaper } from '../src/services/stale-task-reaper'
import { claimPendingTasks } from '../src/services/task-polling'

/**
 * Nothing except the agent's own result report moves a task out of 'running'.
 * An agent that dies after claiming work therefore used to leave the task in
 * 'running' forever — with no duration in the UI and no way to retry it, since
 * the retry endpoint only accepts 'failed'.
 */
describe('StaleTaskReaper', () => {
  let app: FastifyInstance
  let nodeId: string

  const insertTask = async (
    status: 'pending' | 'running' | 'done' | 'failed',
    ageMs: number,
    { startedAt }: { startedAt?: Date | null } = {},
  ) => {
    const taskId = uuidv7()
    const createdAt = new Date(Date.now() - ageMs)
    await app.db('tasks').insert({
      id: taskId,
      node_id: nodeId,
      action: 'apply_network_policy',
      // Must satisfy the action's schema: the retry endpoint re-validates the
      // stored payload before it will requeue anything.
      payload: JSON.stringify({ policies: [] }),
      status,
      created_at: createdAt,
      started_at: startedAt === undefined ? createdAt : startedAt,
    })
    return taskId
  }

  const taskById = (id: string) => app.db('tasks').where({ id }).first()

  beforeAll(async () => {
    app = await buildApp({
      JWT_SECRET: 'test-secret',
      JWT_EXPIRES_IN: '1h',
      NODE_ENV: 'test',
    } as any)

    await app.db.migrate.latest()
    await app.db.seed.run()

    nodeId = uuidv7()
    await app.db('vpn_nodes').insert({
      id: nodeId,
      hostname: 'reaper-node',
      ip_address: '10.0.9.1',
      port: 1194,
      token: 'reaper-token',
      status: 'online',
    })
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await app.db('tasks').where({ node_id: nodeId }).delete()
  })

  it('fails a running task claimed longer ago than the timeout', async () => {
    const taskId = await insertTask('running', 15 * 60_000)
    const reaper = new StaleTaskReaper(app.db, 60_000, 10 * 60_000)

    expect(await reaper.sweep()).toBe(1)

    const task = await taskById(taskId)
    expect(task.status).toBe('failed')
    expect(task.error_message).toContain('timed out')
    // Without completed_at the UI still renders no duration.
    expect(task.completed_at).not.toBeNull()
  })

  it('leaves a recently claimed task alone', async () => {
    const taskId = await insertTask('running', 30_000)
    const reaper = new StaleTaskReaper(app.db, 60_000, 10 * 60_000)

    expect(await reaper.sweep()).toBe(0)
    expect((await taskById(taskId)).status).toBe('running')
  })

  it('ignores pending tasks regardless of age', async () => {
    // A pending task was never claimed, so it has not timed out — it is just
    // waiting for an offline agent to come back.
    const taskId = await insertTask('pending', 60 * 60_000)
    const reaper = new StaleTaskReaper(app.db, 60_000, 10 * 60_000)

    expect(await reaper.sweep()).toBe(0)
    expect((await taskById(taskId)).status).toBe('pending')
  })

  it('does not touch already-finalised tasks', async () => {
    const done = await insertTask('done', 60 * 60_000)
    const failed = await insertTask('failed', 60 * 60_000)
    const reaper = new StaleTaskReaper(app.db, 60_000, 10 * 60_000)

    expect(await reaper.sweep()).toBe(0)
    expect((await taskById(done)).status).toBe('done')
    expect((await taskById(failed)).status).toBe('failed')
  })

  it('reaps a running task with no started_at using created_at', async () => {
    // Rows claimed by an older API build predate the started_at column. They
    // must still be reapable, otherwise they stay stuck permanently.
    const taskId = await insertTask('running', 20 * 60_000, { startedAt: null })
    const reaper = new StaleTaskReaper(app.db, 60_000, 10 * 60_000)

    expect(await reaper.sweep()).toBe(1)
    expect((await taskById(taskId)).status).toBe('failed')
  })

  it('does not overwrite a result that arrives during the sweep', async () => {
    // The agent's real outcome must win over the reaper's liveness guess.
    const taskId = await insertTask('running', 15 * 60_000)

    const reported = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/result`,
      headers: { Authorization: 'Bearer reaper-token' },
      payload: { status: 'success', result: { count: 3 } },
    })
    expect(reported.statusCode).toBe(200)

    const reaper = new StaleTaskReaper(app.db, 60_000, 10 * 60_000)
    expect(await reaper.sweep()).toBe(0)

    const task = await taskById(taskId)
    expect(task.status).toBe('done')
    expect(task.error_message).toBeNull()
  })

  it('makes a timed-out task retryable', async () => {
    // Retry only accepts 'failed', so reaping is what unblocks recovery.
    const taskId = await insertTask('running', 15 * 60_000)
    await new StaleTaskReaper(app.db, 60_000, 10 * 60_000).sweep()

    const cookie = await (await import('./helpers')).loginAsAdmin(app)
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/retry`,
      headers: { cookie },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().status).toBe('pending')
  })

  it('records started_at when a task is claimed', async () => {
    // The reaper measures against claim time, so the claim must write it.
    const taskId = await insertTask('pending', 0)

    const claimed = await claimPendingTasks(app.db, nodeId)
    expect(claimed.map((t) => t.id)).toContain(taskId)

    const task = await taskById(taskId)
    expect(task.status).toBe('running')
    expect(task.started_at).not.toBeNull()
  })

  it('survives a failing sweep without throwing', async () => {
    // A scheduler that throws on a transient DB error would take down the
    // process, so failures are swallowed and reported as zero.
    const broken = new StaleTaskReaper(
      { ...app.db, } as any,
      60_000,
      10 * 60_000,
    )
    // Force the query builder call to blow up.
    ;(broken as any).db = () => {
      throw new Error('db is down')
    }

    await expect(broken.sweep()).resolves.toBe(0)
  })
})

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import type { FastifyInstance } from 'fastify'
import { v7 as uuidv7 } from 'uuid'

describe('Task Polling & Security', () => {
  let app: FastifyInstance
  let nodeId: string

  beforeAll(async () => {
    app = await buildApp({
      DATABASE_TYPE: 'sqlite',
      DATABASE_SQLITE_PATH: ':memory:',
      JWT_SECRET: 'test-secret',
      JWT_EXPIRES_IN: '1h',
      NODE_ENV: 'test',
    } as any)

    await app.db.migrate.latest()
    await app.db.seed.run()

    nodeId = uuidv7()
    await app.db('vpn_nodes').insert({
      id: nodeId,
      hostname: 'task-poll-node',
      ip_address: '10.0.1.1',
      port: 1194,
      token: 'task-poll-token',
      status: 'online',
    })
  })

  afterAll(async () => {
    await app.close()
  })

  it('should not return already-claimed tasks on a second poll', async () => {
    await app.db('tasks').where({ node_id: nodeId, status: 'pending' }).delete()

    for (let i = 0; i < 3; i++) {
      await app.db('tasks').insert({
        id: uuidv7(),
        node_id: nodeId,
        action: 'test_action',
        payload: JSON.stringify({ test: true }),
        status: 'pending',
        created_at: new Date(),
      })
    }

    const res1 = await app.inject({
      method: 'GET',
      url: `/api/v1/nodes/${nodeId}/tasks`,
      headers: { Authorization: 'Bearer task-poll-token' },
    })
    expect(res1.statusCode).toBe(200)
    expect(res1.json().tasks).toHaveLength(3)

    const res2 = await app.inject({
      method: 'GET',
      url: `/api/v1/nodes/${nodeId}/tasks`,
      headers: { Authorization: 'Bearer task-poll-token' },
    })
    expect(res2.statusCode).toBe(200)
    expect(res2.json().tasks).toHaveLength(0)
  })

  it('should accept task results correctly', async () => {
    const taskId = uuidv7()
    await app.db('tasks').insert({
      id: taskId,
      node_id: nodeId,
      action: 'test_action',
      payload: JSON.stringify({}),
      status: 'running',
      created_at: new Date(),
    })

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/result`,
      headers: { Authorization: 'Bearer task-poll-token' },
      payload: { status: 'success', result: { test: true } },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)

    const task = await app.db('tasks').where({ id: taskId }).first()
    expect(task.status).toBe('done')
  })

  it('should have index on tasks table for efficient polling', async () => {
    const indexes = await app.db.raw("PRAGMA index_list('tasks')")
    const indexNames = indexes.map((i: any) => i.name)
    expect(indexNames).toContain('idx_tasks_node_status_created')
  })

  describe('result reporting is single-shot', () => {
    const insertTask = async (status: 'pending' | 'running') => {
      const taskId = uuidv7()
      await app.db('tasks').insert({
        id: taskId,
        node_id: nodeId,
        action: 'test_action',
        payload: JSON.stringify({}),
        status,
        created_at: new Date(),
      })
      return taskId
    }

    const report = (taskId: string, body: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${taskId}/result`,
        headers: { Authorization: 'Bearer task-poll-token' },
        payload: body,
      })

    it('rejects a second report with 409 and keeps the original result', async () => {
      const taskId = await insertTask('running')

      const first = await report(taskId, { status: 'failed', errorMessage: 'real failure' })
      expect(first.statusCode).toBe(200)

      // A node could otherwise rewrite its own recorded failure as a success.
      const second = await report(taskId, { status: 'success', result: { faked: true } })
      expect(second.statusCode).toBe(409)

      const task = await app.db('tasks').where({ id: taskId }).first()
      expect(task.status).toBe('failed')
      expect(task.error_message).toBe('real failure')
      expect(task.result).not.toContain('faked')
    })

    it('rejects re-reporting a task that already succeeded', async () => {
      const taskId = await insertTask('running')

      expect((await report(taskId, { status: 'success', result: { n: 1 } })).statusCode).toBe(200)
      const second = await report(taskId, { status: 'success', result: { n: 2 } })
      expect(second.statusCode).toBe(409)

      const task = await app.db('tasks').where({ id: taskId }).first()
      expect(JSON.parse(task.result).n).toBe(1)
    })

    it('accepts only one of two concurrent reports', async () => {
      const taskId = await insertTask('running')

      // The status filter is part of the UPDATE, so exactly one of these can
      // match a row even when they interleave.
      const [a, b] = await Promise.all([
        report(taskId, { status: 'success', result: { from: 'a' } }),
        report(taskId, { status: 'success', result: { from: 'b' } }),
      ])

      const codes = [a.statusCode, b.statusCode].sort()
      expect(codes).toEqual([200, 409])
    })

    it('still accepts a first report for a pending task', async () => {
      // Agents normally report after claiming (running), but a pending task
      // must not be rejected as already-finalised.
      const taskId = await insertTask('pending')
      expect((await report(taskId, { status: 'success', result: {} })).statusCode).toBe(200)
    })
  })
})

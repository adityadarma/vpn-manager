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
})

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { v7 as uuidv7 } from 'uuid'
import { buildApp } from '../src/app'
import { NodeStatusChecker } from '../src/services/node-status-checker'

describe('NodeStatusChecker', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({
      JWT_SECRET: 'test-secret',
      JWT_EXPIRES_IN: '1h',
      NODE_ENV: 'test',
    } as any)
    await app.db.migrate.latest()
  })

  afterAll(async () => app.close())

  beforeEach(async () => {
    await app.db('notification_outbox').delete()
    await app.db('alerts').delete()
    await app.db('vpn_nodes').delete()
  })

  const insertNode = async (hostname: string, lastSeen: Date) => {
    const id = uuidv7()
    await app.db('vpn_nodes').insert({
      id,
      hostname,
      ip_address: '10.0.10.1',
      port: 1194,
      token: `token-${id}`,
      status: 'online',
      last_seen: lastSeen,
    })
    return id
  }

  it('marks a node offline after the heartbeat threshold and publishes updates', async () => {
    const nodeId = await insertNode('stale-node', new Date(Date.now() - 61_000))
    const events: string[] = []
    const unsubscribe = app.realtime.subscribe((event) => events.push(event.type))
    const checker = new NodeStatusChecker(app.db, 15_000, 60_000, app.alerts, app.realtime)

    expect(await checker.checkNodeStatus()).toBe(1)
    unsubscribe()

    expect((await app.db('vpn_nodes').where({ id: nodeId }).first()).status).toBe('offline')
    expect(
      await app.db('alerts').where({ resource_id: nodeId, event: 'node.offline' }).first(),
    ).toBeTruthy()
    expect(events).toContain('node.updated')
    expect(events).toContain('alert.updated')
  })

  it('keeps a node online while its heartbeat is within the threshold', async () => {
    const nodeId = await insertNode('fresh-node', new Date(Date.now() - 30_000))
    const checker = new NodeStatusChecker(app.db, 15_000, 60_000, app.alerts, app.realtime)

    expect(await checker.checkNodeStatus()).toBe(0)
    expect((await app.db('vpn_nodes').where({ id: nodeId }).first()).status).toBe('online')
    expect(await app.db('alerts').where({ resource_id: nodeId })).toHaveLength(0)
  })
})

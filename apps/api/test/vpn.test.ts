import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import type { FastifyInstance } from 'fastify'
import { v7 as uuidv7 } from 'uuid'

describe('VPN Agent API', () => {
  let app: FastifyInstance
  let nodeId: string
  
  process.env.VPN_TOKEN = 'agent-secret-token'

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

    // Create a mock node
    nodeId = uuidv7()
    await app.db('vpn_nodes').insert({
      id: nodeId,
      hostname: 'Mock Node',
      ip_address: '1.2.3.4',
      port: 1194,
      token: 'mock-token',
      status: 'online',
    })
  })

  afterAll(async () => {
    await app.close()
    delete process.env.VPN_TOKEN
  })

  it('should block requests without valid X-VPN-Token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/vpn/connect',
      payload: { username: 'admin', vpn_ip: '10.8.0.2', node_id: nodeId }
    })
    expect(res.statusCode).toBe(401)
  })

  it('should record vpn connect event', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/vpn/connect',
      headers: { 'X-VPN-Token': 'agent-secret-token' },
      payload: { 
        username: 'admin', 
        vpn_ip: '10.8.0.2',
        node_id: nodeId
      }
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().session_id).toBeDefined()
  })

  it('should record vpn disconnect event', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/vpn/disconnect',
      headers: { 'X-VPN-Token': 'agent-secret-token' },
      payload: { 
        username: 'admin', 
        node_id: nodeId,
        bytes_sent: 1024,
        bytes_received: 2048
      }
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })
})

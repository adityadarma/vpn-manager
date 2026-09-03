import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import type { FastifyInstance } from 'fastify'
import { v7 as uuidv7 } from 'uuid'

describe('Session Safety', () => {
  let app: FastifyInstance
  let nodeId: string

  process.env.VPN_TOKEN = 'test-vpn-token'

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
      hostname: 'session-safety-node',
      ip_address: '10.0.0.100',
      port: 1194,
      token: 'session-safety-token',
      status: 'online',
      vpn_type: 'openvpn',
    })
  })

  afterAll(async () => {
    await app.close()
    delete process.env.VPN_TOKEN
  })

  it('disconnect should close the oldest open session, not the newest', async () => {
    const userId = uuidv7()
    await app.db('users').insert({
      id: userId,
      username: 'disconnect_order_user',
      role: 'user',
      is_active: true,
      vpn_ip: '10.8.0.50',
    })

    const oldSessionId = uuidv7()
    const newSessionId = uuidv7()

    await app.db('vpn_sessions').insert({
      id: oldSessionId,
      user_id: userId,
      node_id: nodeId,
      vpn_ip: '10.8.0.50',
      connected_at: new Date('2026-01-01T10:00:00Z'),
      bytes_sent: 0,
      bytes_received: 0,
    })

    await app.db('vpn_sessions').insert({
      id: newSessionId,
      user_id: userId,
      node_id: nodeId,
      vpn_ip: '10.8.0.50',
      connected_at: new Date('2026-01-01T11:00:00Z'),
      bytes_sent: 0,
      bytes_received: 0,
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/vpn/disconnect',
      headers: { 'X-VPN-Token': 'test-vpn-token' },
      payload: { username: 'disconnect_order_user', node_id: nodeId, bytes_sent: 1000, bytes_received: 2000 },
    })
    expect(res.statusCode).toBe(200)

    const oldSession = await app.db('vpn_sessions').where({ id: oldSessionId }).first()
    expect(oldSession.disconnected_at).not.toBeNull()

    const newSession = await app.db('vpn_sessions').where({ id: newSessionId }).first()
    expect(newSession.disconnected_at).toBeNull()
  })

  it('connect should close old sessions and create new session atomically', async () => {
    const userId = uuidv7()
    await app.db('users').insert({
      id: userId,
      username: 'connect_txn_user',
      role: 'user',
      is_active: true,
      vpn_ip: '10.8.0.80',
    })

    const oldSessionId = uuidv7()
    await app.db('vpn_sessions').insert({
      id: oldSessionId,
      user_id: userId,
      node_id: nodeId,
      vpn_ip: '10.8.0.80',
      connected_at: new Date('2026-01-01T10:00:00Z'),
      bytes_sent: 0,
      bytes_received: 0,
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/vpn/connect',
      headers: { 'X-VPN-Token': 'test-vpn-token' },
      payload: { username: 'connect_txn_user', vpn_ip: '10.8.0.80', node_id: nodeId },
    })
    expect([200, 201]).toContain(res.statusCode)

    const oldSession = await app.db('vpn_sessions').where({ id: oldSessionId }).first()
    expect(oldSession.disconnected_at).not.toBeNull()
    expect(oldSession.disconnect_reason).toBe('reconnect')

    const newSessions = await app.db('vpn_sessions')
      .where({ user_id: userId, node_id: nodeId })
      .whereNull('disconnected_at')
    expect(newSessions).toHaveLength(1)
    expect(newSessions[0].id).not.toBe(oldSessionId)
  })

  it('heartbeat should not create duplicate session if one already exists', async () => {
    const userId = uuidv7()
    await app.db('users').insert({
      id: userId,
      username: 'hb_dedup_user',
      role: 'user',
      is_active: true,
      vpn_ip: '10.8.0.70',
    })

    const existingSessionId = uuidv7()
    await app.db('vpn_sessions').insert({
      id: existingSessionId,
      user_id: userId,
      node_id: nodeId,
      vpn_ip: '10.8.0.70',
      connected_at: new Date(),
      bytes_sent: 100,
      bytes_received: 200,
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/nodes/heartbeat',
      headers: { Authorization: 'Bearer session-safety-token' },
      payload: {
        nodeId,
        clients: [{
          commonName: 'hb_dedup_user',
          realAddress: '1.2.3.4:12345',
          virtualAddress: '10.8.0.70',
          bytesReceived: 5000,
          bytesSent: 3000,
          connectedSince: new Date().toISOString(),
        }],
      },
    })
    expect(res.statusCode).toBe(200)

    const sessions = await app.db('vpn_sessions')
      .where({ user_id: userId, node_id: nodeId })
      .whereNull('disconnected_at')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe(existingSessionId)
    expect(sessions[0].bytes_received).toBe(5000)
  })
})

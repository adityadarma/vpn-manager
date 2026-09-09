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

  it('keeps sessions for two credentials owned by one user separate', async () => {
    const userId = uuidv7()
    await app.db('users').insert({
      id: userId,
      username: 'multi_device_user',
      email: 'multi@example.com',
      password: 'not-used',
      role: 'user',
      is_active: true,
    })
    const firstCredential = uuidv7()
    const secondCredential = uuidv7()
    await app.db('user_node_certificates').insert([
      {
        id: firstCredential,
        user_id: userId,
        node_id: nodeId,
        credential_name: 'laptop',
        common_name: 'multi_device_laptop',
        vpn_ip: '10.8.0.20',
        client_cert: 'credential-one',
        client_key: 'key-one',
        is_revoked: false,
      },
      {
        id: secondCredential,
        user_id: userId,
        node_id: nodeId,
        credential_name: 'phone',
        common_name: 'multi_device_phone',
        vpn_ip: '10.8.0.21',
        client_cert: 'credential-two',
        client_key: 'key-two',
        is_revoked: false,
      },
    ])

    for (const [commonName, vpnIp] of [
      ['multi_device_laptop', '10.8.0.20'],
      ['multi_device_phone', '10.8.0.21'],
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/vpn/connect',
        headers: { 'X-VPN-Token': 'agent-secret-token' },
        payload: { username: commonName, vpn_ip: vpnIp, node_id: nodeId },
      })
      expect(response.statusCode).toBe(201)
    }

    const sessions = await app.db('vpn_sessions')
      .where({ user_id: userId, node_id: nodeId })
      .whereNull('disconnected_at')
      .orderBy('credential_id')
    expect(sessions).toHaveLength(2)
    expect(sessions.map((session: any) => session.credential_id)).toEqual([firstCredential, secondCredential].sort())
  })

  describe('X-VPN-Token validation', () => {
    const connect = (headers: Record<string, string>) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/vpn/connect',
        headers,
        payload: { username: 'admin', vpn_ip: '10.8.0.9', node_id: nodeId },
      })

    it('rejects a wrong token of the same length', async () => {
      // Same length as the real token, so only the content differs.
      const res = await connect({ 'X-VPN-Token': 'agent-secret-tokeX' })
      expect(res.statusCode).toBe(401)
    })

    it('rejects a token that is a prefix of the real one', async () => {
      const res = await connect({ 'X-VPN-Token': 'agent-secret' })
      expect(res.statusCode).toBe(401)
    })

    it('rejects a token with the real one as a prefix', async () => {
      const res = await connect({ 'X-VPN-Token': 'agent-secret-token-extra' })
      expect(res.statusCode).toBe(401)
    })

    it('rejects an empty token', async () => {
      const res = await connect({ 'X-VPN-Token': '' })
      expect(res.statusCode).toBe(401)
    })

    it('accepts a token with surrounding whitespace', async () => {
      // Operators paste this into env files and shell variables, where a
      // trailing newline is easy to introduce.
      const res = await connect({ 'X-VPN-Token': '  agent-secret-token\n' })
      expect(res.statusCode).toBe(201)
    })
  })
})

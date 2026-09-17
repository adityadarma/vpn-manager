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

  it('disconnect should only close the matching credential session', async () => {
    const userId = uuidv7()
    // VPN identity is credential-scoped: users.vpn_ip no longer exists.
    await app.db('users').insert({
      id: userId,
      name: 'Disconnect Order User',
      role: 'user',
      is_active: true,
    })
    const credentialId = uuidv7()
    await app.db('user_node_certificates').insert({
      id: credentialId,
      user_id: userId,
      node_id: nodeId,
      credential_name: 'default',
      common_name: 'disconnect_order_user',
      vpn_ip: '10.8.0.50',
      is_revoked: false,
    })

    // /vpn/disconnect resolves the credential by common_name and only
    // targets sessions of that same credential_id.
    const oldSessionId = uuidv7()
    const otherCredentialId = uuidv7()
    const newSessionId = uuidv7()

    await app.db('user_node_certificates').insert({
      id: otherCredentialId,
      user_id: userId,
      node_id: nodeId,
      credential_name: 'other-device',
      common_name: 'disconnect_order_user_other',
      vpn_ip: '10.8.0.51',
      is_revoked: false,
    })

    await app.db('vpn_sessions').insert({
      id: oldSessionId,
      user_id: userId,
      node_id: nodeId,
      credential_id: otherCredentialId,
      vpn_ip: '10.8.0.51',
      connected_at: new Date('2026-01-01T10:00:00Z'),
      bytes_sent: 0,
      bytes_received: 0,
    })

    await app.db('vpn_sessions').insert({
      id: newSessionId,
      user_id: userId,
      node_id: nodeId,
      credential_id: credentialId,
      vpn_ip: '10.8.0.50',
      connected_at: new Date('2026-01-01T11:00:00Z'),
      bytes_sent: 0,
      bytes_received: 0,
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/vpn/disconnect',
      headers: { 'X-VPN-Token': 'test-vpn-token' },
      payload: {
        username: 'disconnect_order_user',
        node_id: nodeId,
        bytes_sent: 1000,
        bytes_received: 2000,
      },
    })
    expect(res.statusCode).toBe(200)

    const oldSession = await app.db('vpn_sessions').where({ id: oldSessionId }).first()
    expect(oldSession.disconnected_at).toBeNull()

    const newSession = await app.db('vpn_sessions').where({ id: newSessionId }).first()
    expect(newSession.disconnected_at).not.toBeNull()
  })

  it('connect should close an older session and create a new session atomically', async () => {
    const userId = uuidv7()
    await app.db('users').insert({
      id: userId,
      name: 'Connect Transaction User',
      role: 'user',
      is_active: true,
    })
    const credentialId = uuidv7()
    await app.db('user_node_certificates').insert({
      id: credentialId,
      user_id: userId,
      node_id: nodeId,
      credential_name: 'default',
      common_name: 'connect_txn_user',
      vpn_ip: '10.8.0.80',
      is_revoked: false,
    })

    // Reconnect only replaces the previous session of the *same* credential,
    // so the old session must carry credential_id like a real one would.
    const oldSessionId = uuidv7()
    await app.db('vpn_sessions').insert({
      id: oldSessionId,
      user_id: userId,
      node_id: nodeId,
      credential_id: credentialId,
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

    const newSessions = await app
      .db('vpn_sessions')
      .where({ user_id: userId, node_id: nodeId })
      .whereNull('disconnected_at')
    expect(newSessions).toHaveLength(1)
    expect(newSessions[0].id).not.toBe(oldSessionId)
  })

  it('heartbeat should not create duplicate session if one already exists', async () => {
    const userId = uuidv7()
    await app.db('users').insert({
      id: userId,
      name: 'Heartbeat Dedup User',
      role: 'user',
      is_active: true,
    })
    const credentialId = uuidv7()
    await app.db('user_node_certificates').insert({
      id: credentialId,
      user_id: userId,
      node_id: nodeId,
      credential_name: 'default',
      common_name: 'hb_dedup_user',
      vpn_ip: '10.8.0.70',
      is_revoked: false,
    })

    const existingSessionId = uuidv7()
    await app.db('vpn_sessions').insert({
      id: existingSessionId,
      user_id: userId,
      node_id: nodeId,
      credential_id: credentialId,
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
        clients: [
          {
            commonName: 'hb_dedup_user',
            realAddress: '1.2.3.4:12345',
            virtualAddress: '10.8.0.70',
            bytesReceived: 5000,
            bytesSent: 3000,
            connectedSince: new Date().toISOString(),
          },
        ],
      },
    })
    expect(res.statusCode).toBe(200)

    const sessions = await app
      .db('vpn_sessions')
      .where({ user_id: userId, node_id: nodeId })
      .whereNull('disconnected_at')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe(existingSessionId)
    expect(sessions[0].bytes_received).toBe(5000)
  })

  it('connect should merge a delayed event-monitor report for the same connection', async () => {
    const userId = uuidv7()
    const credentialId = uuidv7()
    const connectedAt = new Date('2026-09-17T12:15:16.000Z')
    await app
      .db('users')
      .insert({ id: userId, name: 'Connect Dedup User', role: 'user', is_active: true })
    await app.db('user_node_certificates').insert({
      id: credentialId,
      user_id: userId,
      node_id: nodeId,
      credential_name: 'HP',
      common_name: 'connect_dedup_user',
      vpn_ip: '10.8.0.90',
      is_revoked: false,
    })

    const heartbeatSessionId = uuidv7()
    await app.db('vpn_sessions').insert({
      id: heartbeatSessionId,
      user_id: userId,
      node_id: nodeId,
      credential_id: credentialId,
      vpn_ip: '10.8.0.90',
      connected_at: connectedAt,
      bytes_sent: 100,
      bytes_received: 200,
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/vpn/connect',
      headers: { 'X-VPN-Token': 'test-vpn-token' },
      payload: {
        username: 'connect_dedup_user',
        vpn_ip: '10.8.0.90',
        node_id: nodeId,
        real_ip: '114.10.156.59',
        device_name: 'HP',
        connected_at: connectedAt.toISOString(),
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ session_id: heartbeatSessionId, deduplicated: true })
    const sessions = await app
      .db('vpn_sessions')
      .where({ user_id: userId, node_id: nodeId })
      .whereNull('disconnected_at')
    expect(sessions).toHaveLength(1)
    expect(sessions[0].device_name).toBe('HP')
    expect(sessions[0].real_ip).toBe('114.10.156.59')
  })
})

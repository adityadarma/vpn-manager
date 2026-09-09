import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import type { FastifyInstance } from 'fastify'
import { loginAsAdmin } from './helpers'
import { v7 as uuidv7 } from 'uuid'

describe('Users API', () => {
  let app: FastifyInstance
  let adminCookie: string

  beforeAll(async () => {
    app = await buildApp({
      DATABASE_TYPE: 'sqlite',
      DATABASE_SQLITE_PATH: ':memory:',
      JWT_SECRET: 'test-secret-test-secret-test-secret',
      JWT_EXPIRES_IN: '1h',
      NODE_ENV: 'test',
    } as any)

    await app.db.migrate.latest()
    await app.db.seed.run()
    adminCookie = await loginAsAdmin(app)
  })

  afterAll(async () => {
    await app.close()
  })

  it('should list users', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { Cookie: adminCookie }
    })
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(res.json())).toBe(true)
  })

  it('should create a user', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { Cookie: adminCookie },
      payload: {
        username: 'testuser',
        email: 'test@example.com',
        password: 'Password@123',
        role: 'user'
      }
    })

    expect(res.statusCode).toBe(201)
    const json = res.json()
    expect(json.username).toBe('testuser')
    expect(json.id).toBeDefined()
  })

  it('uses a healthy group Managed DNS listener in WireGuard config', async () => {
    const groupId = uuidv7()
    const userId = uuidv7()
    const nodeId = uuidv7()
    const certificateId = uuidv7()
    await app.db('groups').insert({ id: groupId, name: 'managed-dns-user-group' })
    await app.db('users').insert({ id: userId, username: 'managed_dns_user', role: 'user', is_active: true })
    await app.db('vpn_nodes').insert({
      id: nodeId, hostname: 'managed-dns-wg', ip_address: '203.0.113.20', token: 'managed-dns-wg-token', status: 'online',
      vpn_type: 'wireguard', public_key: 'server-public-key', managed_dns_enabled: true, dns_sync_status: 'healthy', dns_config_revision: 1, dns_servers: '9.9.9.9',
    })
    await app.db('group_node_dns_settings').insert({
      group_id: groupId, node_id: nodeId, enabled: true, vpn_subnet: '10.30.10.0/24', listener_ip: '10.30.10.53', listener_port: 53,
      public_default_action: 'allow', upstreams: JSON.stringify(['1.1.1.1', '8.8.8.8']),
    })
    await app.db('user_node_certificates').insert({
      id: certificateId, user_id: userId, node_id: nodeId, credential_name: 'laptop', common_name: 'managed_dns_laptop', vpn_ip: '10.30.10.10', group_id: groupId,
      client_cert: 'client-public-key', client_key: 'client-private-key', is_revoked: false,
    })

    const response = await app.inject({ method: 'GET', url: `/api/v1/users/${userId}/vpn?certId=${certificateId}`, headers: { Cookie: adminCookie } })
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('DNS = 10.30.10.53')

    await app.db('vpn_nodes').where({ id: nodeId }).update({ dns_sync_status: 'degraded' })
    const fallback = await app.inject({ method: 'GET', url: `/api/v1/users/${userId}/vpn?certId=${certificateId}`, headers: { Cookie: adminCookie } })
    expect(fallback.statusCode).toBe(200)
    expect(fallback.body).toContain('DNS = 9.9.9.9')
  })
})

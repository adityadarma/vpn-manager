import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import type { FastifyInstance } from 'fastify'
import { loginAsAdmin, loginAsUser } from './helpers'

describe('Node Registration Security', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({
      JWT_SECRET: 'test-secret',
      JWT_EXPIRES_IN: '1h',
      NODE_ENV: 'test',
    } as any)

    await app.db.migrate.latest()
    await app.db.seed.run()
  })

  afterAll(async () => {
    delete process.env.NODE_REGISTRATION_KEY
    await app.close()
  })

  it('should reject invalid registration key', async () => {
    process.env.NODE_REGISTRATION_KEY = 'correct-key-12345'

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/nodes/register',
      payload: {
        hostname: 'timing-reject-node',
        ip: '192.168.1.100',
        registrationKey: 'wrong-key-12345',
      },
    })
    expect(res.statusCode).toBe(403)
  })

  it('should accept valid registration key', async () => {
    process.env.NODE_REGISTRATION_KEY = 'correct-key-12345'

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/nodes/register',
      payload: {
        hostname: 'timing-accept-node',
        ip: '192.168.1.101',
        registrationKey: 'correct-key-12345',
      },
    })
    expect(res.statusCode).toBe(201)
  })

  it('enables Managed DNS when an auto-registering Agent requested it', async () => {
    process.env.NODE_REGISTRATION_KEY = 'correct-key-12345'

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/nodes/register',
      payload: {
        hostname: 'managed-dns-auto-register-node',
        ip: '192.168.1.102',
        registrationKey: 'correct-key-12345',
        managedDnsEnabled: true,
      },
    })

    expect(res.statusCode).toBe(201)
    const node = await app.db('vpn_nodes').where({ id: res.json().id }).first()
    expect(node.managed_dns_enabled).toBe(1)
    expect(node.dns_sync_status).toBe('disabled')
  })

  it('stores the tunnel mode selected by an auto-registering Agent', async () => {
    process.env.NODE_REGISTRATION_KEY = 'correct-key-12345'

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/nodes/register',
      payload: {
        hostname: 'split-tunnel-auto-register-node',
        ip: '192.168.1.103',
        registrationKey: 'correct-key-12345',
        config: { tunnel_mode: 'split' },
      },
    })

    expect(res.statusCode).toBe(201)
    const node = await app.db('vpn_nodes').where({ id: res.json().id }).first()
    expect(node.tunnel_mode).toBe('split')
  })

  it('rejects an invalid tunnel mode during auto-registration', async () => {
    process.env.NODE_REGISTRATION_KEY = 'correct-key-12345'

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/nodes/register',
      payload: {
        hostname: 'invalid-tunnel-auto-register-node',
        ip: '192.168.1.104',
        registrationKey: 'correct-key-12345',
        config: { tunnel_mode: 'invalid' },
      },
    })

    expect(res.statusCode).toBe(400)
  })

  describe('admin JWT path honours the revocation list', () => {
    it('accepts a live admin token with no registration key', async () => {
      delete process.env.NODE_REGISTRATION_KEY
      const adminCookie = await loginAsAdmin(app)

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/nodes/register',
        headers: { Cookie: adminCookie },
        payload: { hostname: 'admin-jwt-node', ip: '192.168.1.110' },
      })
      expect(res.statusCode).toBe(201)
    })

    it('rejects a logged-out admin token', async () => {
      // No registration key configured, so the JWT is the only way in.
      delete process.env.NODE_REGISTRATION_KEY
      const adminCookie = await loginAsAdmin(app)

      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { Cookie: adminCookie },
      })

      // Previously this still succeeded: the route called jwtVerify() directly
      // and never consulted the revocation list.
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/nodes/register',
        headers: { Cookie: adminCookie },
        payload: { hostname: 'revoked-admin-node', ip: '192.168.1.111' },
      })
      expect(res.statusCode).toBe(403)

      const row = await app.db('vpn_nodes').where({ hostname: 'revoked-admin-node' }).first()
      expect(row).toBeUndefined()
    })

    it('rejects a non-admin token', async () => {
      delete process.env.NODE_REGISTRATION_KEY
      const userCookie = await loginAsUser(app)

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/nodes/register',
        headers: { Cookie: userCookie },
        payload: { hostname: 'non-admin-node', ip: '192.168.1.112' },
      })
      expect(res.statusCode).toBe(403)
    })

    it('still allows a valid registration key when the admin token is revoked', async () => {
      process.env.NODE_REGISTRATION_KEY = 'correct-key-12345'
      const adminCookie = await loginAsAdmin(app)

      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        headers: { Cookie: adminCookie },
      })

      // The revoked cookie must not block the independent key credential.
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/nodes/register',
        headers: { Cookie: adminCookie },
        payload: {
          hostname: 'key-fallback-node',
          ip: '192.168.1.113',
          registrationKey: 'correct-key-12345',
        },
      })
      expect(res.statusCode).toBe(201)
    })
  })
})

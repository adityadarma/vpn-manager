import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import type { FastifyInstance } from 'fastify'
import { loginAsAdmin, loginAsUser } from './helpers'

// Regression tests for the RBAC / authorization hardening:
//  - authenticateAdmin must actually halt non-admin requests (jwt.ts return fix)
//  - admin-only routes must reject regular authenticated users
describe('Authorization (RBAC) enforcement', () => {
  let app: FastifyInstance
  let adminCookie: string
  let userCookie: string

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
    adminCookie = await loginAsAdmin(app)
    userCookie = await loginAsUser(app)
  })

  afterAll(async () => {
    await app.close()
  })

  it('rejects unauthenticated access to admin routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/users' })
    expect(res.statusCode).toBe(401)
  })

  const adminOnlyGets = [
    '/api/v1/users',
    '/api/v1/users/expiring-certs',
    '/api/v1/sessions',
    '/api/v1/sessions/history',
    '/api/v1/sessions/stats',
    '/api/v1/tasks',
    '/api/v1/nodes',
    '/api/v1/policies',
    '/api/v1/groups',
    '/api/v1/networks',
    '/api/v1/audit/logs',
  ]

  for (const url of adminOnlyGets) {
    it(`forbids non-admin GET ${url}`, async () => {
      const res = await app.inject({ method: 'GET', url, headers: { Cookie: userCookie } })
      expect(res.statusCode).toBe(403)
    })

    it(`allows admin GET ${url}`, async () => {
      const res = await app.inject({ method: 'GET', url, headers: { Cookie: adminCookie } })
      expect(res.statusCode).toBe(200)
    })
  }

  it('forbids non-admin from creating tasks', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { Cookie: userCookie },
      payload: { node_id: 'x', action: 'reload_openvpn', payload: {} },
    })
    expect(res.statusCode).toBe(403)
  })
})

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import type { FastifyInstance } from 'fastify'
import { loginAsAdmin } from './helpers'

describe('Policies API', () => {
  let app: FastifyInstance
  let adminCookie: string
  let userId: string

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

    const meRes = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { Cookie: adminCookie },
    })
    userId = meRes.json().id
  })

  afterAll(async () => {
    await app.close()
  })

  it('should create a policy', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/policies',
      headers: { Cookie: adminCookie },
      payload: { userId, targetNetwork: '10.8.0.0/24', action: 'allow', priority: 10 }
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().target_network).toBe('10.8.0.0/24')
  })

  it('should list policies', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/policies',
      headers: { Cookie: adminCookie }
    })

    expect(res.statusCode).toBe(200)
    expect(Array.isArray(res.json())).toBe(true)
    expect(res.json().length).toBeGreaterThan(0)
  })
})

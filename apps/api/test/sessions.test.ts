import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import type { FastifyInstance } from 'fastify'
import { loginAsAdmin } from './helpers'

describe('Sessions API', () => {
  let app: FastifyInstance
  let adminCookie: string

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
  })

  afterAll(async () => {
    await app.close()
  })

  it('should list active sessions', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions',
      headers: { Cookie: adminCookie }
    })

    expect(res.statusCode).toBe(200)
    expect(Array.isArray(res.json())).toBe(true)
  })

  it('should list session history', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/sessions/history',
      headers: { Cookie: adminCookie }
    })

    expect(res.statusCode).toBe(200)
    const json = res.json() as { sessions: unknown[] }
    expect(Array.isArray(json.sessions)).toBe(true)
  })
})

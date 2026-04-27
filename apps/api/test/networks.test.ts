import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import type { FastifyInstance } from 'fastify'
import { loginAsAdmin } from './helpers'

describe('Groups & Networks API', () => {
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

  it('creates a new group', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/groups',
      headers: { Cookie: adminCookie },
      payload: { name: 'IT Staff', description: 'Tech team', vpn_subnet: '10.8.10.0/24' }
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().name).toBe('IT Staff')
  })

  it('creates a new network', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/networks',
      headers: { Cookie: adminCookie },
      payload: { name: 'DB Servers', cidr: '10.0.1.0/24' }
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().cidr).toBe('10.0.1.0/24')
  })
})

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import type { FastifyInstance } from 'fastify'

describe('Policies API', () => {
  let app: FastifyInstance
  let adminToken: string
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

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'Admin@1234!' }
    })
    adminToken = res.json().token
    userId = res.json().user.id
  })

  afterAll(async () => {
    await app.close()
  })

  it('should create a policy', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/policies',
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: { userId, targetNetwork: '10.8.0.0/24', action: 'allow', priority: 10 }
    })
    
    expect(res.statusCode).toBe(201)
    expect(res.json().target_network).toBe('10.8.0.0/24')
  })

  it('should list policies', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/policies',
      headers: { Authorization: `Bearer ${adminToken}` }
    })
    
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(res.json())).toBe(true)
    expect(res.json().length).toBeGreaterThan(0)
  })
})

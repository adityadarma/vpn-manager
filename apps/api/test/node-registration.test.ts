import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import type { FastifyInstance } from 'fastify'

describe('Node Registration Security', () => {
  let app: FastifyInstance

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
})

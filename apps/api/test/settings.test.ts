import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import type { FastifyInstance } from 'fastify'

describe('Health API', () => {
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
    await app.close()
  })

  it('should return health status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
    })

    expect(res.statusCode).toBe(200)
    const json = res.json()
    expect(json.status).toBe('ok')
    expect(typeof json.version).toBe('string')
    expect(typeof json.timestamp).toBe('string')
  })
})

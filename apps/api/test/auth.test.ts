import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import type { FastifyInstance } from 'fastify'
import { loginAsAdmin } from './helpers'
import bcrypt from 'bcryptjs'
import { v7 as uuidv7 } from 'uuid'

describe('Auth API', () => {
  let app: FastifyInstance
  let adminCookie: string

  beforeAll(async () => {
    app = await buildApp({
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

  it('should allow admin login', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin@vpn.local', password: 'Admin@1234!' }
    })

    expect(res.statusCode).toBe(200)
    const json = res.json()
    expect(json.user.name).toBe('Administrator')
    expect(json.user.role).toBe('admin')
    expect(res.headers['set-cookie']).toBeDefined()
  })

  it('should reject invalid credentials', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin@vpn.local', password: 'wrongpassword' }
    })

    expect(res.statusCode).toBe(401)
  })

  it('should reject Staff dashboard login', async () => {
    await app.db('users').insert({
      id: uuidv7(),
      name: 'Staff Login Test',
      email: 'staff@example.com',
      password: await bcrypt.hash('Staff@1234!', 10),
      role: 'user',
      is_active: true,
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'staff@example.com', password: 'Staff@1234!' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('should get current user info with /auth/me', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { Cookie: adminCookie }
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().name).toBe('Administrator')
  })
})

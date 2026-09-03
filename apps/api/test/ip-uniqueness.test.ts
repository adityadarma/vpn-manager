import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'
import type { FastifyInstance } from 'fastify'
import { v7 as uuidv7 } from 'uuid'
import { loginAsAdmin } from './helpers'

describe('VPN IP Uniqueness', () => {
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

  it('should assign unique VPN IPs to users in the same group', async () => {
    const groupId = uuidv7()
    await app.db('groups').insert({
      id: groupId,
      name: 'ip-unique-test-group',
      vpn_subnet: '10.8.1.0/24',
    })

    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { Cookie: adminCookie },
      payload: { username: 'ip_test_user1', password: 'Test@1234!', vpn_group_id: groupId },
    })
    expect(res1.statusCode).toBe(201)

    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { Cookie: adminCookie },
      payload: { username: 'ip_test_user2', password: 'Test@1234!', vpn_group_id: groupId },
    })
    expect(res2.statusCode).toBe(201)
    expect(res1.json().vpn_ip).not.toBe(res2.json().vpn_ip)
  })

  it('should reject duplicate VPN IP at database level', async () => {
    await app.db('users').insert({
      id: uuidv7(),
      username: 'dup_ip_test_1',
      role: 'user',
      is_active: true,
      vpn_ip: '10.99.0.50',
    })

    await expect(
      app.db('users').insert({
        id: uuidv7(),
        username: 'dup_ip_test_2',
        role: 'user',
        is_active: true,
        vpn_ip: '10.99.0.50',
      })
    ).rejects.toThrow()
  })
})

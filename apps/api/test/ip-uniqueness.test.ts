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

  it('does not allocate a VPN IP until a node credential is issued', async () => {
    const groupId = uuidv7()
    await app.db('groups').insert({
      id: groupId,
      name: 'ip-unique-test-group',
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
    // `users.vpn_ip` was removed once credential-scoped identity replaced it —
    // the response no longer carries this field at all.
    expect(res1.json().vpn_ip).toBeUndefined()
    expect(res2.json().vpn_ip).toBeUndefined()
  })

  it('rejects duplicate VPN IP for credentials on the same node', async () => {
    const nodeId = uuidv7()
    await app.db('vpn_nodes').insert({
      id: nodeId,
      hostname: 'credential-ip-node',
      ip_address: '192.0.2.1',
      token: 'credential-ip-node-token',
      status: 'online',
    })
    const firstUserId = uuidv7()
    const secondUserId = uuidv7()
    await app.db('users').insert([
      { id: firstUserId, username: 'dup_ip_test_1', role: 'user', is_active: true },
      { id: secondUserId, username: 'dup_ip_test_2', role: 'user', is_active: true },
    ])
    await app.db('user_node_certificates').insert({
      id: uuidv7(),
      user_id: firstUserId,
      node_id: nodeId,
      credential_name: 'first',
      common_name: 'dup_ip_first',
      vpn_ip: '10.99.0.50',
      is_revoked: false,
    })

    await expect(
      app.db('user_node_certificates').insert({
        id: uuidv7(),
        user_id: secondUserId,
        node_id: nodeId,
        credential_name: 'second',
        common_name: 'dup_ip_second',
        is_revoked: false,
        vpn_ip: '10.99.0.50',
      })
    ).rejects.toThrow()
  })

})

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

  it('compiles group policy with node-specific allocation subnet', async () => {
    const { enqueueApplyPolicies } = await import('../src/modules/policies/policies.routes')
    const { v7: uuidv7 } = await import('uuid')

    const testNodeId = uuidv7()
    const testGroupId = uuidv7()

    await app.db('vpn_nodes').insert({
      id: testNodeId,
      hostname: 'node-scope-test',
      ip_address: '198.51.100.1',
      status: 'online',
      token: 'node-scope-token',
      vpn_network: '10.50.0.0',
      vpn_netmask: '255.255.0.0',
      firewall_engine: 'iptables',
      vpn_type: 'openvpn',
    })

    await app.db('groups').insert({
      id: testGroupId,
      name: 'node-scope-group',
    })

    await app.db('group_node_dns_settings').insert({
      group_id: testGroupId,
      node_id: testNodeId,
      vpn_subnet: '10.50.10.0/24', // node-specific allocation
      enabled: true,
      upstreams: JSON.stringify(['1.1.1.1']),
    })

    await app.db('vpn_policies').insert({
      id: uuidv7(),
      group_id: testGroupId,
      target_network: '172.16.0.0/16',
      protocol: 'all',
      action: 'allow',
      priority: 10,
    })

    await enqueueApplyPolicies(app, testNodeId)

    const task = await app.db('tasks')
      .where({ node_id: testNodeId, action: 'apply_network_policy' })
      .orderBy('created_at', 'desc')
      .first()

    expect(task).toBeDefined()
    const payload = JSON.parse(task.payload)
    const groupPolicy = payload.policies.find((p: any) => p.group_id === testGroupId)
    expect(groupPolicy).toBeDefined()
    expect(groupPolicy.group_subnet).toBe('10.50.10.0/24')
  })
})

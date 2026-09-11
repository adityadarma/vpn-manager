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
      payload: { name: 'IT Staff', description: 'Tech team' }
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

  it('manages group subnet allocations on nodes through networks module', async () => {
    const { v7: uuidv7 } = await import('uuid')
    const nodeId = uuidv7()
    const groupId = uuidv7()

    await app.db('vpn_nodes').insert({
      id: nodeId,
      hostname: 'net-alloc-node',
      ip_address: '198.51.100.20',
      token: 'net-alloc-token',
      vpn_network: '10.40.0.0',
      vpn_netmask: '255.255.0.0',
    })

    await app.db('groups').insert({
      id: groupId,
      name: 'net-alloc-group',
    })

    // 1. Allocate subnet
    const allocRes = await app.inject({
      method: 'POST',
      url: '/api/v1/networks/group-allocations',
      headers: { Cookie: adminCookie },
      payload: { group_id: groupId, node_id: nodeId, vpn_subnet: '10.40.5.0/24' }
    })
    expect(allocRes.statusCode).toBe(200)
    expect(allocRes.json()).toMatchObject({
      group_id: groupId,
      node_id: nodeId,
      vpn_subnet: '10.40.5.0/24',
      node_pool: '10.40.0.0/16',
    })

    // 2. List allocations
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/networks/group-allocations',
      headers: { Cookie: adminCookie },
    })
    expect(listRes.statusCode).toBe(200)
    const found = listRes.json().find((a: any) => a.group_id === groupId && a.node_id === nodeId)
    expect(found).toBeDefined()
    expect(found.vpn_subnet).toBe('10.40.5.0/24')

    // 3. Delete allocation
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/networks/group-allocations/${groupId}/${nodeId}`,
      headers: { Cookie: adminCookie },
    })
    expect(delRes.statusCode).toBe(204)
  })
})

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { v7 as uuidv7 } from 'uuid'
import { buildApp } from '../src/app'
import { loginAsAdmin } from './helpers'

describe('Group-node DNS settings', () => {
  let app: FastifyInstance
  let adminCookie: string
  let nodeId: string
  let engineeringId: string
  let financeId: string

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
    nodeId = uuidv7()
    engineeringId = uuidv7()
    financeId = uuidv7()
    await app.db('vpn_nodes').insert({
      id: nodeId,
      hostname: 'dynamic-pool-node',
      ip_address: '192.0.2.10',
      token: 'dynamic-pool-node-token',
      vpn_network: '10.20.0.0',
      vpn_netmask: '255.255.0.0',
    })
    await app.db('groups').insert([
      { id: engineeringId, name: 'dns-engineering' },
      { id: financeId, name: 'dns-finance' },
    ])
  })

  afterAll(async () => {
    await app.close()
  })

  const putSettings = (groupId: string, body: Record<string, unknown>) => app.inject({
    method: 'PUT',
    url: `/api/v1/groups/${groupId}/nodes/${nodeId}/dns`,
    headers: { Cookie: adminCookie },
    payload: body,
  })

  it('stores a group allocation inside the target node dynamic pool', async () => {
    const response = await putSettings(engineeringId, {
      enabled: true,
      vpn_subnet: '10.20.10.0/24',
      listener_ip: '10.20.10.53',
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      group_id: engineeringId,
      node_id: nodeId,
      vpn_subnet: '10.20.10.0/24',
      listener_ip: '10.20.10.53',
      enabled: 1,
    })
    expect(JSON.parse(response.json().upstreams)).toEqual(['1.1.1.1', '8.8.8.8'])
  })

  it('rejects an allocation outside the target node pool', async () => {
    const response = await putSettings(financeId, {
      enabled: true,
      vpn_subnet: '10.8.10.0/24',
      listener_ip: '10.8.10.53',
    })
    expect(response.statusCode).toBe(400)
  })

  it('rejects an overlapping group allocation on the same node', async () => {
    const response = await putSettings(financeId, {
      enabled: true,
      vpn_subnet: '10.20.10.128/25',
      listener_ip: '10.20.10.200',
    })
    expect(response.statusCode).toBe(409)
  })

  it('rejects a DNS listener IP already assigned to a credential', async () => {
    const userId = uuidv7()
    await app.db('users').insert({ id: userId, username: 'dns-listener-conflict', role: 'user', is_active: true })
    await app.db('user_node_certificates').insert({
      id: uuidv7(),
      user_id: userId,
      node_id: nodeId,
      credential_name: 'laptop',
      common_name: 'dns_listener_conflict',
      vpn_ip: '10.20.20.53',
      is_revoked: false,
    })
    const response = await putSettings(financeId, {
      enabled: true,
      vpn_subnet: '10.20.20.0/24',
      listener_ip: '10.20.20.53',
    })
    expect(response.statusCode).toBe(409)
  })

  it('coalesces desired state changes before a sync completes', async () => {
    await app.db('vpn_nodes').where({ id: nodeId }).update({ managed_dns_enabled: true })

    // Two mutations back to back, with no Agent result in between. They must
    // update one queued task rather than creating an unbounded revision/task
    // stream while an operator imports records or policies.
    const zone = await app.inject({
      method: 'POST', url: '/api/v1/dns/zones',
      headers: { Cookie: adminCookie }, payload: { name: 'revision-check.internal' },
    })
    expect(zone.statusCode).toBe(201)
    const assign = await app.inject({
      method: 'PUT', url: `/api/v1/groups/${engineeringId}/dns/zones`,
      headers: { Cookie: adminCookie }, payload: { zone_ids: [zone.json().id] },
    })
    expect(assign.statusCode).toBe(200)

    const policy = await app.inject({
      method: 'POST', url: `/api/v1/groups/${engineeringId}/dns/policies`,
      headers: { Cookie: adminCookie },
      payload: { domain_pattern: 'revision-check.example', action: 'block', scope: 'public' },
    })
    expect(policy.statusCode).toBe(201)

    const revisions = await app.db('node_dns_revisions').where({ node_id: nodeId }).orderBy('revision')
    expect(revisions).toHaveLength(1)
    expect(revisions.filter((row: any) => row.status === 'pending')).toHaveLength(1)
    expect(revisions[0]?.status).toBe('pending')
    expect(revisions[0]?.revision).toBe(1)
    const pendingTasks = await app.db('tasks').where({ node_id: nodeId, action: 'sync_group_dns', status: 'pending' })
    expect(pendingTasks).toHaveLength(1)
    const pendingPayload = JSON.parse(pendingTasks[0]?.payload ?? '{}')
    expect(pendingPayload.groups[0]?.policies).toContainEqual(expect.objectContaining({ domain_pattern: 'revision-check.example' }))

    await app.db('node_dns_revisions').where({ node_id: nodeId }).delete()
    await app.db('tasks').where({ node_id: nodeId, action: 'sync_group_dns' }).delete()
    await app.db('group_dns_zones').where({ group_id: engineeringId }).delete()
    await app.db('dns_policies').where({ group_id: engineeringId }).delete()
    await app.db('dns_zones').where({ id: zone.json().id }).delete()
    await app.db('vpn_nodes').where({ id: nodeId }).update({ managed_dns_enabled: false, dns_sync_status: 'disabled' })
  })

  it('queues a new revision when the previous sync task is already running', async () => {
    await app.db('vpn_nodes').where({ id: nodeId }).update({ managed_dns_enabled: true })
    const zone = await app.inject({
      method: 'POST', url: '/api/v1/dns/zones',
      headers: { Cookie: adminCookie }, payload: { name: 'running-revision.internal' },
    })
    expect(zone.statusCode).toBe(201)

    const sync = await app.inject({
      method: 'POST', url: `/api/v1/nodes/${nodeId}/dns/sync`, headers: { Cookie: adminCookie },
    })
    expect(sync.statusCode).toBe(202)
    const firstTask = await app.db('tasks').where({ node_id: nodeId, action: 'sync_group_dns' }).first()
    await app.db('tasks').where({ id: firstTask.id }).update({ status: 'running' })

    const policy = await app.inject({
      method: 'POST', url: `/api/v1/groups/${engineeringId}/dns/policies`,
      headers: { Cookie: adminCookie },
      payload: { domain_pattern: 'running-revision.example', action: 'block', scope: 'public' },
    })
    expect(policy.statusCode).toBe(201)

    const revisions = await app.db('node_dns_revisions').where({ node_id: nodeId }).orderBy('revision')
    expect(revisions).toHaveLength(2)
    expect(revisions.map((row: any) => row.revision)).toEqual([1, 2])
    const secondTask = await app.db('tasks').where({ node_id: nodeId, action: 'sync_group_dns', status: 'pending' }).first()
    expect(JSON.parse(secondTask.payload).groups[0]?.policies).toContainEqual(expect.objectContaining({ domain_pattern: 'running-revision.example' }))

    await app.db('node_dns_revisions').where({ node_id: nodeId }).delete()
    await app.db('tasks').where({ node_id: nodeId, action: 'sync_group_dns' }).delete()
    await app.db('dns_policies').where({ group_id: engineeringId }).delete()
    await app.db('dns_zones').where({ id: zone.json().id }).delete()
    await app.db('vpn_nodes').where({ id: nodeId }).update({ managed_dns_enabled: false, dns_sync_status: 'disabled' })
  })

  it('queues a revisioned sync task and records its successful result', async () => {
    await app.db('vpn_nodes').where({ id: nodeId }).update({ managed_dns_enabled: true })
    const sync = await app.inject({
      method: 'POST',
      url: `/api/v1/nodes/${nodeId}/dns/sync`,
      headers: { Cookie: adminCookie },
    })
    expect(sync.statusCode).toBe(202)
    const taskId = sync.json().task_id
    const task = await app.db('tasks').where({ id: taskId }).first()
    const payload = JSON.parse(task.payload)
    expect(task.action).toBe('sync_group_dns')
    expect(payload).toMatchObject({ revision: 1, groups: [{ id: engineeringId, listener_ip: '10.20.10.53' }] })
    expect(payload.config_hash).toMatch(/^sha256:[a-f0-9]{64}$/)

    const result = await app.inject({
      method: 'POST',
      url: `/api/v1/tasks/${taskId}/result`,
      headers: { Authorization: 'Bearer dynamic-pool-node-token' },
      payload: { status: 'success', result: { revision: payload.revision, config_hash: payload.config_hash } },
    })
    expect(result.statusCode).toBe(200)
    const node = await app.db('vpn_nodes').where({ id: nodeId }).first()
    expect(node.dns_sync_status).toBe('healthy')
    expect(node.dns_config_revision).toBe(1)
  })

})

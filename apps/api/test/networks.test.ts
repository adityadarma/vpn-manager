import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import { buildApp } from '../src/app'
import type { FastifyInstance } from 'fastify'
import { loginAsAdmin } from './helpers'

describe('Groups & Networks API', () => {
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

  describe('per-node route scoping', () => {
    /**
     * Build a group with one credential on each of two online nodes, plus a
     * network assigned to the group. Node assignment is left to the caller.
     */
    let seedIndex = 0

    async function seedTwoNodeScenario(prefix: string) {
      // networks.cidr and vpn_nodes.ip_address are UNIQUE, so each scenario
      // needs its own address space.
      const slot = seedIndex++
      const cidr = `172.${20 + slot}.0.0/20`
      const nodeA = uuidv7()
      const nodeB = uuidv7()
      const groupId = uuidv7()
      const networkId = uuidv7()
      const userId = uuidv7()

      await app.db('vpn_nodes').insert([
        {
          id: nodeA,
          hostname: `${prefix}-node-a`,
          ip_address: `198.51.${100 + slot}.51`,
          token: `${prefix}-token-a`,
          vpn_network: `10.${50 + slot * 2}.0.0`,
          vpn_netmask: '255.255.0.0',
          status: 'online',
        },
        {
          id: nodeB,
          hostname: `${prefix}-node-b`,
          ip_address: `198.51.${100 + slot}.52`,
          token: `${prefix}-token-b`,
          vpn_network: `10.${51 + slot * 2}.0.0`,
          vpn_netmask: '255.255.0.0',
          status: 'online',
        },
      ])

      await app.db('groups').insert({ id: groupId, name: `${prefix}-group` })
      await app.db('networks').insert({
        id: networkId,
        name: `${prefix}-net`,
        cidr,
      })
      await app.db('group_networks').insert({ group_id: groupId, network_id: networkId })

      await app.db('users').insert({
        id: userId,
        name: `${prefix}-user`,
        email: `${prefix}@vpn.local`,
        password: 'x',
        role: 'user',
        is_active: true,
      })
      await app.db('user_groups').insert({ user_id: userId, group_id: groupId })

      await app.db('user_node_certificates').insert([
        {
          id: uuidv7(),
          user_id: userId,
          node_id: nodeA,
          common_name: `${prefix}-cn-a`,
          vpn_ip: `10.${50 + slot * 2}.0.10`,
          group_id: groupId,
          is_revoked: false,
        },
        {
          id: uuidv7(),
          user_id: userId,
          node_id: nodeB,
          common_name: `${prefix}-cn-b`,
          vpn_ip: `10.${51 + slot * 2}.0.10`,
          group_id: groupId,
          is_revoked: false,
        },
      ])

      return { nodeA, nodeB, groupId, networkId, cidr }
    }

    function ccdTasksFor(tasks: any[], nodeId: string): any[] {
      return tasks.filter((t) => t.node_id === nodeId && t.action === 'write_client_ccd')
    }

    function ccdRoutesFor(tasks: any[], nodeId: string): string[] {
      return ccdTasksFor(tasks, nodeId).flatMap((t) => JSON.parse(t.payload).extra_lines ?? [])
    }

    it('does not push routes for a network with no target nodes', async () => {
      const { nodeA, nodeB, groupId, networkId } = await seedTwoNodeScenario('unassigned')

      await app.db('tasks').delete()

      // Re-assign the network to the group to trigger CCD regeneration.
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/groups/${groupId}/networks`,
        headers: { Cookie: adminCookie },
        payload: { network_id: networkId },
      })
      expect(res.statusCode).toBe(201)

      const tasks = await app.db('tasks').select('node_id', 'action', 'payload')

      // Guard against a vacuous pass: CCD tasks must exist for both nodes.
      expect(ccdTasksFor(tasks, nodeA).length).toBeGreaterThan(0)
      expect(ccdTasksFor(tasks, nodeB).length).toBeGreaterThan(0)

      // With zero node assignments the route is unreachable and must not be pushed.
      expect(ccdRoutesFor(tasks, nodeA)).toEqual([])
      expect(ccdRoutesFor(tasks, nodeB)).toEqual([])
    })

    it('pushes a route only to the node it is assigned to', async () => {
      const { nodeA, nodeB, networkId, cidr } = await seedTwoNodeScenario('scoped')

      await app.db('tasks').delete()

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/networks/${networkId}/nodes`,
        headers: { Cookie: adminCookie },
        payload: { node_id: nodeA },
      })
      expect(res.statusCode).toBe(201)

      const tasks = await app.db('tasks').select('node_id', 'action', 'payload')
      const network = cidr.split('/')[0]

      expect(ccdRoutesFor(tasks, nodeA)).toEqual([`push "route ${network} 255.255.240.0"`])
      expect(ccdRoutesFor(tasks, nodeB)).toEqual([])
    })

    it('never writes a target network CIDR into the node\u2019s own server.conf', async () => {
      // A target network is reached through the node's NIC, so it belongs in the
      // client profile and CCD, never in server.conf. A server-side `route` for
      // it installs a tunnel route on the node that outranks the NIC route and
      // cuts the node off from that network, gateway included.
      const { nodeA, nodeB, networkId, cidr } = await seedTwoNodeScenario('serverconf')

      await app.db('tasks').delete()

      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/v1/networks/${networkId}/nodes`,
            headers: { Cookie: adminCookie },
            payload: { node_id: nodeA },
          })
        ).statusCode,
      ).toBe(201)

      const configTasks = await app.db('tasks')
        .where({ action: 'update_server_config' })
        .select('node_id', 'payload')

      const subnetsFor = (nodeId: string) =>
        configTasks
          .filter((t: any) => t.node_id === nodeId)
          .flatMap((t: any) => JSON.parse(t.payload).group_subnets ?? [])

      // Guard against a vacuous pass: the assigned node must still be told to
      // rewrite server.conf, it just must not carry the network CIDR.
      expect(configTasks.filter((t: any) => t.node_id === nodeA).length).toBeGreaterThan(0)
      expect(subnetsFor(nodeA)).not.toContain(cidr)
      expect(subnetsFor(nodeB)).not.toContain(cidr)

      // The route still has to reach clients, through the CCD push instead.
      const tasks = await app.db('tasks').select('node_id', 'action', 'payload')
      const network = cidr.split('/')[0]
      expect(ccdRoutesFor(tasks, nodeA)).toEqual([`push "route ${network} 255.255.240.0"`])
    })

    it('still writes group VPN subnet pools into server.conf', async () => {
      // The counterpart to the test above: group subnets are real tunnel-side
      // pools and must keep producing server-side `route` directives.
      const { nodeA, groupId, networkId } = await seedTwoNodeScenario('grouppool')
      const groupPool = '10.211.0.0/24'

      await app.db('group_node_dns_settings').insert({
        group_id: groupId,
        node_id: nodeA,
        vpn_subnet: groupPool,
        enabled: false,
        listener_port: 53,
        upstreams: JSON.stringify(['1.1.1.1']),
      })

      await app.db('tasks').delete()

      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/v1/networks/${networkId}/nodes`,
            headers: { Cookie: adminCookie },
            payload: { node_id: nodeA },
          })
        ).statusCode,
      ).toBe(201)

      const subnets = (
        await app.db('tasks')
          .where({ action: 'update_server_config', node_id: nodeA })
          .select('payload')
      ).flatMap((t: any) => JSON.parse(t.payload).group_subnets ?? [])

      expect(subnets).toContain(groupPool)
    })

    it('rewrites server.conf on a node that was unassigned through PATCH', async () => {
      const { nodeA, networkId, cidr } = await seedTwoNodeScenario('unassign-patch')

      // Assign first so the node's server.conf carries the route directive.
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/v1/networks/${networkId}/nodes`,
            headers: { Cookie: adminCookie },
            payload: { node_id: nodeA },
          })
        ).statusCode,
      ).toBe(201)

      await app.db('tasks').delete()

      // Clearing the checkbox sends an empty node_ids list.
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: `/api/v1/networks/${networkId}`,
            headers: { Cookie: adminCookie },
            payload: { node_ids: [] },
          })
        ).statusCode,
      ).toBe(200)

      const configTasks = await app.db('tasks')
        .where({ action: 'update_server_config', node_id: nodeA })
        .select('payload')

      // The unassigned node must still be told to rewrite server.conf, and the
      // route must be gone from the payload.
      expect(configTasks.length).toBeGreaterThan(0)
      expect(
        configTasks.flatMap((t: any) => JSON.parse(t.payload).group_subnets ?? []),
      ).not.toContain(cidr)
    })

    it('rewrites server.conf on assigned nodes when the network is deleted', async () => {
      const { nodeA, networkId, cidr } = await seedTwoNodeScenario('delete-net')

      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/v1/networks/${networkId}/nodes`,
            headers: { Cookie: adminCookie },
            payload: { node_id: nodeA },
          })
        ).statusCode,
      ).toBe(201)

      await app.db('tasks').delete()

      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/api/v1/networks/${networkId}`,
            headers: { Cookie: adminCookie },
          })
        ).statusCode,
      ).toBe(204)

      const configTasks = await app.db('tasks')
        .where({ action: 'update_server_config', node_id: nodeA })
        .select('payload')

      expect(configTasks.length).toBeGreaterThan(0)
      expect(
        configTasks.flatMap((t: any) => JSON.parse(t.payload).group_subnets ?? []),
      ).not.toContain(cidr)
    })
  })
})

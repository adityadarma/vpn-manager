import type { FastifyPluginAsync } from 'fastify'
import { v7 as uuidv7 } from 'uuid'
import { cidrsToPushRoutes, getNetmask, parseCidr, cidrWithin, cidrsOverlap, nodePoolCidr } from '../../services/ip-pool'
import { logAudit, getClientIp } from '../../utils/audit'
import { enqueueApplyPolicies } from '../policies/policies.routes'
import { enqueueNodeDnsSync } from '../../services/managed-dns'

interface Network {
  id: string
  name: string
  cidr: string
  description: string | null
  created_at: string
  updated_at: string
  group_count?: number
  node_count?: number
  node_ids?: string[]
}

const networkRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/v1/networks — list all networks with group & node count
  app.get(
    '/networks',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['networks'], summary: 'List all VPN networks', security: [{ bearerAuth: [] }] } },
    async () => {
      const networks = await app.db('networks as n')
        .select(
          'n.id', 'n.name', 'n.cidr', 'n.description', 'n.created_at', 'n.updated_at',
          app.db.raw('COUNT(DISTINCT gn.group_id) as group_count'),
          app.db.raw('COUNT(DISTINCT nn.node_id) as node_count'),
        )
        .leftJoin('group_networks as gn', 'n.id', 'gn.network_id')
        .leftJoin('node_networks as nn', 'n.id', 'nn.network_id')
        .groupBy('n.id', 'n.name', 'n.cidr', 'n.description', 'n.created_at', 'n.updated_at')
        .orderBy('n.name')

      const nodeAssignments = await app.db('node_networks').select('network_id', 'node_id')

      return networks.map((n: any) => ({
        ...n,
        node_ids: nodeAssignments
          .filter((a: any) => a.network_id === n.id)
          .map((a: any) => a.node_id),
      }))
    },
  )

  // GET /api/v1/networks/:id
  app.get<{ Params: { id: string } }>(
    '/networks/:id',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['networks'], summary: 'Get network by ID', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const network = await app.db('networks').where({ id: request.params.id }).first()
      if (!network) return reply.status(404).send({ error: 'Network not found' })

      const groups = await app.db('group_networks as gn')
        .join('groups as g', 'gn.group_id', 'g.id')
        .where('gn.network_id', request.params.id)
        .select('g.id', 'g.name', 'g.description')

      const nodes = await app.db('node_networks as nn')
        .join('vpn_nodes as v', 'nn.node_id', 'v.id')
        .where('nn.network_id', request.params.id)
        .select('v.id', 'v.hostname', 'v.ip_address', 'v.status')

      return { ...network, groups, nodes }
    },
  )

  // POST /api/v1/networks
  app.post<{ Body: { name: string; cidr: string; description?: string; node_ids?: string[] } }>(
    '/networks',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['networks'], summary: 'Create a network segment', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const { name, cidr, description, node_ids } = request.body
      if (!name?.trim() || !cidr?.trim()) {
        return reply.status(400).send({ error: 'name and cidr are required' })
      }

      const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/(\d|[1-2]\d|3[0-2])$/
      if (!cidrRegex.test(cidr.trim())) {
        return reply.status(400).send({ error: 'Invalid CIDR format (e.g. 10.0.1.0/24)' })
      }

      const id = uuidv7()
      await app.db('networks').insert({
        id,
        name: name.trim(),
        cidr: cidr.trim(),
        description: description?.trim() ?? null,
      })

      if (node_ids && node_ids.length > 0) {
        await app.db('node_networks').insert(
          node_ids.map((node_id) => ({ node_id, network_id: id }))
        )
      }

      const created = await app.db('networks').where({ id }).first()
      return reply.status(201).send({ ...created, node_ids: node_ids ?? [] })
    },
  )

  // PATCH /api/v1/networks/:id
  app.patch<{ Params: { id: string }; Body: { name?: string; cidr?: string; description?: string; node_ids?: string[] } }>(
    '/networks/:id',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['networks'], summary: 'Update a network', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const { name, cidr, description, node_ids } = request.body
      const updates: Record<string, unknown> = { updated_at: new Date() }
      if (name) updates['name'] = name.trim()
      if (cidr) {
        const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/(\d|[1-2]\d|3[0-2])$/
        if (!cidrRegex.test(cidr.trim())) {
          return reply.status(400).send({ error: 'Invalid CIDR format' })
        }
        updates['cidr'] = cidr.trim()
      }
      if (description !== undefined) updates['description'] = description?.trim() ?? null

      const updated = await app.db('networks').where({ id: request.params.id }).update(updates)
      if (!updated) return reply.status(404).send({ error: 'Network not found' })

      // Update node assignments if provided
      if (node_ids !== undefined) {
        await app.db('node_networks').where({ network_id: request.params.id }).delete()
        if (node_ids.length > 0) {
          await app.db('node_networks').insert(
            node_ids.map((node_id) => ({ node_id, network_id: request.params.id }))
          )
        }

        // Refresh CCD and update server.conf route directives for affected nodes
        await reenqueueNetworkCcdTasks(app, request.params.id)
        // Trigger server config update for each newly assigned node
        for (const node_id of (node_ids.length > 0 ? node_ids : [])) {
          await triggerNodeConfigUpdate(app, node_id)
        }
      }

      const result = await app.db('networks').where({ id: request.params.id }).first()
      const assignedNodeIds = await app.db('node_networks')
        .where({ network_id: request.params.id })
        .pluck('node_id') as string[]

      return { ...result, node_ids: assignedNodeIds }
    },
  )

  // DELETE /api/v1/networks/:id
  app.delete<{ Params: { id: string } }>(
    '/networks/:id',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['networks'], summary: 'Delete a network', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const deleted = await app.db('networks').where({ id: request.params.id }).delete()
      if (!deleted) return reply.status(404).send({ error: 'Network not found' })
      return reply.status(204).send()
    },
  )

  // POST /api/v1/networks/:id/nodes — assign a node to network
  app.post<{ Params: { id: string }; Body: { node_id: string } }>(
    '/networks/:id/nodes',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['networks'], summary: 'Assign node to network', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const { node_id } = request.body
      const network = await app.db('networks').where({ id: request.params.id }).first()
      if (!network) return reply.status(404).send({ error: 'Network not found' })

      await app.db('node_networks')
        .insert({ node_id, network_id: request.params.id })
        .onConflict(['node_id', 'network_id']).ignore()

      await reenqueueNetworkCcdTasks(app, request.params.id)
      await triggerNodeConfigUpdate(app, node_id)
      return reply.status(201).send({ node_id, network_id: request.params.id })
    },
  )

  // DELETE /api/v1/networks/:id/nodes/:nodeId — remove node from network
  app.delete<{ Params: { id: string; nodeId: string } }>(
    '/networks/:id/nodes/:nodeId',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['networks'], summary: 'Remove node from network', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      await app.db('node_networks')
        .where({ network_id: request.params.id, node_id: request.params.nodeId })
        .delete()

      await reenqueueNetworkCcdTasks(app, request.params.id)
      await triggerNodeConfigUpdate(app, request.params.nodeId)
      return reply.status(204).send()
    },
  )

  // GET /api/v1/networks/group-allocations — list all group subnet allocations across nodes
  app.get(
    '/networks/group-allocations',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['networks'], summary: 'List group subnet allocations across nodes', security: [{ bearerAuth: [] }] } },
    async () => {
      const allocations = await app.db('group_node_dns_settings as a')
        .join('groups as g', 'a.group_id', 'g.id')
        .join('vpn_nodes as n', 'a.node_id', 'n.id')
        .select(
          'a.group_id',
          'g.name as group_name',
          'a.node_id',
          'n.hostname as node_hostname',
          'n.vpn_network',
          'n.vpn_netmask',
          'a.vpn_subnet',
          'a.enabled as managed_dns_enabled',
          'a.listener_ip',
          'a.created_at',
          'a.updated_at'
        )
        .orderBy('g.name')
        .orderBy('n.hostname')

      return allocations.map((a: any) => ({
        ...a,
        node_pool: nodePoolCidr(a.vpn_network, a.vpn_netmask),
        managed_dns_enabled: Boolean(a.managed_dns_enabled),
      }))
    },
  )

  // POST /api/v1/networks/group-allocations — allocate or update group subnet on a node
  app.post<{ Body: { group_id: string; node_id: string; vpn_subnet: string } }>(
    '/networks/group-allocations',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['networks'], summary: 'Allocate subnet to group on a node', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const { group_id, node_id, vpn_subnet } = request.body
      if (!group_id?.trim() || !node_id?.trim() || !vpn_subnet?.trim()) {
        return reply.status(400).send({ error: 'group_id, node_id, and vpn_subnet are required' })
      }

      const group = await app.db('groups').where({ id: group_id }).first()
      if (!group) return reply.status(404).send({ error: 'Group not found' })

      const node = await app.db('vpn_nodes').where({ id: node_id }).first()
      if (!node) return reply.status(404).send({ error: 'Node not found' })

      const subnet = vpn_subnet.trim()
      let parentPool: string
      try {
        parseCidr(subnet)
        parentPool = nodePoolCidr(node.vpn_network, node.vpn_netmask)
      } catch (error) {
        return reply.status(400).send({ error: `Invalid VPN subnet or node pool: ${(error as Error).message}` })
      }
      if (!cidrWithin(subnet, parentPool)) {
        return reply.status(400).send({ error: `vpn_subnet must be inside node pool ${parentPool}` })
      }

      const existing = await app.db('group_node_dns_settings')
        .where({ node_id: node.id })
        .whereNot({ group_id: group.id })
        .select('group_id', 'vpn_subnet')
      const overlap = existing.find((setting: any) => cidrsOverlap(subnet, setting.vpn_subnet))
      if (overlap) {
        return reply.status(409).send({ error: `vpn_subnet overlaps allocation for group ${overlap.group_id}` })
      }

      const current = await app.db('group_node_dns_settings')
        .where({ group_id: group.id, node_id: node.id })
        .first()

      const record = {
        group_id: group.id,
        node_id: node.id,
        vpn_subnet: subnet,
        enabled: current?.enabled ?? false,
        listener_ip: current?.listener_ip ?? null,
        listener_port: current?.listener_port ?? 53,
        public_default_action: current?.public_default_action ?? 'allow',
        upstreams: current?.upstreams ?? JSON.stringify(['1.1.1.1', '8.8.8.8']),
        updated_at: new Date(),
      }

      await app.db('group_node_dns_settings')
        .insert({ ...record, created_at: new Date() })
        .onConflict(['group_id', 'node_id'])
        .merge(record)

      await triggerNodeConfigUpdate(app, node.id)
      await enqueueApplyPolicies(app, node.id)
      if (node.managed_dns_enabled && record.enabled) {
        await enqueueNodeDnsSync(app, node.id)
      }

      const userObj = request.user as { id: string; username: string }
      await logAudit(app, {
        userId: userObj.id,
        username: userObj.username,
        action: 'group_node_subnet_allocate',
        resourceType: 'group_node_allocation',
        resourceId: `${group.id}:${node.id}`,
        ipAddress: getClientIp(request),
        metadata: { group_id: group.id, node_id: node.id, vpn_subnet: subnet },
      })

      return reply.status(200).send({
        group_id: group.id,
        group_name: group.name,
        node_id: node.id,
        node_hostname: node.hostname,
        vpn_subnet: subnet,
        node_pool: parentPool,
        managed_dns_enabled: Boolean(record.enabled),
      })
    },
  )

  // DELETE /api/v1/networks/group-allocations/:groupId/:nodeId
  app.delete<{ Params: { groupId: string; nodeId: string } }>(
    '/networks/group-allocations/:groupId/:nodeId',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['networks'], summary: 'Remove group subnet allocation from node', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const { groupId, nodeId } = request.params
      const deletedCount = await app.db('group_node_dns_settings')
        .where({ group_id: groupId, node_id: nodeId })
        .delete()

      if (deletedCount > 0) {
        await triggerNodeConfigUpdate(app, nodeId)
        await enqueueApplyPolicies(app, nodeId)
        const node = await app.db('vpn_nodes').where({ id: nodeId }).first()
        if (node?.managed_dns_enabled) {
          await enqueueNodeDnsSync(app, nodeId)
        }

        const userObj = request.user as { id: string; username: string }
        await logAudit(app, {
          userId: userObj.id,
          username: userObj.username,
          action: 'group_node_subnet_deallocate',
          resourceType: 'group_node_allocation',
          resourceId: `${groupId}:${nodeId}`,
          ipAddress: getClientIp(request),
          metadata: { group_id: groupId, node_id: nodeId },
        })
      }

      return reply.status(204).send()
    },
  )
}

/**
 * Re-enqueue write_client_ccd tasks for all users in groups using this network.
 * Filters routes per-node: networks with node assignments only push to matching nodes,
 * global networks (no assignment) push to all nodes.
 */
async function reenqueueNetworkCcdTasks(app: any, networkId: string): Promise<void> {
  // Find all groups using this network
  const groupIds = await app.db('group_networks')
    .where({ network_id: networkId })
    .pluck('group_id') as string[]

  if (groupIds.length === 0) return

  // Find credentials in those groups. VPN addresses belong to credentials.
  const members = await app.db('user_node_certificates as c')
    .join('users as u', 'c.user_id', 'u.id')
    .join('user_groups as ug', 'u.id', 'ug.user_id')
    .whereIn('ug.group_id', groupIds)
    .where({ 'c.is_revoked': false })
    .whereNotNull('c.vpn_ip')
    .distinct('c.id', 'c.node_id', 'c.common_name', 'c.client_cert', 'c.vpn_ip', 'c.group_id', 'u.id as user_id')
    .select('c.id', 'c.node_id', 'c.common_name', 'c.client_cert', 'c.vpn_ip', 'c.group_id', 'u.id as user_id')

  if (members.length === 0) return

  const tasks: any[] = []

  for (const member of members) {
    // Get all group IDs for this user
    const userGroupIds = await app.db('user_groups')
      .where({ user_id: member.user_id })
      .pluck('group_id') as string[]

    // Get netmask from primary group allocation on this node
    let netmask = '255.255.255.0'
    if (member.group_id) {
      const allocation = await app.db('group_node_dns_settings')
        .where({ group_id: member.group_id, node_id: member.node_id })
        .first('vpn_subnet')
      if (allocation?.vpn_subnet) {
        netmask = getNetmask(allocation.vpn_subnet)
      }
    }

    const node = await app.db('vpn_nodes').where({ id: member.node_id, status: 'online' }).first()
    if (node) {
      // Per-node filtering: global (no node) → all nodes, specific → matched node only
      const allGroupNetworks = await app.db('group_networks as gn')
        .join('networks as n', 'gn.network_id', 'n.id')
        .leftJoin('node_networks as nn', (builder: any) => {
          builder.on('n.id', 'nn.network_id').andOn('nn.node_id', app.db.raw('?', [node.id]))
        })
        .whereIn('gn.group_id', userGroupIds)
        .select('n.cidr', 'nn.node_id')

      const filteredCidrs: string[] = [...new Set(
        (allGroupNetworks as Array<{ cidr: string; node_id: string | null }>)
          .filter(row => row.node_id === null || row.node_id === node.id)
          .map(row => row.cidr)
      )]

      const extraLines = cidrsToPushRoutes(filteredCidrs)

      tasks.push({
        id: uuidv7(),
        node_id: node.id,
        action: 'write_client_ccd',
        payload: JSON.stringify({
          username: member.common_name,
          vpn_ip: member.vpn_ip,
          netmask,
          extra_lines: extraLines,
          public_key: member.client_cert ?? undefined,
        }),
        status: 'pending',
        created_at: new Date(),
      })
    }
  }

  if (tasks.length > 0) {
    await app.db('tasks').insert(tasks)
    app.log.info(`[node-networks] Re-enqueued ${tasks.length} CCD task(s) after node assignment change for network ${networkId}`)
  }
}

/**
 * Trigger update_server_config task to a specific node so server.conf
 * is updated with route directives for all networks assigned to that node.
 * This ensures OpenVPN/WireGuard can route traffic for those subnets.
 */
async function triggerNodeConfigUpdate(app: any, nodeId: string): Promise<void> {
  const node = await app.db('vpn_nodes').where({ id: nodeId }).first()
  if (!node) return

  // Get group subnets allocated for this node
  const groupSubnets = await app.db('group_node_dns_settings')
    .where({ node_id: nodeId })
    .whereNotNull('vpn_subnet')
    .pluck('vpn_subnet') as string[]

  // Get node-specific network CIDRs assigned to this node
  const nodeNetworkCidrs = await app.db('node_networks as nn')
    .join('networks as n', 'nn.network_id', 'n.id')
    .where('nn.node_id', nodeId)
    .pluck('n.cidr') as string[]

  // Merge into extra_routes so update-server-config agent adds `route` directives
  const allSubnets = [...new Set([...groupSubnets, ...nodeNetworkCidrs])]

  // Build config payload from node's existing config
  const configPayload = {
    port: node.port,
    protocol: node.protocol,
    tunnel_mode: node.tunnel_mode,
    vpn_network: node.vpn_network,
    vpn_netmask: node.vpn_netmask,
    dns_servers: node.dns_servers,
    push_routes: node.push_routes,
    compression: node.compression,
    cipher: node.cipher,
    keepalive_ping: node.keepalive_ping,
    keepalive_timeout: node.keepalive_timeout,
    custom_push_directives: node.custom_push_directives,
    group_subnets: allSubnets,
  }

  await app.db('tasks').insert({
    id: (await import('uuid')).v7(),
    node_id: nodeId,
    action: 'update_server_config',
    payload: JSON.stringify(configPayload),
    status: 'pending',
    created_at: new Date(),
  })

  app.log.info(`[node-networks] Scheduled update_server_config for node ${node.hostname} with ${nodeNetworkCidrs.length} node-network route(s)`)
}

export default networkRoutes
export type { Network }

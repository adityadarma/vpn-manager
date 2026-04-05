import type { FastifyPluginAsync } from 'fastify'
import { v7 as uuidv7 } from 'uuid'
import { cidrsToPushRoutes, getNetmask } from '../../services/ip-pool.service'

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
    { onRequest: [app.authenticate], schema: { tags: ['networks'], summary: 'List all VPN networks', security: [{ bearerAuth: [] }] } },
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
    { onRequest: [app.authenticate], schema: { tags: ['networks'], summary: 'Get network by ID', security: [{ bearerAuth: [] }] } },
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

  // Find all users in those groups that have a VPN IP
  const members = await app.db('user_groups as ug')
    .join('users as u', 'ug.user_id', 'u.id')
    .whereIn('ug.group_id', groupIds)
    .whereNotNull('u.vpn_ip')
    .distinct('u.id', 'u.username', 'u.vpn_ip', 'u.vpn_group_id')
    .select('u.id', 'u.username', 'u.vpn_ip', 'u.vpn_group_id')

  if (members.length === 0) return

  const onlineNodes = await app.db('vpn_nodes').where({ status: 'online' }).select('id', 'hostname')
  if (onlineNodes.length === 0) return

  const tasks: any[] = []

  for (const member of members) {
    // Get all group IDs for this user
    const userGroupIds = await app.db('user_groups')
      .where({ user_id: member.id })
      .pluck('group_id') as string[]

    // Get netmask from primary group
    let netmask = '255.255.255.0'
    if (member.vpn_group_id) {
      const primaryGroup = await app.db('groups').where({ id: member.vpn_group_id }).first()
      if (primaryGroup?.vpn_subnet) netmask = getNetmask(primaryGroup.vpn_subnet)
    }

    for (const node of onlineNodes) {
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

      // For wireguard: fetch public key
      const cert = await app.db('user_node_certificates')
        .where({ user_id: member.id, node_id: node.id })
        .first()
      const publicKey = cert?.client_cert ?? undefined

      tasks.push({
        id: uuidv7(),
        node_id: node.id,
        action: 'write_client_ccd',
        payload: JSON.stringify({
          username: member.username,
          vpn_ip: member.vpn_ip,
          netmask,
          extra_lines: extraLines,
          public_key: publicKey,
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

  // Get group subnets (existing behaviour)
  const allGroups = await app.db('groups').whereNotNull('vpn_subnet').select('vpn_subnet')
  const groupSubnets = allGroups.map((g: any) => g.vpn_subnet).filter(Boolean)

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

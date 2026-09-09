import type { FastifyPluginAsync } from 'fastify'
import { v7 as uuidv7 } from 'uuid'
import { getNetmask, parseCidr, cidrsToPushRoutes } from '../../services/ip-pool'
import { logAudit, getClientIp } from '../../utils/audit'
import { enqueueApplyPolicies } from '../policies/policies.routes'
interface Group {
  id: string
  name: string
  description: string | null
  vpn_subnet: string | null
  created_at: string
  updated_at: string
  member_count?: number
  network_count?: number
}

const groupRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/v1/groups — list all groups with member & network counts
  app.get(
    '/groups',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['groups'], summary: 'List all groups', security: [{ bearerAuth: [] }] } },
    async () => {
      const groups = await app.db('groups as g')
        .select(
          'g.id', 'g.name', 'g.description', 'g.vpn_subnet', 'g.created_at', 'g.updated_at',
          app.db.raw('COUNT(DISTINCT ug.user_id) as member_count'),
          app.db.raw('COUNT(DISTINCT gn.network_id) as network_count'),
        )
        .leftJoin('user_groups as ug', 'g.id', 'ug.group_id')
        .leftJoin('group_networks as gn', 'g.id', 'gn.group_id')
        .groupBy('g.id', 'g.name', 'g.description', 'g.vpn_subnet', 'g.created_at', 'g.updated_at')
        .orderBy('g.name')
      return groups
    },
  )

  // GET /api/v1/groups/:id — get group with its members and networks
  app.get<{ Params: { id: string } }>(
    '/groups/:id',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['groups'], summary: 'Get group details', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const group = await app.db('groups').where({ id: request.params.id }).first()
      if (!group) return reply.status(404).send({ error: 'Group not found' })

      const members = await app.db('user_groups as ug')
        .join('users as u', 'ug.user_id', 'u.id')
        .where('ug.group_id', request.params.id)
        .select('u.id', 'u.username', 'u.email', 'u.role', 'u.is_active')

      const networks = await app.db('group_networks as gn')
        .join('networks as n', 'gn.network_id', 'n.id')
        .where('gn.group_id', request.params.id)
        .select('n.id', 'n.name', 'n.cidr', 'n.description')

      return { ...group, members, networks }
    },
  )

  // POST /api/v1/groups
  app.post<{ Body: { name: string; description?: string; vpn_subnet: string } }>(
    '/groups',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['groups'], summary: 'Create a group', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const { name, description, vpn_subnet } = request.body
      if (!name?.trim()) return reply.status(400).send({ error: 'name is required' })
      if (!vpn_subnet?.trim()) return reply.status(400).send({ error: 'vpn_subnet is required' })

      // Validate subnet
        try { parseCidr(vpn_subnet) } catch (e: any) {
          return reply.status(400).send({ error: `Invalid vpn_subnet: ${e.message}` })
        }
        // Check not already in use by another group
        const conflict = await app.db('groups')
          .where({ vpn_subnet: vpn_subnet.trim() })
          .first()
        if (conflict) {
          return reply.status(409).send({ error: `Subnet ${vpn_subnet} is already assigned to group "${conflict.name}"` })
        }

      const id = uuidv7()
      await app.db('groups').insert({
        id,
        name: name.trim(),
        description: description?.trim() ?? null,
        vpn_subnet: vpn_subnet.trim(),
      })
      const created = await app.db('groups').where({ id }).first()

      const userObj = request.user as { id: string; username: string }
      await logAudit(app, {
        userId: userObj.id,
        username: userObj.username,
        action: 'group_create',
        resourceType: 'group',
        resourceId: id,
        ipAddress: getClientIp(request),
        metadata: { name: created.name, vpn_subnet }
      })

      return reply.status(201).send(created)
    },
  )

  // PATCH /api/v1/groups/:id
  app.patch<{ Params: { id: string }; Body: { name?: string; description?: string; vpn_subnet?: string | null } }>(
    '/groups/:id',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['groups'], summary: 'Update a group', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const { name, description, vpn_subnet } = request.body

      const group = await app.db('groups').where({ id: request.params.id }).first()
      if (!group) return reply.status(404).send({ error: 'Group not found' })

      // Validate new subnet
      if (vpn_subnet) {
        try { parseCidr(vpn_subnet) } catch (e: any) {
          return reply.status(400).send({ error: `Invalid vpn_subnet: ${e.message}` })
        }
        const conflict = await app.db('groups')
          .where({ vpn_subnet: vpn_subnet.trim() })
          .whereNot({ id: request.params.id })
          .first()
        if (conflict) {
          return reply.status(409).send({ error: `Subnet ${vpn_subnet} is already assigned to group "${conflict.name}"` })
        }
      }

      await app.db('groups')
        .where({ id: request.params.id })
        .update({
          ...(name ? { name: name.trim() } : {}),
          ...(description !== undefined ? { description: description?.trim() ?? null } : {}),
          ...(vpn_subnet !== undefined ? { vpn_subnet: vpn_subnet?.trim() ?? null } : {}),
          updated_at: new Date(),
        })
      const updatedGroup = await app.db('groups').where({ id: request.params.id }).first()
      if (vpn_subnet !== undefined) await enqueueApplyPolicies(app)

      const userObj = request.user as { id: string; username: string }
      await logAudit(app, {
        userId: userObj.id,
        username: userObj.username,
        action: 'group_update',
        resourceType: 'group',
        resourceId: request.params.id,
        ipAddress: getClientIp(request),
        metadata: { updated_fields: Object.keys(request.body) }
      })

      return updatedGroup
    },
  )

  // DELETE /api/v1/groups/:id
  app.delete<{ Params: { id: string } }>(
    '/groups/:id',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['groups'], summary: 'Delete a group', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const deleted = await app.db('groups').where({ id: request.params.id }).delete()
      if (!deleted) return reply.status(404).send({ error: 'Group not found' })

      const userObj = request.user as { id: string; username: string }
      await logAudit(app, {
        userId: userObj.id,
        username: userObj.username,
        action: 'group_delete',
        resourceType: 'group',
        resourceId: request.params.id,
        ipAddress: getClientIp(request),
      })

      return reply.status(204).send()
    },
  )

  // POST /api/v1/groups/:id/members — add user to group (user can only be in 1 group at a time)
  app.post<{ Params: { id: string }; Body: { user_id: string } }>(
    '/groups/:id/members',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['groups'], summary: 'Add user to group', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const { user_id } = request.body
      if (!user_id) return reply.status(400).send({ error: 'user_id required' })

      const group = await app.db('groups').where({ id: request.params.id }).first()
      if (!group) return reply.status(404).send({ error: 'Group not found' })

      const user = await app.db('users').where({ id: user_id }).first()
      if (!user) return reply.status(404).send({ error: 'User not found' })

      // Group membership is user-scoped, while VPN addresses remain credential-scoped.
      const existing = await app.db('user_groups').where({ user_id, group_id: request.params.id }).first()
      if (existing) {
        return reply.status(200).send({ ok: true })
      }

      // A user can belong to one primary group. Keep credential IPs, but change
      // their group association so later per-node subnet allocation can update them.
      const oldMembership = await app.db('user_groups').where({ user_id }).first()
      if (oldMembership) {
        await app.db('user_groups').where({ user_id }).delete()
      }

      // Add to new group
      await app.db('user_groups').insert({ group_id: request.params.id, user_id })

      await app.db('user_node_certificates').where({ user_id }).update({ group_id: request.params.id, updated_at: new Date() })

      await enqueueApplyPolicies(app)

      const userObj = request.user as { id: string; username: string }
      await logAudit(app, {
        userId: userObj.id,
        username: userObj.username,
        action: 'group_member_add',
        resourceType: 'group',
        resourceId: request.params.id,
        ipAddress: getClientIp(request),
          metadata: { target_user_id: user_id }
      })

      return reply.status(201).send({ ok: true })
    },
  )

  // DELETE /api/v1/groups/:id/members/:userId — remove user from group
  app.delete<{ Params: { id: string; userId: string } }>(
    '/groups/:id/members/:userId',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['groups'], summary: 'Remove user from group', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const { id: groupId, userId } = request.params

      const deleted = await app.db('user_groups').where({ group_id: groupId, user_id: userId }).delete()

      if (deleted) {
        await app.db('user_node_certificates')
          .where({ user_id: userId, group_id: groupId })
          .update({ group_id: null, updated_at: new Date() })

        await enqueueApplyPolicies(app)

        const userObj = request.user as { id: string; username: string }
        await logAudit(app, {
          userId: userObj.id,
          username: userObj.username,
          action: 'group_member_remove',
          resourceType: 'group',
          resourceId: groupId,
          ipAddress: getClientIp(request),
          metadata: { target_user_id: userId },
        })
      }

      return reply.status(204).send()
    },
  )

  // POST /api/v1/groups/:id/networks — assign network to group
  app.post<{ Params: { id: string }; Body: { network_id: string } }>(
    '/groups/:id/networks',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['groups'], summary: 'Assign network to group', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const { network_id } = request.body
      if (!network_id) return reply.status(400).send({ error: 'network_id required' })
      await app.db('group_networks')
        .insert({ group_id: request.params.id, network_id })
        .onConflict(['group_id', 'network_id']).ignore()

      // Re-enqueue CCD tasks so members get updated push routes
      await reenqueueGroupCcdTasks(app, request.params.id)

      const userObj = request.user as { id: string; username: string }
      await logAudit(app, {
        userId: userObj.id,
        username: userObj.username,
        action: 'group_network_add',
        resourceType: 'group',
        resourceId: request.params.id,
        ipAddress: getClientIp(request),
        metadata: { network_id }
      })

      return reply.status(201).send({ ok: true })
    },
  )

  // DELETE /api/v1/groups/:id/networks/:networkId
  app.delete<{ Params: { id: string; networkId: string } }>(
    '/groups/:id/networks/:networkId',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['groups'], summary: 'Remove network from group', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      await app.db('group_networks')
        .where({ group_id: request.params.id, network_id: request.params.networkId })
        .delete()

      // Re-enqueue CCD tasks so members lose the removed route
      await reenqueueGroupCcdTasks(app, request.params.id)

      const userObj = request.user as { id: string; username: string }
      await logAudit(app, {
        userId: userObj.id,
        username: userObj.username,
        action: 'group_network_remove',
        resourceType: 'group',
        resourceId: request.params.id,
        ipAddress: getClientIp(request),
        metadata: { network_id: request.params.networkId }
      })

      return reply.status(204).send()
    },
  )

  // POST /api/v1/groups/:id/assign-ips
  // Credential addresses are allocated per node. Group subnet allocation moves to
  // group-node settings in Step 3, so the former global-user allocator is unsafe.
  app.post<{ Params: { id: string } }>(
    '/groups/:id/assign-ips',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['groups'], summary: 'Bulk assign VPN IPs to all group members', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      return reply.status(409).send({
        error: 'Conflict',
        message: 'Global group IP allocation has been retired; create credentials on target nodes instead',
      })
    },
  )
}

export default groupRoutes
export type { Group }

/**
 * Re-enqueue write_client_ccd tasks for all members of a group that have a VPN IP.
 * Called when networks are added or removed from a group, so CCD files
 * are updated with current push routes on all online nodes.
 */
async function reenqueueGroupCcdTasks(app: any, groupId: string): Promise<void> {
  const members = await app.db('user_node_certificates as c')
    .join('user_groups as ug', 'c.user_id', 'ug.user_id')
    .where('ug.group_id', groupId)
    .where({ 'c.is_revoked': false })
    .whereNotNull('c.vpn_ip')
    .select('c.user_id', 'c.node_id', 'c.common_name', 'c.vpn_ip', 'c.client_cert', 'c.group_id')

  if (members.length === 0) return

  const tasks: any[] = []

  for (const member of members) {
    // Get all networks from all the user's groups
    const userGroupIds = await app.db('user_groups')
      .where({ user_id: member.user_id })
      .pluck('group_id') as string[]

    const networkCidrs = await app.db('group_networks as gn')
      .join('networks as n', 'gn.network_id', 'n.id')
      .whereIn('gn.group_id', userGroupIds)
      .distinct('n.cidr')
      .pluck('n.cidr') as string[]

    const extraLines = cidrsToPushRoutes(networkCidrs)

    // Get netmask from primary group
    let netmask = '255.255.255.0'
    if (member.group_id) {
      const primaryGroup = await app.db('groups').where({ id: member.group_id }).first()
      if (primaryGroup?.vpn_subnet) netmask = getNetmask(primaryGroup.vpn_subnet)
    }

    const node = await app.db('vpn_nodes').where({ id: member.node_id, status: 'online' }).first()
    if (node) {
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
    app.log.info(`[ip-pool] Re-enqueued ${tasks.length} CCD task(s) after network change on group ${groupId}`)
  }
}

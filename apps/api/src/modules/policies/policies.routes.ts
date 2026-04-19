import type { FastifyPluginAsync } from 'fastify'
import { v7 as uuidv7 } from 'uuid'
import { CreatePolicySchema } from '@vpn/shared'
import { logAudit, getClientIp } from '../../utils/audit'

const policyRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/v1/policies
  app.get(
    '/policies',
    { onRequest: [app.authenticate], schema: { tags: ['policies'], summary: 'List all network policies', security: [{ bearerAuth: [] }] } },
    async () => {
      const policies = await app.db('vpn_policies as p')
        .leftJoin('users as u', 'p.user_id', 'u.id')
        .leftJoin('groups as g', 'p.group_id', 'g.id')
        .leftJoin('vpn_nodes as n', 'p.node_id', 'n.id')
        .select(
          'p.id',
          'p.user_id',
          'p.group_id',
          'p.node_id',
          app.db.raw('p.user_id as "userId"'),
          app.db.raw('p.group_id as "groupId"'),
          app.db.raw('p.node_id as "nodeId"'),
          'p.target_network',
          'p.protocol',
          'p.target_port',
          'p.action',
          'p.priority',
          'p.description',
          'p.created_at',
          'u.username',
          'g.name as group_name',
          'n.hostname as node_name'
        )
        .orderBy('p.priority', 'asc')
      
      return policies
    },
  )

  // POST /api/v1/policies
  app.post(
    '/policies',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['policies'], summary: 'Create a network policy', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const input = CreatePolicySchema.parse(request.body)
      
      const id = uuidv7()
      await app.db('vpn_policies').insert({
        id,
        user_id: input.userId ?? null,
        group_id: input.groupId ?? null,
        node_id: input.nodeId ?? null,
        target_network: input.targetNetwork,
        protocol: input.protocol ?? 'all',
        target_port: input.targetPort ?? null,
        action: input.action ?? 'allow',
        priority: input.priority ?? 100,
        description: input.description ?? null,
      })

      // Sync policies to agent — only target the specific node if policy is node-scoped
      await enqueueApplyPolicies(app, input.nodeId ?? null)

      const userObj = request.user as { id: string; username: string }
      await logAudit(app, {
        userId: userObj.id,
        username: userObj.username,
        action: 'policy_create',
        resourceType: 'policy',
        resourceId: id,
        ipAddress: getClientIp(request),
        metadata: {
          target_network: input.targetNetwork,
          action: input.action ?? 'allow',
          protocol: input.protocol,
          user_id: input.userId,
          group_id: input.groupId,
          node_id: input.nodeId
        }
      })

      return reply.status(201).send(await app.db('vpn_policies').where({ id }).first())
    },
  )

  // DELETE /api/v1/policies/:id
  app.delete<{ Params: { id: string } }>(
    '/policies/:id',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['policies'], summary: 'Delete a network policy', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const policyBeforeDelete = await app.db('vpn_policies').where({ id: request.params.id }).first()
      const deleted = await app.db('vpn_policies').where({ id: request.params.id }).delete()
      if (!deleted) return reply.status(404).send({ error: 'Not Found', message: 'Policy not found' })

      // Sync policies to agent — only target the specific node if policy was node-scoped
      await enqueueApplyPolicies(app, policyBeforeDelete?.node_id ?? null)

      const userObj = request.user as { id: string; username: string }
      await logAudit(app, {
        userId: userObj.id,
        username: userObj.username,
        action: 'policy_delete',
        resourceType: 'policy',
        resourceId: request.params.id,
        ipAddress: getClientIp(request),
      })

      return reply.status(204).send()
    },
  )
}

/**
 * Trigger apply_network_policy task on the relevant node(s).
 *
 * @param affectedNodeId - when set, only that node receives the task (node-specific policy).
 *                         Pass null/undefined for global policies → all online nodes get a task.
 */
async function enqueueApplyPolicies(app: any, affectedNodeId?: string | null) {
  // Fetch fully resolved policies (joining users and groups to get VPN IPs/Subnets)
  const policies = await app.db('vpn_policies as p')
    .leftJoin('users as u', 'p.user_id', 'u.id')
    .leftJoin('groups as g', 'p.group_id', 'g.id')
    .select(
      'p.id',
      'p.action',
      'p.protocol',
      'p.target_network',
      'p.target_port',
      'p.priority',
      'p.user_id',
      'p.group_id',
      'p.node_id',
      'u.vpn_ip as user_ip',
      'g.vpn_subnet as group_subnet'
    )
    .orderBy('p.priority', 'asc')

  // Determine which nodes should receive the task:
  // - node-specific policy → only that node
  // - global policy (node_id = null) → all online nodes
  let targetNodes
  if (affectedNodeId) {
    targetNodes = await app.db('vpn_nodes')
      .where({ id: affectedNodeId, status: 'online' })
      .select('id', 'firewall_engine', 'vpn_type')
    if (targetNodes.length === 0) {
      app.log.warn(`[policy] Target node ${affectedNodeId} is offline — task will be applied when it comes online`)
      // Still queue the task so it's picked up when the node reconnects
      targetNodes = await app.db('vpn_nodes')
        .where({ id: affectedNodeId })
        .select('id', 'firewall_engine', 'vpn_type')
    }
  } else {
    targetNodes = await app.db('vpn_nodes').where({ status: 'online' }).select('id', 'firewall_engine', 'vpn_type')
  }

  if (targetNodes.length === 0) return

  const tasks = []

  for (const node of targetNodes) {
    // Filter policies for this specific node (include globals where node_id is null)
    const nodePolicies = policies.filter((p: any) => p.node_id === null || p.node_id === node.id)

    tasks.push({
      id: uuidv7(),
      node_id: node.id,
      action: 'apply_network_policy',
      payload: JSON.stringify({ policies: nodePolicies, firewall_engine: node.firewall_engine, vpn_type: node.vpn_type }),
      status: 'pending',
      created_at: new Date(),
    })
  }

  if (tasks.length > 0) {
    await app.db('tasks').insert(tasks)
    app.log.info(`[policy] Queued apply_network_policy to ${tasks.length} node(s)`)
  }
}

export default policyRoutes

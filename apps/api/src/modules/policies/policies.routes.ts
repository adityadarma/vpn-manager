import type { FastifyPluginAsync } from 'fastify'
import crypto from 'node:crypto'
import { CreatePolicySchema } from '@vpn/shared'

const policyRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/v1/policies
  app.get(
    '/policies',
    { onRequest: [app.authenticate], schema: { tags: ['policies'], summary: 'List all network policies', security: [{ bearerAuth: [] }] } },
    async () => {
      const policies = await app.db('vpn_policies as p')
        .leftJoin('users as u', 'p.user_id', 'u.id')
        .leftJoin('groups as g', 'p.group_id', 'g.id')
        .select(
          'p.id',
          'p.user_id',
          'p.group_id',
          'p.target_network',
          'p.protocol',
          'p.target_port',
          'p.action',
          'p.priority',
          'p.description',
          'p.created_at',
          'u.username',
          'g.name as group_name'
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
      
      const id = crypto.randomUUID()
      await app.db('vpn_policies').insert({
        id,
        user_id: input.userId ?? null,
        group_id: input.groupId ?? null,
        target_network: input.targetNetwork,
        protocol: input.protocol ?? 'all',
        target_port: input.targetPort ?? null,
        action: input.action ?? 'allow',
        priority: input.priority ?? 100,
        description: input.description ?? null,
      })

      // Sync policies to agent
      await enqueueApplyPolicies(app)

      return reply.status(201).send(await app.db('vpn_policies').where({ id }).first())
    },
  )

  // DELETE /api/v1/policies/:id
  app.delete<{ Params: { id: string } }>(
    '/policies/:id',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['policies'], summary: 'Delete a network policy', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const deleted = await app.db('vpn_policies').where({ id: request.params.id }).delete()
      if (!deleted) return reply.status(404).send({ error: 'Not Found', message: 'Policy not found' })

      // Sync policies to agent
      await enqueueApplyPolicies(app)

      return reply.status(204).send()
    },
  )
}

/**
 * Trigger apply_network_policy task on all online nodes.
 * The payload doesn't need all policies; the agent will fetch them from the database directly if needed,
 * or we just pass them here. Better pass it as payload to be stateless.
 */
async function enqueueApplyPolicies(app: any) {
  // Fetch fully resolved policies (joining users and groups to get VPN IPs/Subnets)
  // Because the agent needs the actual source IPs/CIDRs to write iptables.
  
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
      'u.vpn_ip as user_ip',
      'g.vpn_subnet as group_subnet'
    )
    .orderBy('p.priority', 'asc')

  const onlineNodes = await app.db('vpn_nodes').where({ status: 'online' }).select('id')
  if (onlineNodes.length === 0) return

  const payloadStr = JSON.stringify({ policies })
  const tasks = onlineNodes.map((node: { id: string }) => ({
    id: crypto.randomUUID(),
    node_id: node.id,
    action: 'apply_network_policy',
    payload: payloadStr,
    status: 'pending',
    created_at: new Date(),
  }))

  await app.db('tasks').insert(tasks)
  app.log.info(`[policy] Queued apply_network_policy to ${tasks.length} node(s) with ${policies.length} rules`)
}

export default policyRoutes

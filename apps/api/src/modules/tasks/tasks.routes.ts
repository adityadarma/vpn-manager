import type { FastifyPluginAsync } from 'fastify'
import { v7 as uuidv7 } from 'uuid'
import { TaskResultSchema, TASK_ACTIONS, validateTaskPayload } from '@vpn/shared'
import { redactTaskRows, stripTaskPayloadSecrets } from '../../utils/task-payload'

const taskRoutes: FastifyPluginAsync = async (app) => {
  // Node-token authentication comes from plugins/node-auth.ts as
  // app.authenticateNodeToken — shared with nodes.routes.ts.

  // GET /api/v1/tasks  — list all tasks
  app.get(
    '/tasks',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['tasks'], summary: 'List all tasks', security: [{ bearerAuth: [] }] } },
    async (request) => {
      const query = request.query as { nodeId?: string; status?: string; page?: string; limit?: string }
      const paginated = query.page !== undefined || query.limit !== undefined
      const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1)
      const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit ?? '25', 10) || 25))
      const builder = app.db('tasks as t')
        .join('vpn_nodes as n', 't.node_id', 'n.id')
        .select('t.*', 'n.hostname as node_hostname')
        .orderBy('t.created_at', 'desc')

      if (query.nodeId) builder.where('t.node_id', query.nodeId)
      if (query.status) builder.where('t.status', query.status)

      // `t.*` includes the raw payload, which for generate_client_cert carries
      // the private-key passphrase. Mask it before it leaves the API.
      // Preserve the legacy array response unless a caller explicitly asks for
      // pagination. Agents and existing scripts use the unpaginated endpoint.
      if (!paginated) {
        const rows = await builder.limit(100)
        return redactTaskRows(rows)
      }

      const rows = await builder.clone().limit(limit).offset((page - 1) * limit)
      const countBuilder = app.db('tasks as t')
      if (query.nodeId) countBuilder.where('t.node_id', query.nodeId)
      if (query.status) countBuilder.where('t.status', query.status)
      const totalRow = await countBuilder.count<{ count: string }>('* as count').first()
      const total = Number(totalRow?.count ?? 0)

      const statusBuilder = app.db('tasks as t').select('t.status').count<{ count: string }>('* as count').groupBy('t.status')
      if (query.nodeId) statusBuilder.where('t.node_id', query.nodeId)
      const statusRows = await statusBuilder as unknown as Array<{ status: string; count: string | number }>
      const statusCounts = Object.fromEntries(statusRows.map((row) => [row.status, Number(row.count)]))

      return {
        tasks: redactTaskRows(rows),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        status_counts: statusCounts,
      }
    },
  )

  // POST /api/v1/tasks — create a new task
  app.post<{ Body: { node_id: string; action: string; payload: Record<string, unknown> } }>(
    '/tasks',
    { 
      onRequest: [app.authenticateAdmin], 
      schema: { 
        tags: ['tasks'], 
        summary: 'Create a new task',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['node_id', 'action', 'payload'],
          properties: {
            node_id: { type: 'string', description: 'Node ID to execute task on' },
            action: {
              type: 'string',
              enum: TASK_ACTIONS,
              description: 'Task action type (must be a known action)',
            },
            payload: { type: 'object', description: 'Task payload data (validated per action)' }
          }
        }
      } 
    },
    async (request, reply) => {
      const { node_id, action, payload } = request.body

      // Tasks are executed as root on the target node, so the action must be a
      // known one and the payload must match that action's expected shape.
      // Without this an admin could reach every agent code path with arbitrary
      // values (arbitrary OpenVPN directives, unvalidated firewall operands…).
      const validation = validateTaskPayload(action, payload)
      if (!validation.ok) {
        app.log.warn(
          `[tasks] Rejected task creation by user ${(request.user as { id?: string })?.id}: ${validation.error}`,
        )
        return reply.status(400).send({ error: 'Bad Request', message: validation.error })
      }

      // Validate node exists
      const node = await app.db('vpn_nodes').where({ id: node_id }).first()
      if (!node) {
        return reply.status(404).send({ error: 'Not Found', message: 'Node not found' })
      }

      // Create task — persist the validated/normalised payload, not the raw body
      const taskId = uuidv7()
      await app.db('tasks').insert({
        id: taskId,
        node_id,
        action: validation.action,
        payload: JSON.stringify(validation.payload),
        status: 'pending',
        result: null,
        error_message: null,
        created_at: new Date(),
        completed_at: null
      })

      app.log.info(`[tasks] Created task ${taskId} for node ${node_id}: ${action}`)

      return reply.status(201).send({
        id: taskId,
        node_id,
        action,
        status: 'pending',
        created_at: new Date().toISOString()
      })
    },
  )

  // POST /api/v1/tasks/:id/result  (called by agent)
  app.post<{ Params: { id: string } }>(
    '/tasks/:id/result',
    { 
      schema: { tags: ['tasks'], summary: 'Report task result (agent)' },
    },
    async (request, reply) => {
      const authenticatedNode = await app.authenticateNodeToken(request, reply)
      if (!authenticatedNode) return

      const { id } = request.params
      app.log.info(`[tasks] Received result for task ${id}`)
      
      const input = TaskResultSchema.parse(request.body)

      const task = await app.db('tasks').where({ id }).first()
      if (!task) {
        app.log.warn(`[tasks] Task ${id} not found`)
        return reply.status(404).send({ error: 'Not Found', message: 'Task not found' })
      }
      if (task.node_id !== authenticatedNode.id) {
        app.log.warn(`[tasks] Node ${authenticatedNode.id} attempted to update task ${id} owned by ${task.node_id}`)
        return reply.status(403).send({ error: 'Forbidden', message: 'Task does not belong to this node' })
      }

      // A result may only be reported once. Without this a node could re-report
      // its own completed task and overwrite `result` / `error_message` — for
      // example rewriting a recorded failure as a success.
      //
      // The status filter is part of the UPDATE rather than a separate `if`, so
      // two concurrent reports cannot both pass a check and then both write:
      // the second one matches zero rows.
      const updated = await app.db('tasks')
        .where({ id })
        .whereIn('status', ['pending', 'running'])
        .update({
          status: input.status === 'success' ? 'done' : 'failed',
          result: JSON.stringify(input.result ?? {}),
          error_message: input.errorMessage ?? null,
          completed_at: new Date(),
        })

      if (updated === 0) {
        const current = await app.db('tasks').where({ id }).first()
        app.log.warn(
          `[tasks] Node ${authenticatedNode.id} re-reported result for task ${id} already in state '${current?.status}'`,
        )
        return reply.status(409).send({
          error: 'Conflict',
          message: `Task already finalised with status '${current?.status}'`,
        })
      }

      if (task.action === 'sync_group_dns') {
        const result = input.result ?? {}
        const revision = typeof result['revision'] === 'number'
          ? result['revision']
          : JSON.parse(task.payload || '{}').revision
        const revisionStatus = input.status === 'success' ? 'healthy' : 'failed'
        await app.db('node_dns_revisions')
          .where({ task_id: id })
          .update({
            status: revisionStatus,
            error_message: input.errorMessage ?? null,
            applied_at: input.status === 'success' ? new Date() : null,
            updated_at: new Date(),
          })
        await app.db('vpn_nodes').where({ id: authenticatedNode.id }).update({
          dns_config_revision: input.status === 'success' ? revision : app.db.raw('dns_config_revision'),
          dns_config_hash: input.status === 'success' && typeof result['config_hash'] === 'string' ? result['config_hash'] : app.db.raw('dns_config_hash'),
          dns_sync_status: revisionStatus,
          dns_last_sync_error: input.errorMessage ?? null,
          dns_last_synced_at: input.status === 'success' ? new Date() : app.db.raw('dns_last_synced_at'),
        })
      }

      // The agent has consumed the payload, so any secret in it (e.g. the
      // private-key passphrase for generate_client_cert) is no longer needed.
      // Drop it rather than leaving cleartext in the database indefinitely.
      // Best-effort: this must not fail the agent's result report.
      try {
        await stripTaskPayloadSecrets(app.db, id)
      } catch (err) {
        app.log.warn(`[tasks] Failed to strip secrets from task ${id} payload: ${(err as Error).message}`)
      }

      app.log.info(`[tasks] Task ${id} updated to ${input.status}`)
      return { ok: true }
    },
  )
}

export default taskRoutes

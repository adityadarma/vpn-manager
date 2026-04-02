import type { FastifyPluginAsync } from 'fastify'
import { v7 as uuidv7 } from 'uuid'
import { TaskResultSchema } from '@vpn/shared'

const taskRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/v1/tasks  — list all tasks
  app.get(
    '/tasks',
    { onRequest: [app.authenticate], schema: { tags: ['tasks'], summary: 'List all tasks', security: [{ bearerAuth: [] }] } },
    async (request) => {
      const query = request.query as { nodeId?: string; status?: string }
      const builder = app.db('tasks as t')
        .join('vpn_nodes as n', 't.node_id', 'n.id')
        .select('t.*', 'n.hostname as node_hostname')
        .orderBy('t.created_at', 'desc')
        .limit(100)

      if (query.nodeId) builder.where('t.node_id', query.nodeId)
      if (query.status) builder.where('t.status', query.status)

      return builder
    },
  )

  // POST /api/v1/tasks — create a new task
  app.post<{ Body: { node_id: string; action: string; payload: Record<string, unknown> } }>(
    '/tasks',
    { 
      onRequest: [app.authenticate], 
      schema: { 
        tags: ['tasks'], 
        summary: 'Create a new task',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['node_id', 'action', 'payload'],
          properties: {
            node_id: { type: 'string', description: 'Node ID to execute task on' },
            action: { type: 'string', description: 'Task action type' },
            payload: { type: 'object', description: 'Task payload data' }
          }
        }
      } 
    },
    async (request, reply) => {
      const { node_id, action, payload } = request.body

      // Validate node exists
      const node = await app.db('vpn_nodes').where({ id: node_id }).first()
      if (!node) {
        return reply.status(404).send({ error: 'Not Found', message: 'Node not found' })
      }

      // Create task
      const taskId = uuidv7()
      await app.db('tasks').insert({
        id: taskId,
        node_id,
        action,
        payload: JSON.stringify(payload),
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
      onRequest: async (request) => {
        app.log.info(`[tasks] POST /tasks/${request.params.id}/result - Headers: ${JSON.stringify(request.headers)}`)
      }
    },
    async (request, reply) => {
      const { id } = request.params
      app.log.info(`[tasks] Received result for task ${id}`)
      app.log.info(`[tasks] Body: ${JSON.stringify(request.body)}`)
      
      const input = TaskResultSchema.parse(request.body)

      const task = await app.db('tasks').where({ id }).first()
      if (!task) {
        app.log.warn(`[tasks] Task ${id} not found`)
        return reply.status(404).send({ error: 'Not Found', message: 'Task not found' })
      }

      await app.db('tasks').where({ id }).update({
        status: input.status === 'success' ? 'done' : 'failed',
        result: JSON.stringify(input.result ?? {}),
        error_message: input.errorMessage ?? null,
        completed_at: new Date(),
      })

      app.log.info(`[tasks] Task ${id} updated to ${input.status}`)
      return { ok: true }
    },
  )
}

export default taskRoutes

import type { FastifyPluginAsync } from 'fastify'
import { v7 as uuidv7 } from 'uuid'

interface Network {
  id: string
  name: string
  cidr: string
  description: string | null
  created_at: string
  updated_at: string
  group_count?: number
}

const networkRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/v1/networks — list all networks with group count
  app.get(
    '/networks',
    { onRequest: [app.authenticate], schema: { tags: ['networks'], summary: 'List all VPN networks', security: [{ bearerAuth: [] }] } },
    async () => {
      return app.db('networks as n')
        .select(
          'n.id', 'n.name', 'n.cidr', 'n.description', 'n.created_at', 'n.updated_at',
          app.db.raw('COUNT(DISTINCT gn.group_id) as group_count'),
        )
        .leftJoin('group_networks as gn', 'n.id', 'gn.network_id')
        .groupBy('n.id', 'n.name', 'n.cidr', 'n.description', 'n.created_at', 'n.updated_at')
        .orderBy('n.name')
    },
  )

  // GET /api/v1/networks/:id — get network with its assigned groups
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

      return { ...network, groups }
    },
  )

  // POST /api/v1/networks
  app.post<{ Body: { name: string; cidr: string; description?: string } }>(
    '/networks',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['networks'], summary: 'Create a network segment', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const { name, cidr, description } = request.body
      if (!name?.trim() || !cidr?.trim()) {
        return reply.status(400).send({ error: 'name and cidr are required' })
      }

      // Basic CIDR validation
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
      const created = await app.db('networks').where({ id }).first()
      return reply.status(201).send(created)
    },
  )

  // PATCH /api/v1/networks/:id
  app.patch<{ Params: { id: string }; Body: { name?: string; cidr?: string; description?: string } }>(
    '/networks/:id',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['networks'], summary: 'Update a network', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const { name, cidr, description } = request.body
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
      return app.db('networks').where({ id: request.params.id }).first()
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
}

export default networkRoutes
export type { Network }

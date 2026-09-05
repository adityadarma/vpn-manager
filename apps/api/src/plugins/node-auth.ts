import fp from 'fastify-plugin'
import type { FastifyRequest, FastifyReply } from 'fastify'

/**
 * A registered VPN node row, as returned by node-token authentication.
 * Loosely typed on purpose — callers only rely on `id` plus config columns.
 */
export type AuthenticatedNode = Record<string, any>

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Authenticates an agent by its `Authorization: Bearer <node token>` header.
     *
     * Returns the node row, or `null` after having already sent a 401 — so
     * callers must `return` immediately when they get `null`:
     *
     *     const node = await app.authenticateNodeToken(request, reply)
     *     if (!node) return
     *
     * This is a decorator rather than a per-route hook because several agent
     * endpoints accept a node token *and* need the resolved node inside the
     * handler, which `onRequest` cannot hand back.
     *
     * Previously this logic was copy-pasted in four places, two of which
     * forgot to `.trim()` the token. Keeping one implementation means a new
     * agent route cannot silently ship a subtly different check.
     */
    authenticateNodeToken: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<AuthenticatedNode | null>
  }
}

export default fp(async (app) => {
  app.decorate(
    'authenticateNodeToken',
    async (request: FastifyRequest, reply: FastifyReply): Promise<AuthenticatedNode | null> => {
      const authHeader = request.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        reply.status(401).send({ error: 'Unauthorized', message: 'Node token required' })
        return null
      }

      // Trim consistently: agents read this from an env file or shell variable,
      // where a stray newline is easy to introduce.
      const token = authHeader.substring(7).trim()
      if (!token) {
        reply.status(401).send({ error: 'Unauthorized', message: 'Node token required' })
        return null
      }

      const node = await app.db('vpn_nodes').where({ token }).first()
      if (!node) {
        reply.status(401).send({ error: 'Unauthorized', message: 'Invalid node token' })
        return null
      }

      return node
    },
  )
})

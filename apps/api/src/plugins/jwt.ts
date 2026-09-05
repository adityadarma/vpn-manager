import fp from 'fastify-plugin'
import fastifyJwt from '@fastify/jwt'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { isTokenRevoked, isUserTokenRevoked } from '../services/token-revocation'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    authenticateAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    /**
     * True if the request's token has been revoked.
     *
     * Exposed for routes that cannot use the `authenticate` decorator because
     * they accept more than one credential type (e.g. POST /nodes/register,
     * which allows an admin JWT *or* a registration key) and therefore call
     * `request.jwtVerify()` themselves. Those routes must still honour the
     * revocation list.
     */
    isTokenRevokedForRequest: (request: FastifyRequest) => Promise<boolean>
  }
}

interface JwtPluginOptions {
  secret: string
  expiresIn: string
}

export default fp(async (app, options: JwtPluginOptions) => {
  await app.register(fastifyJwt, {
    secret: options.secret,
    sign: { expiresIn: options.expiresIn },
    // Read token from httpOnly cookie "vpn_token"
    cookie: {
      cookieName: 'vpn_token',
      signed: false,
    },
  })

  /**
   * Check if the raw token or user-level revocation applies.
   *
   * Async because revocations are now persisted in the database rather than an
   * in-memory Map, so a logout survives restarts and applies across replicas.
   */
  async function checkBlacklist(request: FastifyRequest): Promise<boolean> {
    // Get raw token from cookie or Authorization header
    const rawToken =
      request.cookies?.['vpn_token'] ||
      request.headers.authorization?.replace('Bearer ', '')

    if (rawToken && (await isTokenRevoked(app.db, rawToken))) {
      return true
    }

    // Check user-level revocation (role change, forced logout)
    const payload = request.user as { id?: string; iat?: number }
    if (payload?.id && payload?.iat) {
      if (await isUserTokenRevoked(app.db, payload.id, payload.iat * 1000)) {
        return true
      }
    }

    return false
  }

  // Same check, exposed for routes that verify the JWT themselves.
  app.decorate('isTokenRevokedForRequest', checkBlacklist)

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify()
    } catch {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' })
    }

    if (await checkBlacklist(request)) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Token has been revoked' })
    }
  })

  app.decorate('authenticateAdmin', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify()
    } catch {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' })
    }

    if (await checkBlacklist(request)) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Token has been revoked' })
    }

    const user = request.user as { role: string }
    if (user.role !== 'admin') {
      return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' })
    }
  })
})

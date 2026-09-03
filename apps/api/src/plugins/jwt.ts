import fp from 'fastify-plugin'
import fastifyJwt from '@fastify/jwt'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { isTokenRevoked, isUserTokenRevoked } from '../services/token-blacklis'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    authenticateAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
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
   */
  function checkBlacklist(request: FastifyRequest): boolean {
    // Get raw token from cookie or Authorization header
    const rawToken =
      request.cookies?.['vpn_token'] ||
      request.headers.authorization?.replace('Bearer ', '')

    if (rawToken && isTokenRevoked(rawToken)) {
      return true
    }

    // Check user-level revocation (role change, forced logout)
    const payload = request.user as { id?: string; iat?: number }
    if (payload?.id && payload?.iat) {
      if (isUserTokenRevoked(payload.id, payload.iat * 1000)) {
        return true
      }
    }

    return false
  }

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify()
    } catch {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' })
    }

    if (checkBlacklist(request)) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Token has been revoked' })
    }
  })

  app.decorate('authenticateAdmin', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify()
    } catch {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' })
    }

    if (checkBlacklist(request)) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Token has been revoked' })
    }

    const user = request.user as { role: string }
    if (user.role !== 'admin') {
      return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' })
    }
  })
})

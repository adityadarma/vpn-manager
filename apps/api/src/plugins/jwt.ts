import fp from 'fastify-plugin'
import fastifyJwt from '@fastify/jwt'
import type { FastifyRequest, FastifyReply } from 'fastify'

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

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify()
    } catch {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' })
    }
  })

  app.decorate('authenticateAdmin', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify()
    } catch {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' })
    }
    const user = request.user as { role: string }
    if (user.role !== 'admin') {
      return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' })
    }
  })
})

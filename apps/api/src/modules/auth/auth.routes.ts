import type { FastifyPluginAsync } from 'fastify'
import bcrypt from 'bcryptjs'
import { LoginSchema } from '@vpn/shared'

const authRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/v1/auth/login
  app.post(
    '/auth/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['auth'],
        summary: 'Login and get JWT token',
        body: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string' },
            password: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { username, password } = LoginSchema.parse(request.body)

      const user = await app.db('users')
        .where({ username, is_active: true })
        .first()

      if (!user) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid credentials' })
      }

      const validPassword = await bcrypt.compare(password, user.password)
      if (!validPassword) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Invalid credentials' })
      }

      // Update last_login
      const now = new Date()
      await app.db('users').where({ id: user.id }).update({ last_login: now })

      const token = app.jwt.sign({
        id: user.id,
        username: user.username,
        role: user.role,
      })

      // Parse expiresIn to seconds for cookie maxAge
      // JWT_EXPIRES_IN format: '7d', '24h', '3600s', etc.
      const parseExpiresIn = (v: string): number => {
        const n = parseInt(v)
        if (v.endsWith('d')) return n * 86400
        if (v.endsWith('h')) return n * 3600
        if (v.endsWith('m')) return n * 60
        return n // assume seconds
      }
      const maxAge = parseExpiresIn(app.jwt.options.sign?.expiresIn as string ?? '7d')

      reply.setCookie('vpn_token', token, {
        httpOnly: true,
        secure: process.env['NODE_ENV'] === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge,
      })

      return reply.send({
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          lastLogin: now.toISOString(),
        },
      })
    },
  )

  // POST /api/v1/auth/logout
  app.post(
    '/auth/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Logout and clear session cookie',
      },
    },
    async (_request, reply) => {
      reply.clearCookie('vpn_token', { path: '/' })
      return reply.send({ message: 'Logged out successfully' })
    },
  )

  // GET /api/v1/auth/me
  app.get(
    '/auth/me',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'Get current user info',
        security: [{ bearerAuth: [] }],
      },
    },
    async (request) => {
      const payload = request.user as { id: string }
      const user = await app.db('users')
        .select('id', 'username', 'email', 'role', 'is_active', 'last_login', 'last_vpn_connect', 'created_at')
        .where({ id: payload.id })
        .first()
      return user
    },
  )

  // POST /api/v1/auth/change-password
  app.post<{ Body: { currentPassword: string; newPassword: string } }>(
    '/auth/change-password',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'Change current user password',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['currentPassword', 'newPassword'],
          properties: {
            currentPassword: { type: 'string' },
            newPassword: { type: 'string', minLength: 6 },
          },
        },
      },
    },
    async (request, reply) => {
      const { currentPassword, newPassword } = request.body
      const payload = request.user as { id: string }

      const user = await app.db('users').where({ id: payload.id }).first()
      if (!user) {
        return reply.status(404).send({ error: 'Not Found', message: 'User not found' })
      }

      const validPassword = await bcrypt.compare(currentPassword, user.password)
      if (!validPassword) {
        return reply.status(401).send({ error: 'Unauthorized', message: 'Current password is incorrect' })
      }

      if (newPassword.length < 6) {
        return reply.status(400).send({ error: 'Bad Request', message: 'New password must be at least 6 characters' })
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10)
      await app.db('users').where({ id: payload.id }).update({ password: hashedPassword, updated_at: new Date() })

      return { message: 'Password changed successfully' }
    },
  )
}

export default authRoutes

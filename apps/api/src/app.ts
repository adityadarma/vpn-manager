import Fastify from 'fastify'
import { createDb } from '@vpn/db'
import type { Env } from './config/env'
import { NodeStatusChecker } from './services/node-status-checker'
import { startCertRenewalScheduler } from './services/cert-renewal'
import { TokenRevocationSweeper } from './services/token-revocation'

import corsPlugin from './plugins/cors'
import cookiePlugin from './plugins/cookie'
import jwtPlugin from './plugins/jwt'
import rateLimitPlugin from './plugins/rate-limit'
import swaggerPlugin from './plugins/swagger'
import dbPlugin from './plugins/db'
import nodeAuthPlugin from './plugins/node-auth'
import staticPlugin from './plugins/static'

import healthRoutes from './modules/health/health.routes'
import authRoutes from './modules/auth/auth.routes'
import userRoutes from './modules/users/users.routes'
import nodeRoutes from './modules/nodes/nodes.routes'
import sessionRoutes from './modules/sessions/sessions.routes'
import policyRoutes from './modules/policies/policies.routes'
import taskRoutes from './modules/tasks/tasks.routes'
import vpnRoutes from './modules/vpn/vpn.routes'
import groupRoutes from './modules/groups/groups.routes'
import networkRoutes from './modules/networks/networks.routes'
import auditRoutes from './modules/audit/audit.routes'

export async function buildApp(env: Env) {
  const db = createDb({
    type: env.DATABASE_TYPE,
    url: env.DATABASE_URL,
    sqlitePath: env.DATABASE_SQLITE_PATH,
  })

  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'development' ? 'info' : 'warn',
    },
    // Trust reverse proxy headers (Cloudflare Tunnel, nginx, etc.)
    // so request.ip reads from X-Forwarded-For instead of the Docker socket IP
    trustProxy: true,
  })

  // Plugins
  await app.register(corsPlugin)
  await app.register(cookiePlugin)  // must be before jwtPlugin
  await app.register(rateLimitPlugin, { nodeEnv: env.NODE_ENV })
  await app.register(dbPlugin, { db })
  await app.register(jwtPlugin, { secret: env.JWT_SECRET, expiresIn: env.JWT_EXPIRES_IN })
  await app.register(nodeAuthPlugin)  // must be after dbPlugin
  await app.register(swaggerPlugin, { nodeEnv: env.NODE_ENV })

  // Routes — all under /api/v1
  await app.register(
    async (v1) => {
      await v1.register(healthRoutes)
      await v1.register(authRoutes)
      await v1.register(userRoutes)
      await v1.register(nodeRoutes)
      await v1.register(sessionRoutes)
      await v1.register(policyRoutes)
      await v1.register(taskRoutes)
      await v1.register(vpnRoutes)
      await v1.register(groupRoutes)
      await v1.register(networkRoutes)
      await v1.register(auditRoutes)
    },
    { prefix: '/api/v1' },
  )

  if (env.NODE_ENV === 'production') {
    await app.register(staticPlugin)
  }

  // Background schedulers are disabled in tests to keep test DB setup deterministic.
  const shouldStartSchedulers = env.NODE_ENV !== 'test'
  let nodeStatusChecker: NodeStatusChecker | null = null
  let tokenRevocationSweeper: TokenRevocationSweeper | null = null

  if (shouldStartSchedulers) {
    nodeStatusChecker = new NodeStatusChecker(
      db,
      60000,  // Check every 1 minute
      120000  // Mark offline after 2 minutes without heartbeat
    )
    nodeStatusChecker.start()
    startCertRenewalScheduler(db)

    // Prune revoked-token rows once they can no longer affect verification.
    tokenRevocationSweeper = new TokenRevocationSweeper(db, 60 * 60 * 1000) // hourly
    tokenRevocationSweeper.start()
  }

  // Cleanup on shutdown
  app.addHook('onClose', async () => {
    nodeStatusChecker?.stop()
    tokenRevocationSweeper?.stop()
  })

  return app
}

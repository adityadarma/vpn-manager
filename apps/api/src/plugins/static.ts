import fp from 'fastify-plugin'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import path from 'node:path'

export default fp(async (app) => {
  // The production image places the dashboard at /app/web. Local production
  // runs use the workspace build without exposing a configurable path.
  const webRoot = existsSync('/app/web') ? '/app/web' : path.resolve(process.cwd(), 'apps/web/dist')

  await app.register(fastifyStatic, {
    root: webRoot,
    // Serve static assets (JS, CSS, images) without prefix
    prefix: '/',
  })

  // SPA fallback: all non-API, non-asset routes → index.html
  app.setNotFoundHandler(async (request, reply) => {
    const { url } = request
    // Pass through /api/* — should never reach here but just in case
    if (url.startsWith('/api/')) {
      return reply.status(404).send({ error: 'Not Found' })
    }
    return reply.sendFile('index.html')
  })
})

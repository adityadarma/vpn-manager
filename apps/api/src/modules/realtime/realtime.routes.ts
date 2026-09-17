import type { FastifyPluginAsync } from 'fastify'

const realtimeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/events', { onRequest: [app.authenticate] }, async (request, reply) => {
    reply.hijack()
    reply.raw.writeHead(200, {
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
      'X-Accel-Buffering': 'no',
    })
    reply.raw.write('retry: 5000\n\n')

    const unsubscribe = app.realtime.subscribe((event) => {
      reply.raw.write(`event: update\ndata: ${JSON.stringify(event)}\n\n`)
    })
    const keepAlive = setInterval(() => reply.raw.write(': keepalive\n\n'), 25_000)
    request.raw.once('close', () => {
      clearInterval(keepAlive)
      unsubscribe()
      reply.raw.end()
    })
  })
}

export default realtimeRoutes

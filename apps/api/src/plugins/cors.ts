import fp from 'fastify-plugin'
import cors from '@fastify/cors'

export default fp(async (app) => {
  await app.register(cors, {
    // In production: same origin (web served from same Fastify), no CORS needed
    // In development: allow vite dev server origin
    origin: process.env['NODE_ENV'] === 'production'
      ? false
      : (process.env['WEB_URL'] ?? 'http://localhost:3000'),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-VPN-Token', 'X-Forwarded-For', 'X-Real-IP'],
    // credentials: true is required to allow cookies in cross-origin requests (dev only)
    credentials: true,
  })
})

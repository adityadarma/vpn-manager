import fp from 'fastify-plugin'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'

interface SwaggerPluginOptions {
  nodeEnv: string
}

export default fp(async (app, options: SwaggerPluginOptions) => {
  if (options.nodeEnv === 'production') return

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'VPN Manager API',
        description: 'VPN Management API',
        version: '2.0.0',
      },
      tags: [
        { name: 'auth', description: 'Authentication' },
        { name: 'users', description: 'VPN User Management' },
        { name: 'nodes', description: 'VPN Node Management' },
        { name: 'sessions', description: 'VPN Session Monitoring' },
        { name: 'policies', description: 'Network Policies' },
        { name: 'tasks', description: 'Agent Task Queue' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  })

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  })
})

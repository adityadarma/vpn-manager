import fp from 'fastify-plugin'
import Fastify from 'fastify'
import { ZodError } from 'zod'

const { FST_ERR_CTP_INVALID_MEDIA_TYPE } = Fastify.errorCodes
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH'])

/**
 * Normalises how request bodies arrive, independent of client or proxy.
 *
 * - An empty body with no or an unknown Content-Type is treated as "no body".
 *   Reverse proxies forward a body-less POST as `Transfer-Encoding: chunked`
 *   without a Content-Type, which Fastify otherwise rejects with 415.
 *   Non-empty content of an unknown type is still rejected with 415.
 * - A missing body on POST/PUT/PATCH becomes `{}`, so schema validation
 *   answers 400 instead of handlers crashing on `request.body` being undefined.
 * - A Zod validation error from a handler is a client error (400), not a 500.
 */
export default fp(async (app) => {
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
    if ((body as Buffer).length === 0) return done(null, undefined)
    done(new FST_ERR_CTP_INVALID_MEDIA_TYPE(), undefined)
  })

  app.addHook('preValidation', async (request) => {
    if (request.body === undefined && BODY_METHODS.has(request.method)) {
      request.body = {}
    }
  })

  // Captured before replacing it so every non-Zod error (rate limits, auth,
  // schema validation) keeps its exact status code and body.
  const defaultErrorHandler = app.errorHandler
  app.setErrorHandler(function (error, request, reply) {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: error.issues
          .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
          .join('; '),
      })
    }
    return defaultErrorHandler.call(this, error, request, reply)
  })
})

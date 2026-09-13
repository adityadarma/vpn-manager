import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { v7 as uuidv7 } from 'uuid'
import { buildApp } from '../src/app'
import { revokeExpiredCertificates } from '../src/services/cert-expiry'

describe('certificate expiry', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({
      JWT_SECRET: 'test-secret',
      JWT_EXPIRES_IN: '1h',
      NODE_ENV: 'test',
    } as any)
    await app.db.migrate.latest()
    await app.db.seed.run()
  })

  afterAll(async () => {
    await app.close()
  })

  it('does not revoke credentials whose SQLite epoch expiry is still in the future', async () => {
    const user = await app.db('users').where({ username: 'admin' }).first('id')
    const nodeId = uuidv7()
    const expiredId = uuidv7()
    const futureId = uuidv7()

    await app.db('vpn_nodes').insert({
      id: nodeId,
      hostname: `expiry-test-${nodeId}`,
      ip_address: '192.0.2.1',
      port: 1194,
      token: uuidv7(),
      status: 'online',
    })
    await app.db('user_node_certificates').insert([
      {
        id: expiredId,
        user_id: user.id,
        node_id: nodeId,
        credential_name: 'expired',
        expires_at: new Date(Date.now() - 60_000),
        is_revoked: false,
      },
      {
        id: futureId,
        user_id: user.id,
        node_id: nodeId,
        credential_name: 'future',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
        is_revoked: false,
      },
    ])

    await revokeExpiredCertificates(app.db)

    const credentials = await app.db('user_node_certificates')
      .whereIn('id', [expiredId, futureId])
      .select('id', 'is_revoked')
    expect(credentials.find((credential) => credential.id === expiredId)?.is_revoked).toBe(1)
    expect(credentials.find((credential) => credential.id === futureId)?.is_revoked).toBe(0)
  })
})

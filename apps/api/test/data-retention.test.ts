import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { v7 as uuidv7 } from 'uuid'
import { buildApp } from '../src/app'
import { DataRetentionWorker } from '../src/services/data-retention'

describe('data retention', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters',
      JWT_EXPIRES_IN: '1h',
      NODE_ENV: 'test',
    } as any)
    await app.db.migrate.latest()
    await app.db.seed.run()
  })

  afterAll(async () => app.close())

  beforeEach(async () => {
    await app.db('notification_deliveries').delete()
    await app.db('notification_outbox').delete()
    await app.db('alerts').delete()
    await app.db('system_settings').where({ id: 'system' }).update({
      alert_retention_days: 30,
      session_retention_days: null,
      task_retention_days: null,
      audit_retention_days: null,
      delivery_retention_days: null,
      dns_revision_retention_days: null,
    })
  })

  it('previews and removes only resolved alerts older than policy', async () => {
    const old = new Date(Date.now() - 40 * 86_400_000)
    const recent = new Date(Date.now() - 5 * 86_400_000)
    await app.db('alerts').insert([
      {
        id: uuidv7(),
        dedup_key: 'old-resolved',
        event: 'node.offline',
        severity: 'critical',
        status: 'resolved',
        resource_type: 'vpn_node',
        resource_id: 'old',
        resource_name: 'old',
        summary: 'old',
        occurrence_count: 1,
        first_occurred_at: old,
        last_occurred_at: old,
        resolved_at: old,
        created_at: old,
        updated_at: old,
      },
      {
        id: uuidv7(),
        dedup_key: 'recent-resolved',
        event: 'node.offline',
        severity: 'critical',
        status: 'resolved',
        resource_type: 'vpn_node',
        resource_id: 'recent',
        resource_name: 'recent',
        summary: 'recent',
        occurrence_count: 1,
        first_occurred_at: recent,
        last_occurred_at: recent,
        resolved_at: recent,
        created_at: recent,
        updated_at: recent,
      },
      {
        id: uuidv7(),
        dedup_key: 'old-open',
        event: 'node.offline',
        severity: 'critical',
        status: 'open',
        resource_type: 'vpn_node',
        resource_id: 'open',
        resource_name: 'open',
        summary: 'open',
        occurrence_count: 1,
        first_occurred_at: old,
        last_occurred_at: old,
        created_at: old,
        updated_at: old,
      },
    ])
    const worker = new DataRetentionWorker(app.db)
    expect((await worker.preview()).alerts).toBe(1)
    expect((await worker.runOnce()).alerts).toBe(1)
    expect(await app.db('alerts').orderBy('dedup_key').pluck('dedup_key')).toEqual([
      'old-open',
      'recent-resolved',
    ])
  })
})

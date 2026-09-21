import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app'
import { AlertService, buildProviderRequest, decryptChannelValue } from '../src/services/alerts'
import { loginAsAdmin } from './helpers'

describe('operational alerts', () => {
  let app: FastifyInstance
  let adminCookie: string

  beforeAll(async () => {
    app = await buildApp({
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters',
      JWT_EXPIRES_IN: '1h',
      NODE_ENV: 'test',
    } as any)
    await app.db.migrate.latest()
    await app.db.seed.run()
    adminCookie = await loginAsAdmin(app)
  })

  afterAll(async () => app.close())

  beforeEach(async () => {
    await app.db('notification_deliveries').delete()
    await app.db('notification_outbox').delete()
    await app.db('alerts').delete()
    await app.db('notification_channels').delete()
  })

  it('deduplicates repeated incidents and sends only one open notification', async () => {
    const service = new AlertService(app.db)
    const input = {
      event: 'node.offline',
      severity: 'critical' as const,
      resourceType: 'vpn_node',
      resourceId: 'node-1',
      resourceName: 'edge-1',
      summary: 'Node edge-1 is offline',
    }
    const firstId = await service.open(input)
    const secondId = await service.open(input)

    expect(secondId).toBe(firstId)
    expect(Number((await app.db('alerts').where({ id: firstId }).first()).occurrence_count)).toBe(2)
    expect(await app.db('notification_outbox').where({ alert_id: firstId })).toHaveLength(1)
  })

  it('preserves acknowledgement on repeated incidents and emits recovery', async () => {
    const service = new AlertService(app.db)
    const id = await service.open({
      event: 'node.offline',
      severity: 'critical',
      resourceType: 'vpn_node',
      resourceId: 'node-1',
      resourceName: 'edge-1',
      summary: 'Node edge-1 is offline',
    })
    await app
      .db('alerts')
      .where({ id })
      .update({ status: 'acknowledged', acknowledged_at: new Date() })
    await service.open({
      event: 'node.offline',
      severity: 'critical',
      resourceType: 'vpn_node',
      resourceId: 'node-1',
      resourceName: 'edge-1',
      summary: 'Node edge-1 remains offline',
    })
    expect((await app.db('alerts').where({ id }).first()).status).toBe('acknowledged')

    expect(await service.resolve('node.offline:vpn_node:node-1', 'Node recovered')).toBe(true)
    expect((await app.db('alerts').where({ id }).first()).status).toBe('resolved')
    expect(await app.db('notification_outbox').where({ alert_id: id })).toHaveLength(2)
  })

  it('restricts alert APIs to admins and acknowledges an open alert', async () => {
    const id = await app.alerts.open({
      event: 'task.failed',
      severity: 'warning',
      resourceType: 'task',
      resourceId: 'task-1',
      resourceName: 'update_server_config',
      summary: 'Task failed',
    })
    expect((await app.inject({ method: 'GET', url: '/api/v1/alerts' })).statusCode).toBe(401)

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/alerts',
      headers: { cookie: adminCookie },
    })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().alerts[0].id).toBe(id)

    const acknowledged = await app.inject({
      method: 'PATCH',
      url: `/api/v1/alerts/${id}/acknowledge`,
      headers: { cookie: adminCookie },
      payload: {},
    })
    expect(acknowledged.statusCode).toBe(200)
    expect((await app.db('alerts').where({ id }).first()).status).toBe('acknowledged')
  })

  it('stores Slack webhook URLs encrypted', async () => {
    const secret = 'test-secret-that-is-at-least-32-characters'
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/alerts/channels',
      headers: { cookie: adminCookie },
      payload: {
        name: 'Operations',
        type: 'slack',
        url: 'https://example.com/vpn-alerts',
      },
    })
    expect(response.statusCode).toBe(201)
    const channel = await app.db('notification_channels').where({ id: response.json().id }).first()
    expect(channel.config_encrypted).not.toContain('example.com')
    expect(JSON.parse(decryptChannelValue(channel.config_encrypted, secret))).toEqual({
      type: 'slack',
      url: 'https://example.com/vpn-alerts',
    })
  })

  it('stores provider credentials encrypted and only lists safe channel metadata', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/alerts/channels',
      headers: { cookie: adminCookie },
      payload: {
        name: 'Telegram Ops',
        type: 'telegram',
        botToken: '123456789:abcdefghijklmnopqrstuvwxyz',
        chatId: '-1001234567890',
      },
    })
    expect(response.statusCode).toBe(201)
    const channel = await app.db('notification_channels').where({ id: response.json().id }).first()
    expect(channel.config_encrypted).not.toContain('123456789')

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/alerts/channels',
      headers: { cookie: adminCookie },
    })
    expect(listed.json().channels[0]).toMatchObject({ name: 'Telegram Ops', type: 'telegram' })
    expect(listed.body).not.toContain('botToken')
    expect(listed.body).not.toContain('123456789')
  })

  it('builds provider-specific request payloads', () => {
    const alert = {
      event: 'node.offline',
      severity: 'critical' as const,
      status: 'open' as const,
      occurredAt: '2026-09-21T08:00:00.000Z',
      resourceType: 'vpn_node',
      resourceId: 'node-1',
      resourceName: 'edge-1',
      summary: 'VPN node edge-1 is offline',
      details: { last_seen: '2026-09-21T07:58:00.000Z' },
      detailsUrl: 'https://manager.example.com/alerts',
    }

    const slack = buildProviderRequest({ type: 'slack', url: 'https://hooks.slack.com/a' }, alert)
    expect(JSON.parse(slack.body).blocks[0].type).toBe('header')

    const telegram = buildProviderRequest(
      { type: 'telegram', botToken: 'token', chatId: '-1001' },
      alert,
    )
    expect(telegram.url).toBe('https://api.telegram.org/bottoken/sendMessage')
    expect(JSON.parse(telegram.body).chat_id).toBe('-1001')
  })
})

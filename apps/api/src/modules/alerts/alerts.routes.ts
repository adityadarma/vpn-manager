import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { v7 as uuidv7 } from 'uuid'
import {
  encryptChannelValue,
  decryptChannelValue,
  type NotificationProviderConfig,
  sendProviderNotification,
  validateWebhookUrl,
} from '../../services/alerts'
import { getClientIp, logAudit } from '../../utils/audit'

const ChannelBaseSchema = z.object({
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean().default(true),
  minimumSeverity: z.enum(['warning', 'critical']).default('warning'),
  events: z
    .array(z.enum(['node.offline', 'task.failed', 'credential.expiring', 'dns.sync_failed']))
    .max(4)
    .default([]),
  sendResolved: z.boolean().default(true),
})

const ChannelSchema = z.discriminatedUnion('type', [
  ChannelBaseSchema.extend({ type: z.literal('slack'), url: z.string().url() }),
  ChannelBaseSchema.extend({
    type: z.literal('telegram'),
    botToken: z.string().trim().min(20).max(255),
    chatId: z.string().trim().min(1).max(100),
  }),
])

const alertsRoutes: FastifyPluginAsync<{ encryptionSecret: string }> = async (app, options) => {
  app.get('/alerts', { onRequest: [app.authenticateAdmin] }, async (request) => {
    const query = request.query as {
      page?: string
      limit?: string
      status?: string
      severity?: string
    }
    const page = Math.max(1, Number(query.page) || 1)
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 10))
    let base = app.db('alerts')
    if (['open', 'acknowledged', 'resolved'].includes(query.status ?? ''))
      base = base.where({ status: query.status })
    if (['warning', 'critical'].includes(query.severity ?? ''))
      base = base.where({ severity: query.severity })
    const [alerts, count, counts] = await Promise.all([
      base
        .clone()
        .orderBy('last_occurred_at', 'desc')
        .limit(limit)
        .offset((page - 1) * limit),
      base.clone().count('* as count').first(),
      app.db('alerts').select('status').count('* as count').groupBy('status'),
    ])
    return {
      alerts,
      pagination: {
        page,
        limit,
        total: Number(count?.count ?? 0),
        pages: Math.ceil(Number(count?.count ?? 0) / limit),
      },
      status_counts: Object.fromEntries(counts.map((row) => [row.status, Number(row.count)])),
    }
  })

  app.patch<{ Params: { id: string } }>(
    '/alerts/:id/acknowledge',
    { onRequest: [app.authenticateAdmin] },
    async (request, reply) => {
      const user = request.user as { id: string; name?: string; email?: string }
      const updated = await app
        .db('alerts')
        .where({ id: request.params.id })
        .where({ status: 'open' })
        .update({
          status: 'acknowledged',
          acknowledged_at: new Date(),
          acknowledged_by: user.id,
          updated_at: new Date(),
        })
      if (!updated)
        return reply.status(404).send({ error: 'Not Found', message: 'Open alert not found' })
      app.realtime.publish('alert.updated', request.params.id)
      await logAudit(app, {
        userId: user.id,
        username: user.name ?? user.email ?? 'admin',
        action: 'acknowledge_alert',
        resourceType: 'alert',
        resourceId: request.params.id,
        ipAddress: getClientIp(request),
      })
      return { ok: true }
    },
  )

  app.get('/alerts/channels', { onRequest: [app.authenticateAdmin] }, async () => {
    const channels = await app
      .db('notification_channels')
      .select(
        'id',
        'name',
        'type',
        'enabled',
        'minimum_severity',
        'events',
        'send_resolved',
        'created_at',
        'updated_at',
      )
      .orderBy('name')
    return { channels }
  })

  app.post('/alerts/channels', { onRequest: [app.authenticateAdmin] }, async (request, reply) => {
    const input = ChannelSchema.parse(request.body)
    if ('url' in input) await validateWebhookUrl(input.url)
    const id = uuidv7()
    const { name, enabled, minimumSeverity, events, sendResolved, ...providerConfig } = input
    await app.db('notification_channels').insert({
      id,
      name,
      type: input.type,
      config_encrypted: encryptChannelValue(
        JSON.stringify(providerConfig satisfies NotificationProviderConfig),
        options.encryptionSecret,
      ),
      enabled,
      minimum_severity: minimumSeverity,
      events: events.length ? JSON.stringify(events) : null,
      send_resolved: sendResolved,
      created_at: new Date(),
      updated_at: new Date(),
    })
    const user = request.user as { id: string; name?: string; email?: string }
    await logAudit(app, {
      userId: user.id,
      username: user.name ?? user.email ?? 'admin',
      action: 'create_notification_channel',
      resourceType: 'alert',
      resourceId: id,
      ipAddress: getClientIp(request),
      metadata: { name, type: input.type },
    })
    return reply.status(201).send({ id })
  })

  app.patch<{ Params: { id: string } }>(
    '/alerts/channels/:id',
    { onRequest: [app.authenticateAdmin] },
    async (request, reply) => {
      const input = z
        .object({
          enabled: z.boolean().optional(),
          minimumSeverity: z.enum(['warning', 'critical']).optional(),
          events: z
            .array(
              z.enum(['node.offline', 'task.failed', 'credential.expiring', 'dns.sync_failed']),
            )
            .max(4)
            .optional(),
          sendResolved: z.boolean().optional(),
        })
        .parse(request.body)
      const updates: Record<string, unknown> = { updated_at: new Date() }
      if (input.enabled !== undefined) updates.enabled = input.enabled
      if (input.minimumSeverity !== undefined) updates.minimum_severity = input.minimumSeverity
      if (input.events !== undefined)
        updates.events = input.events.length ? JSON.stringify(input.events) : null
      if (input.sendResolved !== undefined) updates.send_resolved = input.sendResolved
      const updated = await app
        .db('notification_channels')
        .where({ id: request.params.id })
        .update(updates)
      if (!updated)
        return reply
          .status(404)
          .send({ error: 'Not Found', message: 'Notification channel not found' })
      app.realtime.publish('alert.updated')
      return { ok: true }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/alerts/channels/:id/test',
    { onRequest: [app.authenticateAdmin] },
    async (request, reply) => {
      const channel = await app.db('notification_channels').where({ id: request.params.id }).first()
      if (!channel)
        return reply
          .status(404)
          .send({ error: 'Not Found', message: 'Notification channel not found' })
      try {
        const config = JSON.parse(
          decryptChannelValue(channel.config_encrypted, options.encryptionSecret),
        ) as NotificationProviderConfig
        await sendProviderNotification(config, {
          event: 'notification.test',
          severity: 'warning',
          status: 'open',
          occurredAt: new Date().toISOString(),
          resourceType: 'system',
          resourceId: 'settings',
          resourceName: 'VPN Manager',
          summary: `Test notification from VPN Manager via ${channel.name}`,
          details: {},
        })
        return { ok: true }
      } catch (error) {
        return reply
          .status(502)
          .send({ error: 'Delivery Failed', message: (error as Error).message })
      }
    },
  )

  app.delete<{ Params: { id: string } }>(
    '/alerts/channels/:id',
    { onRequest: [app.authenticateAdmin] },
    async (request, reply) => {
      const deleted = await app
        .db('notification_channels')
        .where({ id: request.params.id })
        .delete()
      if (!deleted)
        return reply
          .status(404)
          .send({ error: 'Not Found', message: 'Notification channel not found' })
      const user = request.user as { id: string; name?: string; email?: string }
      await logAudit(app, {
        userId: user.id,
        username: user.name ?? user.email ?? 'admin',
        action: 'delete_notification_channel',
        resourceType: 'alert',
        resourceId: request.params.id,
        ipAddress: getClientIp(request),
      })
      return reply.status(204).send()
    },
  )
}

export default alertsRoutes

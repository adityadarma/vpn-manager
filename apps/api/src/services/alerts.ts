import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { Knex } from 'knex'
import { v7 as uuidv7 } from 'uuid'
import type { RealtimeEvents } from './realtime'

export type AlertSeverity = 'warning' | 'critical'
export type NotificationProvider = 'slack' | 'telegram'

export type NotificationProviderConfig =
  { type: 'slack'; url: string } | { type: 'telegram'; botToken: string; chatId: string }

export interface ProviderRequest {
  url: string
  body: string
  headers: Record<string, string>
}

export interface AlertInput {
  event: string
  severity: AlertSeverity
  resourceType: string
  resourceId: string
  resourceName: string
  summary: string
  details?: Record<string, unknown>
  dedupKey?: string
}

function encryptionKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('vpn-manager-notification-channel').digest()
}

export function encryptChannelValue(value: string, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.')
}

export function decryptChannelValue(value: string, secret: string): string {
  const [iv, tag, encrypted] = value.split('.').map((part) => Buffer.from(part, 'base64url'))
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

function isPrivateAddress(address: string): boolean {
  if (
    address === '::1' ||
    address === '::' ||
    address.startsWith('fe80:') ||
    address.startsWith('fc') ||
    address.startsWith('fd')
  )
    return true
  const parts = address.split('.').map(Number)
  if (parts.length !== 4) return false
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    parts[0] === 0 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  )
}

export async function validateWebhookUrl(value: string): Promise<URL> {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Webhook URL must use HTTPS without embedded credentials')
  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true })
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('Webhook URL must resolve only to public addresses')
  }
  return url
}

interface DeliveryAlert {
  event: string
  severity: AlertSeverity
  status: 'open' | 'resolved'
  occurredAt: string
  resourceType: string
  resourceId: string
  resourceName: string
  summary: string
  details: Record<string, unknown>
  detailsUrl?: string
}

function alertText(alert: DeliveryAlert): string {
  const state = alert.status === 'resolved' ? 'RESOLVED' : alert.severity.toUpperCase()
  return `[${state}] ${alert.summary}\n${alert.resourceType}: ${alert.resourceName}${alert.detailsUrl ? `\n${alert.detailsUrl}` : ''}`
}

export function buildProviderRequest(
  config: NotificationProviderConfig,
  alert: DeliveryAlert,
): ProviderRequest {
  const text = alertText(alert)
  const baseHeaders = { 'content-type': 'application/json', 'user-agent': 'VPN-Manager-Alerts/1' }

  if (config.type === 'slack') {
    return {
      url: config.url,
      headers: baseHeaders,
      body: JSON.stringify({
        text,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `${alert.status === 'resolved' ? 'Resolved' : alert.severity === 'critical' ? 'Critical' : 'Warning'}: ${alert.event}`,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${alert.summary}*\n${alert.resourceType}: \`${alert.resourceName}\``,
            },
          },
          ...(alert.detailsUrl
            ? [
                {
                  type: 'actions',
                  elements: [
                    {
                      type: 'button',
                      text: { type: 'plain_text', text: 'View alert' },
                      url: alert.detailsUrl,
                    },
                  ],
                },
              ]
            : []),
        ],
      }),
    }
  }
  return {
    url: `https://api.telegram.org/bot${config.botToken}/sendMessage`,
    headers: baseHeaders,
    body: JSON.stringify({ chat_id: config.chatId, text, disable_web_page_preview: true }),
  }
}

export class AlertService {
  constructor(
    private readonly db: Knex,
    private readonly realtime?: RealtimeEvents,
  ) {}

  async open(input: AlertInput): Promise<string> {
    const dedupKey = input.dedupKey ?? `${input.event}:${input.resourceType}:${input.resourceId}`
    const now = new Date()
    let alertId = ''
    await this.db.transaction(async (trx) => {
      const existing = await trx('alerts').where({ dedup_key: dedupKey }).first()
      const shouldNotify = !existing || existing.status === 'resolved'
      if (existing) {
        alertId = existing.id
        await trx('alerts')
          .where({ id: alertId })
          .update({
            event: input.event,
            severity: input.severity,
            status: existing.status === 'resolved' ? 'open' : existing.status,
            resource_name: input.resourceName,
            summary: input.summary,
            details: JSON.stringify(input.details ?? {}),
            occurrence_count: Number(existing.occurrence_count) + 1,
            last_occurred_at: now,
            acknowledged_at: existing.status === 'resolved' ? null : existing.acknowledged_at,
            acknowledged_by: existing.status === 'resolved' ? null : existing.acknowledged_by,
            resolved_at: null,
            updated_at: now,
          })
      } else {
        alertId = uuidv7()
        await trx('alerts').insert({
          id: alertId,
          dedup_key: dedupKey,
          event: input.event,
          severity: input.severity,
          status: 'open',
          resource_type: input.resourceType,
          resource_id: input.resourceId,
          resource_name: input.resourceName,
          summary: input.summary,
          details: JSON.stringify(input.details ?? {}),
          occurrence_count: 1,
          first_occurred_at: now,
          last_occurred_at: now,
          created_at: now,
          updated_at: now,
        })
      }
      if (shouldNotify) {
        await trx('notification_outbox').insert({
          id: uuidv7(),
          alert_id: alertId,
          notification_status: 'open',
          status: 'pending',
          created_at: now,
        })
      }
    })
    this.realtime?.publish('alert.updated', alertId)
    return alertId
  }

  async resolve(dedupKey: string, summary?: string): Promise<boolean> {
    const alert = await this.db('alerts')
      .where({ dedup_key: dedupKey })
      .whereNot({ status: 'resolved' })
      .first()
    if (!alert) return false
    const now = new Date()
    await this.db.transaction(async (trx) => {
      await trx('alerts')
        .where({ id: alert.id })
        .update({
          status: 'resolved',
          summary: summary ?? alert.summary,
          resolved_at: now,
          updated_at: now,
        })
      await trx('notification_outbox').insert({
        id: uuidv7(),
        alert_id: alert.id,
        notification_status: 'resolved',
        status: 'pending',
        created_at: now,
      })
    })
    this.realtime?.publish('alert.updated', alert.id)
    return true
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    alerts: AlertService
  }
}

export async function scanExpiringCredentials(db: Knex, alerts: AlertService): Promise<void> {
  const now = new Date()
  const deadline = new Date(now.getTime() + 30 * 24 * 60 * 60_000)
  const credentials = await db('user_node_certificates as c')
    .join('users as u', 'c.user_id', 'u.id')
    .join('vpn_nodes as n', 'c.node_id', 'n.id')
    .where('c.is_revoked', false)
    .whereNotNull('c.expires_at')
    .where('c.expires_at', '>', now)
    .where('c.expires_at', '<=', deadline)
    .select(
      'c.id',
      'c.expires_at',
      'c.common_name',
      'u.name as user_name',
      'n.hostname as node_name',
    )
  const activeKeys = new Set<string>()
  for (const credential of credentials) {
    const dedupKey = `credential.expiring:credential:${credential.id}`
    activeKeys.add(dedupKey)
    const days = Math.max(
      1,
      Math.ceil((new Date(credential.expires_at).getTime() - now.getTime()) / 86_400_000),
    )
    await alerts.open({
      event: 'credential.expiring',
      severity: days <= 7 ? 'critical' : 'warning',
      resourceType: 'credential',
      resourceId: credential.id,
      resourceName: credential.common_name || credential.user_name,
      summary: `Credential for ${credential.user_name} expires in ${days} day(s)`,
      details: {
        expires_at: credential.expires_at,
        node: credential.node_name,
        days_remaining: days,
      },
      dedupKey,
    })
  }
  const existing = await db('alerts')
    .where({ event: 'credential.expiring' })
    .whereNot({ status: 'resolved' })
    .select('dedup_key')
  for (const alert of existing) {
    if (!activeKeys.has(alert.dedup_key))
      await alerts.resolve(alert.dedup_key, 'Credential expiry condition cleared')
  }
}

export class AlertDeliveryWorker {
  private timer: NodeJS.Timeout | null = null
  constructor(
    private readonly db: Knex,
    private readonly encryptionSecret: string,
    private readonly webUrl?: string,
  ) {}

  start(intervalMs = 15_000): void {
    void this.runOnce()
    this.timer = setInterval(() => void this.runOnce(), intervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  async runOnce(): Promise<void> {
    try {
      const outbox = await this.db('notification_outbox')
        .where({ status: 'pending' })
        .orderBy('created_at')
        .limit(50)
      const channels = await this.db('notification_channels').where({ enabled: true })
      for (const item of outbox) {
        for (const channel of channels) {
          await this.db('notification_deliveries')
            .insert({
              id: uuidv7(),
              outbox_id: item.id,
              alert_id: item.alert_id,
              channel_id: channel.id,
              status: 'pending',
              attempt_count: 0,
              next_attempt_at: new Date(),
              created_at: new Date(),
              updated_at: new Date(),
            })
            .onConflict(['outbox_id', 'channel_id'])
            .ignore()
        }
        await this.db('notification_outbox')
          .where({ id: item.id })
          .update({ status: 'processed', processed_at: new Date() })
      }

      const deliveries = await this.db('notification_deliveries as d')
        .join('notification_channels as c', 'd.channel_id', 'c.id')
        .join('notification_outbox as o', 'd.outbox_id', 'o.id')
        .join('alerts as a', 'd.alert_id', 'a.id')
        .whereIn('d.status', ['pending', 'failed'])
        .where('d.next_attempt_at', '<=', new Date())
        .where('d.attempt_count', '<', 5)
        .where('c.enabled', true)
        .select(
          'd.*',
          'c.type as channel_type',
          'c.config_encrypted',
          'o.notification_status',
          'a.event',
          'a.severity',
          'a.resource_type',
          'a.resource_id',
          'a.resource_name',
          'a.summary',
          'a.details',
          'a.last_occurred_at',
        )
        .limit(25)
      for (const delivery of deliveries) await this.deliver(delivery)
    } catch (error) {
      console.error(`[AlertDeliveryWorker] Run failed: ${(error as Error).message}`)
    }
  }

  private async deliver(row: any): Promise<void> {
    const attempt = Number(row.attempt_count) + 1
    try {
      const config = JSON.parse(
        decryptChannelValue(row.config_encrypted, this.encryptionSecret),
      ) as NotificationProviderConfig
      if (config.type !== row.channel_type) throw new Error('Notification channel type mismatch')
      const request = buildProviderRequest(config, {
        event: row.event,
        severity: row.severity,
        status: row.notification_status,
        occurredAt: new Date(row.last_occurred_at).toISOString(),
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        resourceName: row.resource_name,
        summary: row.summary,
        details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details,
        detailsUrl: this.webUrl ? `${this.webUrl.replace(/\/$/, '')}/alerts` : undefined,
      })
      await validateWebhookUrl(request.url)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10_000)
      const response = await fetch(request.url, {
        method: 'POST',
        signal: controller.signal,
        headers: request.headers,
        body: request.body,
      }).finally(() => clearTimeout(timeout))
      if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}`)
      await this.db('notification_deliveries').where({ id: row.id }).update({
        status: 'delivered',
        attempt_count: attempt,
        response_status: response.status,
        error_message: null,
        delivered_at: new Date(),
        updated_at: new Date(),
      })
    } catch (error) {
      const terminal = attempt >= 5
      await this.db('notification_deliveries')
        .where({ id: row.id })
        .update({
          status: 'failed',
          attempt_count: attempt,
          error_message: (error as Error).message.slice(0, 1000),
          next_attempt_at: new Date(
            Date.now() +
              (terminal ? 24 * 60 * 60_000 : Math.min(60 * 60_000, 30_000 * 2 ** (attempt - 1))),
          ),
          updated_at: new Date(),
        })
    }
  }
}

import type { Knex } from 'knex'

export interface RetentionResult {
  sessions: number
  tasks: number
  auditLogs: number
  alerts: number
  deliveries: number
  dnsRevisions: number
}

const terminalDnsStatuses = ['healthy', 'failed', 'superseded', 'rolled_back']

function cutoff(days: number, now: Date): Date {
  return new Date(now.getTime() - days * 86_400_000)
}

export class DataRetentionWorker {
  private timer: NodeJS.Timeout | null = null
  private running = false

  constructor(private readonly db: Knex) {}

  start(intervalMs = 24 * 60 * 60_000): void {
    void this.runOnce()
    this.timer = setInterval(() => void this.runOnce(), intervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  async preview(now = new Date()): Promise<RetentionResult> {
    const settings = await this.settings()
    const count = async (query: Knex.QueryBuilder) =>
      Number((await query.count('* as count').first())?.count ?? 0)
    return {
      sessions: settings.session_retention_days
        ? await count(
            this.db('vpn_sessions')
              .whereNotNull('disconnected_at')
              .where('disconnected_at', '<', cutoff(settings.session_retention_days, now)),
          )
        : 0,
      tasks: settings.task_retention_days
        ? await count(
            this.db('tasks')
              .whereIn('status', ['done', 'failed'])
              .whereNotNull('completed_at')
              .where('completed_at', '<', cutoff(settings.task_retention_days, now)),
          )
        : 0,
      auditLogs: settings.audit_retention_days
        ? await count(
            this.db('audit_logs').where(
              'created_at',
              '<',
              cutoff(settings.audit_retention_days, now),
            ),
          )
        : 0,
      alerts: settings.alert_retention_days
        ? await count(
            this.db('alerts')
              .where({ status: 'resolved' })
              .whereNotNull('resolved_at')
              .where('resolved_at', '<', cutoff(settings.alert_retention_days, now)),
          )
        : 0,
      deliveries: settings.delivery_retention_days
        ? await count(
            this.db('notification_deliveries')
              .whereIn('status', ['delivered', 'failed'])
              .where('updated_at', '<', cutoff(settings.delivery_retention_days, now)),
          )
        : 0,
      dnsRevisions: settings.dns_revision_retention_days
        ? await count(
            this.db('node_dns_revisions')
              .whereIn('status', terminalDnsStatuses)
              .where('created_at', '<', cutoff(settings.dns_revision_retention_days, now)),
          )
        : 0,
    }
  }

  async runOnce(now = new Date()): Promise<RetentionResult> {
    if (this.running) throw new Error('Data retention cleanup is already running')
    this.running = true
    try {
      const settings = await this.settings()
      const result = await this.db.transaction(async (trx) => ({
        sessions: settings.session_retention_days
          ? await trx('vpn_sessions')
              .whereNotNull('disconnected_at')
              .where('disconnected_at', '<', cutoff(settings.session_retention_days, now))
              .delete()
          : 0,
        tasks: settings.task_retention_days
          ? await trx('tasks')
              .whereIn('status', ['done', 'failed'])
              .whereNotNull('completed_at')
              .where('completed_at', '<', cutoff(settings.task_retention_days, now))
              .delete()
          : 0,
        auditLogs: settings.audit_retention_days
          ? await trx('audit_logs')
              .where('created_at', '<', cutoff(settings.audit_retention_days, now))
              .delete()
          : 0,
        alerts: settings.alert_retention_days
          ? await trx('alerts')
              .where({ status: 'resolved' })
              .whereNotNull('resolved_at')
              .where('resolved_at', '<', cutoff(settings.alert_retention_days, now))
              .delete()
          : 0,
        deliveries: settings.delivery_retention_days
          ? await trx('notification_deliveries')
              .whereIn('status', ['delivered', 'failed'])
              .where('updated_at', '<', cutoff(settings.delivery_retention_days, now))
              .delete()
          : 0,
        dnsRevisions: settings.dns_revision_retention_days
          ? await trx('node_dns_revisions')
              .whereIn('status', terminalDnsStatuses)
              .where('created_at', '<', cutoff(settings.dns_revision_retention_days, now))
              .delete()
          : 0,
      }))
      await this.db('system_settings')
        .where({ id: 'system' })
        .update({
          last_cleanup_at: now,
          last_cleanup_result: JSON.stringify(result),
          updated_at: now,
        })
      return result
    } finally {
      this.running = false
    }
  }

  private async settings(): Promise<any> {
    const settings = await this.db('system_settings').where({ id: 'system' }).first()
    if (!settings) throw new Error('System settings are not initialized')
    return settings
  }
}

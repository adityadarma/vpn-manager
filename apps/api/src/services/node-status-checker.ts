import type { Knex } from 'knex'
import type { AlertService } from './alerts'
import type { RealtimeEvents } from './realtime'

/**
 * Node Status Checker Service
 * Checks for nodes that haven't sent heartbeat in a while and marks them as offline
 */
export class NodeStatusChecker {
  private db: Knex
  private intervalId: NodeJS.Timeout | null = null
  private readonly checkIntervalMs: number
  private readonly offlineThresholdMs: number

  constructor(
    db: Knex,
    checkIntervalMs: number = 60000, // Check every 1 minute
    offlineThresholdMs: number = 120000, // Mark offline after 2 minutes without heartbeat
    private readonly alerts?: AlertService,
    private readonly realtime?: RealtimeEvents,
  ) {
    this.db = db
    this.checkIntervalMs = checkIntervalMs
    this.offlineThresholdMs = offlineThresholdMs
  }

  /**
   * Start the background checker
   */
  start(): void {
    if (this.intervalId) {
      console.warn('[NodeStatusChecker] Already running')
      return
    }

    console.log(
      `[NodeStatusChecker] Starting (check every ${this.checkIntervalMs}ms, offline threshold ${this.offlineThresholdMs}ms)`,
    )

    // Run immediately
    void this.checkNodeStatus()

    // Then run on interval
    this.intervalId = setInterval(() => {
      void this.checkNodeStatus()
    }, this.checkIntervalMs)
    this.intervalId.unref?.()
  }

  /**
   * Stop the background checker
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
      console.log('[NodeStatusChecker] Stopped')
    }
  }

  /**
   * Check all nodes and mark offline if needed
   */
  async checkNodeStatus(): Promise<number> {
    try {
      const thresholdDate = new Date(Date.now() - this.offlineThresholdMs)

      // Find nodes that are marked as 'online' but haven't sent heartbeat recently
      const staleNodes = await this.db('vpn_nodes')
        .where('status', 'online')
        .where(function () {
          this.where('last_seen', '<', thresholdDate).orWhereNull('last_seen')
        })
        .select('id', 'hostname', 'last_seen')

      let markedOffline = 0
      for (const node of staleNodes) {
        // Recheck last_seen in the update so a concurrent heartbeat wins.
        const updated = await this.db('vpn_nodes')
          .where({ id: node.id, status: 'online' })
          .where(function () {
            this.where('last_seen', '<', thresholdDate).orWhereNull('last_seen')
          })
          .update({ status: 'offline' })

        if (updated > 0) {
          markedOffline += 1
          await this.alerts?.open({
            event: 'node.offline',
            severity: 'critical',
            resourceType: 'vpn_node',
            resourceId: node.id,
            resourceName: node.hostname,
            summary: `VPN node ${node.hostname} is offline`,
            details: { last_seen: node.last_seen, threshold_ms: this.offlineThresholdMs },
          })
          this.realtime?.publish('node.updated', node.id)
          console.log(`  - ${node.hostname} (last seen: ${node.last_seen || 'never'})`)
        }
      }

      if (markedOffline > 0) {
        console.log(`[NodeStatusChecker] Marked ${markedOffline} node(s) as offline`)
      }
      return markedOffline
    } catch (error) {
      console.error('[NodeStatusChecker] Error checking node status:', error)
      return 0
    }
  }
}

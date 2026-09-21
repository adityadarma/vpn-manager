import type { Knex } from 'knex'
import type { AlertService } from './alerts'

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

    console.log(`[NodeStatusChecker] Starting (check every ${this.checkIntervalMs}ms, offline threshold ${this.offlineThresholdMs}ms)`)
    
    // Run immediately
    void this.checkNodeStatus()
    
    // Then run on interval
    this.intervalId = setInterval(() => {
      void this.checkNodeStatus()
    }, this.checkIntervalMs)
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
  private async checkNodeStatus(): Promise<void> {
    try {
      const thresholdDate = new Date(Date.now() - this.offlineThresholdMs)
      
      // Find nodes that are marked as 'online' but haven't sent heartbeat recently
      const staleNodes = await this.db('vpn_nodes')
        .where('status', 'online')
        .where(function() {
          this.where('last_seen', '<', thresholdDate)
            .orWhereNull('last_seen')
        })
        .select('id', 'hostname', 'last_seen')

      if (staleNodes.length > 0) {
        // Mark them as offline
        const nodeIds = staleNodes.map(n => n.id)
        await this.db('vpn_nodes')
          .whereIn('id', nodeIds)
          .update({ status: 'offline' })

        for (const node of staleNodes) {
          await this.alerts?.open({
            event: 'node.offline', severity: 'critical', resourceType: 'vpn_node', resourceId: node.id,
            resourceName: node.hostname, summary: `VPN node ${node.hostname} is offline`,
            details: { last_seen: node.last_seen, threshold_ms: this.offlineThresholdMs },
          })
        }

        console.log(`[NodeStatusChecker] Marked ${staleNodes.length} node(s) as offline:`)
        staleNodes.forEach(node => {
          console.log(`  - ${node.hostname} (last seen: ${node.last_seen || 'never'})`)
        })
      }
    } catch (error) {
      console.error('[NodeStatusChecker] Error checking node status:', error)
    }
  }
}

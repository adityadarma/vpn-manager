import type { AgentEnv } from '../config/env'
import type { VpnDriver } from '../drivers'
import fs from 'node:fs/promises'

export function startHeartbeat(env: AgentEnv, driver: VpnDriver): void {
  console.log(`💓 Heartbeat started (interval: ${env.AGENT_HEARTBEAT_INTERVAL_MS}ms)`)

  const beat = async () => {
    try {
      let caCert: string | undefined
      let taKey: string | undefined
      let clients: any[] = []
      let metrics: any = {}
      let serverInfo: any = {}

      // Read certificates
      try {
        caCert = await fs.readFile('/etc/openvpn/server/ca.crt', 'utf8')
        taKey = await fs.readFile('/etc/openvpn/server/ta.key', 'utf8')
      } catch (e) {
        // Silently fail, it might be running outside the VPN node temporarily or path doesn't exist
      }

      // Get real-time VPN data via management interface
      if (driver.isConnected()) {
        try {
          const [clientsData, metricsData, serverInfoData] = await Promise.all([
            driver.getClients(),
            driver.getMetrics(),
            driver.getServerInfo(),
          ])
          
          clients = clientsData
          metrics = metricsData
          serverInfo = serverInfoData
        } catch (err) {
          console.warn('[heartbeat] Failed to get VPN data:', (err as Error).message)
        }
      }

      const res = await fetch(`${env.AGENT_MANAGER_URL}/api/v1/nodes/heartbeat`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.AGENT_SECRET_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          nodeId: env.AGENT_NODE_ID,
          caCert,
          taKey,
          clients,
          metrics,
          serverInfo,
        }),
      })

      if (!res.ok) {
        console.warn(`[heartbeat] HTTP ${res.status}`)
      }
    } catch (err) {
      console.error('[heartbeat] Error:', (err as Error).message)
    }
  }

  // Send immediately on start
  void beat()
  setInterval(() => void beat(), env.AGENT_HEARTBEAT_INTERVAL_MS)
}

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

      let firewallRules = ''
      try {
        const { exec } = await import('node:child_process')
        const { promisify } = await import('node:util')
        const execAsync = promisify(exec)
        
        const getFirewallRules = async () => {
          if (env.FIREWALL_ENGINE === 'none') return ''
          
          if (['iptables', 'ufw', 'firewalld'].includes(env.FIREWALL_ENGINE)) {
            return (await execAsync('iptables -S VPN_FWWD')).stdout
          } 
          if (env.FIREWALL_ENGINE === 'nftables') {
            // Try listing just the VPN_FWWD chain first; if it doesn't exist yet
            // fall back to the full table dump so we always return something useful.
            try {
              return (await execAsync('nft list chain inet filter VPN_FWWD')).stdout
            } catch {
              try { return (await execAsync('nft list table inet filter')).stdout } catch {}
              return ''
            }
          }

          // Fallback to 'auto' mode
          try { return (await execAsync('iptables -S VPN_FWWD')).stdout } catch {}
          try { return (await execAsync('nft list chain inet filter VPN_FWWD')).stdout } catch {}
          return ''
        }
        
        firewallRules = await getFirewallRules()
      } catch (e: any) {
        // Silently ignore if firewall tools are not installed or chain missing
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
          firewallRules,
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

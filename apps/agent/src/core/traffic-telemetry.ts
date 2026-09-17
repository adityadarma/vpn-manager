import type { AgentEnv } from '../config/env'
import type { VpnDriver } from '../drivers'

export function startTrafficTelemetry(env: AgentEnv, driver: VpnDriver): void {
  console.log(
    `📊 Traffic telemetry started (interval: ${env.AGENT_TRAFFIC_TELEMETRY_INTERVAL_MS}ms)`,
  )

  const report = async () => {
    if (!driver.isConnected()) return

    try {
      const clients = await driver.getClients()
      const response = await fetch(`${env.AGENT_MANAGER_URL}/api/v1/nodes/telemetry`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.AGENT_SECRET_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          nodeId: env.AGENT_NODE_ID,
          clients: clients.map((client) => ({
            commonName: client.commonName,
            bytesReceived: client.bytesReceived,
            bytesSent: client.bytesSent,
          })),
        }),
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) console.warn(`[telemetry] HTTP ${response.status}`)
    } catch (error) {
      console.warn('[telemetry] Error:', (error as Error).message)
    }
  }

  void report()
  setInterval(() => void report(), env.AGENT_TRAFFIC_TELEMETRY_INTERVAL_MS)
}

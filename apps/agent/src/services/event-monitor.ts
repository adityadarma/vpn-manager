import type { AgentEnv } from '../config/env'
import type { VpnDriver } from '../drivers'

/**
 * Event Monitor Service
 *
 * Listens to realtime VPN events from the management interface.
 * The management interface sends >CLIENT:ENV lines with every connect event,
 * containing IV_PLAT, IV_VER, IV_GUI_VER, common_name, ifconfig_pool_remote_ip,
 * trusted_ip etc. — all the info we need without any external shell scripts.
 *
 * This approach avoids the "openvpn_execve: unable to fork" crash that occurs
 * when using client-connect/client-disconnect shell scripts on systems with
 * tight process limits for the `nobody` user.
 */

interface ClientEnvVars {
  common_name?: string
  trusted_ip?: string
  ifconfig_pool_remote_ip?: string
  // IV_ vars from TLS handshake peer info
  IV_PLAT?: string   // "win" | "mac" | "linux" | "android" | "ios"
  IV_VER?: string    // OpenVPN version e.g. "3.11.3"
  IV_GUI_VER?: string // GUI app + version e.g. "OCmacOS_3.8.1-5790"
  [key: string]: string | undefined
}

interface ClientConnectEvent {
  clientId: string
  keyId: string
  timestamp: Date
  envVars?: ClientEnvVars
}

interface ClientDisconnectEvent {
  clientId: string
  timestamp: Date
  username?: string
  vpnIp?: string
  realIp?: string
}

/**
 * Build a human-readable device_name from IV_ vars.
 *
 * Priority:
 *   1. IV_GUI_VER  e.g. "OCmacOS_3.8.1-5790"  → "OpenVPN Connect macOS 3.8.1"
 *   2. IV_PLAT + IV_VER  e.g. "mac" + "3.11.3" → "macOS (OpenVPN 3.11.3)"
 *   3. null
 */
function buildDeviceName(env: ClientEnvVars): string | null {
  const gui = env.IV_GUI_VER // e.g. "OCmacOS_3.8.1-5790" or "OpenVPN_GUI_11.28.0.0"
  if (gui) {
    // Strip trailing build numbers (e.g. -5790) and replace underscores
    return gui.replace(/-\d+$/, '').replace(/_/g, ' ')
  }

  const plat = env.IV_PLAT
  const ver = env.IV_VER
  if (plat) {
    const platformMap: Record<string, string> = {
      win: 'Windows', mac: 'macOS', linux: 'Linux', android: 'Android', ios: 'iOS',
    }
    const platform = platformMap[plat] ?? plat
    return ver ? `${platform} (OpenVPN ${ver})` : platform
  }

  return null
}

/**
 * Get client details from status when env vars are not available (fallback).
 */
async function getClientDetailsByUsername(driver: VpnDriver, username: string) {
  try {
    const statusOutput = await (driver as any).sendCommand('status 3') as string
    const lines = statusOutput.split('\n')
    for (const line of lines) {
      if (line.startsWith('CLIENT_LIST')) {
        const parts = line.split('\t')
        if (parts.length >= 8 && parts[1] === username) {
          return {
            username: parts[1],
            realIp: parts[2].split(':')[0],
            vpnIp: parts[3],
            bytesSent: parseInt(parts[6], 10) || 0,
            bytesReceived: parseInt(parts[5], 10) || 0,
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

/**
 * Handle client connect event — invoked after full ENV block is received.
 */
async function handleConnect(
  env: AgentEnv,
  event: ClientConnectEvent,
  _driver: VpnDriver,
): Promise<void> {
  const vars = event.envVars ?? {}
  const username = vars.common_name
  // vpn_ip may be missing when client uses static CCD (ifconfig-push).
  // In that case, send without it — the API server will resolve it from users.vpn_ip.
  const vpnIp = vars.ifconfig_pool_remote_ip ?? null
  const realIp = vars.trusted_ip ?? null

  const deviceName = buildDeviceName(vars)
  const clientVersion = vars.IV_VER ?? null

  console.log(`[event-monitor] 🔗 Connect: ${username} from ${realIp} → ${vpnIp}`)
  if (deviceName) console.log(`[event-monitor]    Device: ${deviceName}`)
  if (clientVersion) console.log(`[event-monitor]    Version: OpenVPN ${clientVersion}`)

  try {
    const response = await fetch(`${env.AGENT_MANAGER_URL}/api/v1/vpn/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VPN-Token': env.VPN_TOKEN,
      },
      body: JSON.stringify({
        username,
        vpn_ip: vpnIp,
        real_ip: realIp,
        node_id: env.AGENT_NODE_ID,
        device_name: deviceName,
        client_version: clientVersion,
      }),
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      const text = await response.text()
      console.error(`[event-monitor] ✗ Connect API failed ${response.status}: ${text}`)
      return
    }

    const data = await response.json() as { session_id: string }
    console.log(`[event-monitor] ✓ Session created: ${username} → ${data.session_id}`)
  } catch (err) {
    console.error('[event-monitor] ✗ Connect API error:', (err as Error).message)
  }
}

/**
 * Handle client disconnect event.
 * The driver now caches CID→{username,vpnIp,realIp} so we have the info
 * even after the client has left the status output.
 */
async function handleDisconnect(
  env: AgentEnv,
  event: ClientDisconnectEvent,
  driver: VpnDriver,
): Promise<void> {
  let username = event.username
  let bytesSent = 0
  let bytesReceived = 0

  // If we got username from the driver cache, try to get bytes from status (client may still be there briefly)
  if (username) {
    const details = await getClientDetailsByUsername(driver, username)
    if (details) {
      bytesSent = details.bytesSent
      bytesReceived = details.bytesReceived
    }
  } else {
    console.warn(`[event-monitor] Disconnect CID=${event.clientId} — username unknown (no driver cache hit)`)
    return
  }

  console.log(`[event-monitor] 👋 Disconnect: ${username}`)

  try {
    const response = await fetch(`${env.AGENT_MANAGER_URL}/api/v1/vpn/disconnect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VPN-Token': env.VPN_TOKEN,
      },
      body: JSON.stringify({
        username,
        node_id: env.AGENT_NODE_ID,
        bytes_sent: bytesSent,
        bytes_received: bytesReceived,
        disconnect_reason: 'normal',
      }),
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      const text = await response.text()
      console.error(`[event-monitor] ✗ Disconnect API failed ${response.status}: ${text}`)
      return
    }

    console.log(`[event-monitor] ✓ Disconnect recorded: ${username}`)
  } catch (err) {
    console.error('[event-monitor] ✗ Disconnect API error:', (err as Error).message)
  }
}

/**
 * Start event monitoring for VPN driver.
 */
export function startEventMonitor(env: AgentEnv, driver: VpnDriver): void {
  console.log('📡 Event monitor started (realtime VPN events via management interface)')
  console.log('   Device info: captured from IV_PLAT / IV_GUI_VER env vars (no external scripts needed)')

  driver.on('client-connect', (event: ClientConnectEvent) => {
    console.log(`[event-monitor] 🔔 client-connect CID=${event.clientId}`)
    void handleConnect(env, event, driver)
  })

  driver.on('client-disconnect', (event: ClientDisconnectEvent) => {
    console.log(`[event-monitor] 🔔 client-disconnect CID=${event.clientId}`)
    void handleDisconnect(env, event, driver)
  })

  driver.on('client-reauth', (event: { clientId: string }) => {
    console.log(`[event-monitor] 🔔 client-reauth CID=${event.clientId}`)
  })

  driver.on('connected', () => console.log('[event-monitor] Driver connected'))
  driver.on('disconnected', () => console.log('[event-monitor] Driver disconnected'))
}

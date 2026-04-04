import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

// Load .env from monorepo root (walk up from apps/agent/src/)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

import { loadAgentEnv } from './config/env'
import { startPoller } from './core/poller'
import { startHeartbeat } from './core/heartbeat'
import { OpenVpnManagementDriver, WireGuardDriver, type VpnDriver } from './drivers'
import { handleSyncCertificates } from './handlers/sync-certificates'
import { handleSyncServerConfig } from './handlers/sync-server-config'
import { startStatusMonitor } from './services/status-monitor'
import { startEventMonitor } from './services/event-monitor'

/**
 * Create VPN driver based on configuration
 */
function createVpnDriver(env: ReturnType<typeof loadAgentEnv>): VpnDriver {
  switch (env.VPN_TYPE) {
    case 'openvpn':
      return new OpenVpnManagementDriver(env.OPENVPN_SOCKET_PATH)
    
    case 'wireguard':
      return new WireGuardDriver(env.WIREGUARD_INTERFACE)
    
    default:
      throw new Error(`Unsupported VPN type: ${env.VPN_TYPE}`)
  }
}

/**
 * Check if certificates are synced to database
 */
async function checkCertificatesSync(env: ReturnType<typeof loadAgentEnv>): Promise<boolean> {
  try {
    const response = await fetch(`${env.AGENT_MANAGER_URL}/api/v1/nodes/me`, {
      headers: {
        'Authorization': `Bearer ${env.AGENT_SECRET_TOKEN}`,
      },
    })

    if (!response.ok) {
      console.warn('[startup] Failed to check node status:', response.status)
      return false
    }

    const node = await response.json() as { ca_cert?: string; ta_key?: string; vpn_type?: string; public_key?: string; private_key?: string }
    if (node.vpn_type === 'wireguard') {
      return !!(node.public_key && node.private_key)
    }
    return !!(node.ca_cert && node.ta_key)
  } catch (error) {
    console.warn('[startup] Failed to check certificates:', (error as Error).message)
    return false
  }
}

/**
 * Sync certificates on startup if needed
 */
async function syncCertificatesOnStartup(driver: VpnDriver): Promise<void> {
  const env = loadAgentEnv()
  
  console.log('[startup] Checking if certificates are synced...')
  const hasCerts = await checkCertificatesSync(env)
  
  if (hasCerts) {
    console.log('[startup] ✓ Certificates already synced')
    return
  }
  
  console.log('[startup] Certificates not found in database, syncing now...')
  
  try {
    await handleSyncCertificates({}, driver)
    console.log('[startup] ✓ Certificates synced successfully')
  } catch (error) {
    console.error('[startup] ✗ Failed to sync certificates:', (error as Error).message)
    console.warn('[startup] Certificates will be synced via task queue')
  }
}

/**
 * Sync server config on startup
 */
async function syncServerConfigOnStartup(driver: VpnDriver): Promise<void> {
  const env = loadAgentEnv()
  if (env.VPN_TYPE === 'wireguard') {
    // WireGuard config is fully managed centrally; no need to parse local file and push back
    return
  }

  console.log('[startup] Syncing server configuration...')
  
  try {
    await handleSyncServerConfig({}, driver)
    console.log('[startup] ✓ Server config synced successfully')
  } catch (error) {
    console.error('[startup] ✗ Failed to sync server config:', (error as Error).message)
    console.warn('[startup] Server config will be synced via task queue')
  }
}

async function main() {
  const env = loadAgentEnv()

  console.log(`🚀 VPN Agent starting...`)
  console.log(`   Manager:  ${env.AGENT_MANAGER_URL}`)
  console.log(`   Node ID:  ${env.AGENT_NODE_ID}`)
  console.log(`   VPN Type: ${env.VPN_TYPE}`)
  console.log(`   Poll:     every ${env.AGENT_POLL_INTERVAL_MS}ms`)
  console.log(`   Heartbeat: every ${env.AGENT_HEARTBEAT_INTERVAL_MS}ms`)
  
  if (env.VPN_TYPE === 'openvpn') {
    console.log(`   VPN Socket: ${env.OPENVPN_SOCKET_PATH}`)
  } else if (env.VPN_TYPE === 'wireguard') {
    console.log(`   WG Interface: ${env.WIREGUARD_INTERFACE}`)
  }

  // Initialize VPN driver (factory pattern)
  const driver = createVpnDriver(env)

  // Connect to VPN management interface
  try {
    await driver.connect()
    console.log(`✓ Connected to ${env.VPN_TYPE.toUpperCase()} management interface`)
  } catch (err) {
    console.error(`✗ Failed to connect to ${env.VPN_TYPE.toUpperCase()} management interface:`, (err as Error).message)
    console.warn(`  Agent will continue but VPN monitoring will be unavailable`)
  }

  // Sync certificates on startup if needed
  await syncCertificatesOnStartup(driver)

  // Sync server config on startup
  await syncServerConfigOnStartup(driver)

  // Start services
  startHeartbeat(env, driver)
  startPoller(env, driver)
  
  if (env.VPN_TYPE === 'openvpn') {
    // OpenVPN supports rich realtime events via Management Interface (includes Device Info from IV_PLAT)
    startEventMonitor(env, driver)
  } else {
    // WireGuard uses interval polling to simulate realtime events
    startStatusMonitor(env)
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n🛑 VPN Agent shutting down...')
    await driver.disconnect()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})

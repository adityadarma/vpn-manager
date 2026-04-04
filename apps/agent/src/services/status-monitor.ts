import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import type { AgentEnv } from '../config/env'

/**
 * Status Monitor Service
 * 
 * Monitors VPN status for client connect/disconnect events.
 * Supports both OpenVPN (status file) and WireGuard (wg command).
 */

interface StatusClient {
  commonName: string
  realAddress: string
  virtualAddress: string
  bytesReceived: number
  bytesSent: number
  connectedSince: Date
}

let previousClients = new Map<string, StatusClient>()
let isMonitoring = false

/**
 * Parse OpenVPN status file (version 3)
 */
function parseOpenVpnStatusFile(filePath: string): StatusClient[] {
  if (!existsSync(filePath)) {
    return []
  }

  try {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')
    const clients: StatusClient[] = []

    for (const line of lines) {
      if (line.startsWith('CLIENT_LIST\t')) {
        const parts = line.split('\t')
        
        if (parts.length >= 8) {
          clients.push({
            commonName: parts[1],
            realAddress: parts[2],
            virtualAddress: parts[3],
            bytesReceived: parseInt(parts[5], 10) || 0,
            bytesSent: parseInt(parts[6], 10) || 0,
            // parts[7] = human-readable date string (e.g. "2026-04-03 09:41:51")
            // parts[8] = Unix timestamp in seconds ← use this
            connectedSince: new Date(parseInt(parts[8], 10) * 1000),
          })
        }
      }
    }

    return clients
  } catch (err) {
    console.error('[status-monitor] Failed to parse OpenVPN status file:', (err as Error).message)
    return []
  }
}

/**
 * Parse WireGuard status from `wg show` command
 */
function parseWireGuardStatus(interfaceName: string): StatusClient[] {
  try {
    // Run: wg show wg0 dump
    // Output format (tab-separated):
    // private-key  public-key  listen-port  fwmark
    // public-key  preshared-key  endpoint  allowed-ips  latest-handshake  rx-bytes  tx-bytes  persistent-keepalive
    
    const output = execSync(`wg show ${interfaceName} dump`, { encoding: 'utf-8' })
    const lines = output.trim().split('\n')
    const clients: StatusClient[] = []
    
    // Skip first line (interface info)
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split('\t')
      
      if (parts.length >= 7) {
        const publicKey = parts[0]
        const endpoint = parts[2] || 'unknown'
        const allowedIps = parts[3] || ''
        const latestHandshake = parseInt(parts[4], 10) || 0
        const rxBytes = parseInt(parts[5], 10) || 0
        const txBytes = parseInt(parts[6], 10) || 0
        
        // Extract virtual IP from allowed-ips (e.g., "10.8.0.2/32" -> "10.8.0.2")
        const virtualIp = allowedIps.split(',')[0]?.split('/')[0] || 'unknown'
        
        // Only include peers with recent handshake (within last 3 minutes)
        const now = Math.floor(Date.now() / 1000)
        if (latestHandshake > 0 && (now - latestHandshake) < 180) {
          clients.push({
            commonName: publicKey.substring(0, 16), // Use first 16 chars of public key as identifier
            realAddress: endpoint,
            virtualAddress: virtualIp,
            bytesReceived: rxBytes,
            bytesSent: txBytes,
            connectedSince: new Date(latestHandshake * 1000),
          })
        }
      }
    }
    
    return clients
  } catch (err) {
    console.error('[status-monitor] Failed to parse WireGuard status:', (err as Error).message)
    return []
  }
}

/**
 * TO ADD NEW VPN TYPE:
 * 
 * 1. Create a parse function like parseOpenVpnStatusFile or parseWireGuardStatus
 * 2. Add case to parseStatus() switch statement
 * 3. Add validation in startStatusMonitor()
 * 4. Update VPN_TYPE enum in config/env.ts
 * 
 * Example for IPSec/IKEv2:
 * 
 * function parseIPSecStatus(): StatusClient[] {
 *   try {
 *     // Parse output from: ipsec statusall
 *     // or: swanctl --list-sas
 *     const output = execSync('ipsec statusall', { encoding: 'utf-8' })
 *     // Parse output and return StatusClient[]
 *   } catch (err) {
 *     return []
 *   }
 * }
 * 
 * Then add to parseStatus():
 *   case 'ipsec':
 *     return parseIPSecStatus()
 */

/**
 * Parse status based on VPN type
 */
function parseStatus(env: AgentEnv): StatusClient[] {
  switch (env.VPN_TYPE) {
    case 'wireguard':
      return parseWireGuardStatus(env.WIREGUARD_INTERFACE)
    
    case 'openvpn':
      return parseOpenVpnStatusFile('/var/log/openvpn/status.log')
    
    default:
      console.error(`[status-monitor] Unsupported VPN type: ${env.VPN_TYPE}`)
      return []
  }
}

/**
 * Handle client connect event
 */
async function handleConnect(env: AgentEnv, client: StatusClient): Promise<void> {
  try {
    console.log(`[status-monitor] 🔄 Sending connect request for ${client.commonName}`)
    console.log(`[status-monitor]    VPN IP: ${client.virtualAddress}`)
    console.log(`[status-monitor]    Real IP: ${client.realAddress.split(':')[0]}`)
    console.log(`[status-monitor]    Node ID: ${env.AGENT_NODE_ID}`)
    console.log(`[status-monitor]    API URL: ${env.AGENT_MANAGER_URL}/api/v1/vpn/connect`)
    
    // WireGuard identifies peers by public key (stored as commonName prefix).
    // OpenVPN identifies peers by username (common_name in cert).
    const isWireGuard = env.VPN_TYPE === 'wireguard'
    const body = isWireGuard
      ? {
          public_key: client.commonName,  // first 16 chars of WG public key
          vpn_ip: client.virtualAddress,
          real_ip: client.realAddress.split(':')[0],
          node_id: env.AGENT_NODE_ID,
          client_version: 'WireGuard',
          device_name: 'WireGuard Client',
        }
      : {
          username: client.commonName,
          vpn_ip: client.virtualAddress,
          real_ip: client.realAddress.split(':')[0],
          node_id: env.AGENT_NODE_ID,
          client_version: 'OpenVPN',
          device_name: 'Unknown Device',
        }

    const response = await fetch(`${env.AGENT_MANAGER_URL}/api/v1/vpn/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VPN-Token': env.VPN_TOKEN,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    })
    
    if (!response.ok) {
      const text = await response.text()
      console.error(`[status-monitor] ✗ Connect API failed: ${response.status} ${text}`)
      return
    }
    
    const data = await response.json() as { session_id: string }
    console.log(`[status-monitor] ✓ ${client.commonName} connected → session ${data.session_id}`)
  } catch (err) {
    console.error('[status-monitor] ✗ Connect API error:', (err as Error).message)
  }
}

/**
 * Handle client disconnect event
 */
async function handleDisconnect(env: AgentEnv, client: StatusClient): Promise<void> {
  try {
    const response = await fetch(`${env.AGENT_MANAGER_URL}/api/v1/vpn/disconnect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VPN-Token': env.VPN_TOKEN,
      },
      body: JSON.stringify({
        username: client.commonName,
        node_id: env.AGENT_NODE_ID,
        bytes_sent: client.bytesSent,
        bytes_received: client.bytesReceived,
        disconnect_reason: 'normal',
      }),
      signal: AbortSignal.timeout(5000),
    })
    
    if (!response.ok) {
      const text = await response.text()
      console.error(`[status-monitor] Disconnect API failed: ${response.status} ${text}`)
      return
    }
    
    console.log(`[status-monitor] ✓ ${client.commonName} disconnected`)
  } catch (err) {
    console.error('[status-monitor] Disconnect API error:', (err as Error).message)
  }
}

/**
 * Check for client changes
 */
async function checkClientChanges(env: AgentEnv): Promise<void> {
  const currentClients = parseStatus(env)
  const currentMap = new Map<string, StatusClient>()
  
  // Build current clients map
  for (const client of currentClients) {
    currentMap.set(client.commonName, client)
  }
  
  // Detect new connections
  for (const [commonName, client] of currentMap) {
    if (!previousClients.has(commonName)) {
      console.log(`[status-monitor] 🆕 New client detected: ${commonName}`)
      await handleConnect(env, client)
    }
  }
  
  // Detect disconnections
  for (const [commonName, client] of previousClients) {
    if (!currentMap.has(commonName)) {
      console.log(`[status-monitor] 👋 Client disconnected: ${commonName}`)
      await handleDisconnect(env, client)
    }
  }
  
  // Update previous clients
  previousClients = currentMap
}

/**
 * Start monitoring VPN status
 */
export function startStatusMonitor(env: AgentEnv): void {
  if (isMonitoring) {
    console.warn('[status-monitor] Already monitoring')
    return
  }
  
  console.log('📊 Status monitor started')
  console.log(`   VPN Type: ${env.VPN_TYPE}`)
  console.log(`   Checking every 1s for client changes`)
  
  // Validate VPN-specific requirements
  if (env.VPN_TYPE === 'openvpn') {
    const statusFilePath = '/var/log/openvpn/status.log'
    if (!existsSync(statusFilePath)) {
      console.error(`[status-monitor] ✗ Status file not found: ${statusFilePath}`)
      console.error('[status-monitor] Make sure:')
      console.error('  1. OpenVPN is running')
      console.error('  2. Status file is configured in OpenVPN config')
      console.error('  3. Volume is mounted in Docker (if using Docker)')
      console.error('  4. Agent has read permission to the file')
      return
    }
  } else if (env.VPN_TYPE === 'wireguard') {
    // Check if wg command is available
    try {
      execSync('which wg', { stdio: 'ignore' })
    } catch {
      console.error('[status-monitor] ✗ WireGuard command not found')
      console.error('[status-monitor] Make sure:')
      console.error('  1. WireGuard is installed')
      console.error('  2. Agent has permission to run wg command')
      console.error('  3. WireGuard interface is configured')
      return
    }
  }
  
  // Initial load
  const initialClients = parseStatus(env)
  for (const client of initialClients) {
    previousClients.set(client.commonName, client)
  }
  
  if (initialClients.length > 0) {
    console.log(`[status-monitor] Found ${initialClients.length} existing client(s)`)
    
    // Sync existing clients to database (in case agent restarted while clients connected)
    for (const client of initialClients) {
      // Don't await - fire and forget
      void handleConnect(env, client).catch(err => {
        console.error(`[status-monitor] Failed to sync ${client.commonName}:`, err)
      })
    }
  }
  
  // Watch for changes using interval polling
  const intervalId = setInterval(() => {
    void checkClientChanges(env)
  }, 1000)
  
  // Store interval ID for cleanup
  ;(global as any).__statusMonitorInterval = intervalId
  
  isMonitoring = true
}

/**
 * Stop monitoring
 */
export function stopStatusMonitor(): void {
  if ((global as any).__statusMonitorInterval) {
    clearInterval((global as any).__statusMonitorInterval)
    delete (global as any).__statusMonitorInterval
  }
  isMonitoring = false
  previousClients.clear()
}

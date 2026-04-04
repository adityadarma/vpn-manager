import { readFileSync, existsSync } from 'node:fs'
import type { VpnDriver } from '../drivers'

/**
 * Parse OpenVPN server config and sync to database
 * This ensures client configs match actual server settings
 */
export async function handleSyncServerConfig(_payload: Record<string, unknown>, _driver: VpnDriver): Promise<Record<string, unknown>> {
  const SERVER_CONFIG_PATH = '/etc/openvpn/server/server.conf'

  // Get agent configuration from environment
  const MANAGER_URL = process.env.AGENT_MANAGER_URL
  const NODE_TOKEN = process.env.AGENT_SECRET_TOKEN

  if (!MANAGER_URL || !NODE_TOKEN) {
    throw new Error('AGENT_MANAGER_URL and AGENT_SECRET_TOKEN must be set')
  }

  // Check if server config exists
  if (!existsSync(SERVER_CONFIG_PATH)) {
    throw new Error(`Server config not found at ${SERVER_CONFIG_PATH}`)
  }

  try {
    // Read and parse server config
    const configContent = readFileSync(SERVER_CONFIG_PATH, 'utf-8')
    const config = parseServerConfig(configContent)

    console.log('[sync-server-config] Parsed server configuration:')
    console.log(`  Port: ${config.port}`)
    console.log(`  Protocol: ${config.protocol}`)
    console.log(`  Cipher: ${config.cipher}`)
    console.log(`  Auth: ${config.auth}`)
    console.log(`  VPN Network: ${config.vpnNetwork}/${config.vpnNetmask}`)

    // Upload config to API
    const syncUrl = `${MANAGER_URL}/api/v1/nodes/sync-config`
    console.log(`[sync-server-config] Uploading config to: ${syncUrl}`)

    const response = await fetch(syncUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NODE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(config),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to upload config: HTTP ${response.status} - ${errorText}`)
    }

    const result = await response.json() as { success: boolean; message: string; node_id: string }
    console.log('[sync-server-config] ✓ Server config synced successfully to database')

    return {
      success: true,
      message: 'Server config synced to database',
      config,
      node_id: result.node_id
    }
  } catch (error: any) {
    console.error('[sync-server-config] Failed to sync config:', error.message)
    throw new Error(`Failed to sync server config: ${error.message}`)
  }
}

/**
 * Parse OpenVPN server config file
 */
function parseServerConfig(content: string): Record<string, any> {
  const lines = content.split('\n')
  const config: Record<string, any> = {
    port: 1194,
    protocol: 'udp',
    cipher: 'AES-128-GCM',
    auth: 'SHA256',
    vpnNetwork: '10.8.0.0',
    vpnNetmask: '255.255.255.0',
    dnsServers: '',
    pushRoutes: '',
    customPushDirectives: '',
    compression: 'none',
    keepalivePing: 10,
    keepaliveTimeout: 120,
    maxClients: 100,
    tunnelMode: 'full'
  }

  const customLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const parts = trimmed.split(/\s+/)
    const directive = parts[0]

    switch (directive) {
      case 'port':
        config.port = parseInt(parts[1], 10)
        break
      case 'proto':
        config.protocol = parts[1]
        break
      case 'cipher':
        config.cipher = parts[1]
        break
      case 'auth':
        config.auth = parts[1]
        break
      case 'server':
        config.vpnNetwork = parts[1]
        config.vpnNetmask = parts[2]
        break
      case 'push': {
        // Strip outer quotes: push "dhcp-option DNS 1.1.1.1" → dhcp-option DNS 1.1.1.1
        const pushArg = parts.slice(1).join(' ').replace(/^"|"$/g, '')
        if (pushArg.startsWith('dhcp-option DNS ')) {
          const dns = pushArg.slice('dhcp-option DNS '.length).trim()
          config.dnsServers = config.dnsServers ? `${config.dnsServers},${dns}` : dns
        } else if (pushArg.startsWith('route ')) {
          const route = pushArg.slice('route '.length).trim()
          config.pushRoutes = config.pushRoutes ? `${config.pushRoutes},${route}` : route
        } else if (pushArg.startsWith('redirect-gateway')) {
          config.tunnelMode = 'full'
        } else {
          // Any other push directive → custom
          customLines.push(pushArg)
        }
        break
      }
      case 'comp-lzo':
        config.compression = parts[1] || 'lzo'
        break
      case 'compress':
        config.compression = parts[1] || 'lz4-v2'
        break
      case 'keepalive':
        config.keepalivePing = parseInt(parts[1], 10)
        config.keepaliveTimeout = parseInt(parts[2], 10)
        break
      case 'max-clients':
        config.maxClients = parseInt(parts[1], 10)
        break
    }
  }

  config.customPushDirectives = customLines.join('\n')

  if (!content.includes('redirect-gateway')) {
    config.tunnelMode = 'split'
  }

  return config
}

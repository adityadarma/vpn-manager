import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { exec, execSync } from 'node:child_process'
import { promisify } from 'node:util'
import type { VpnDriver } from '../drivers'

const execAsync = promisify(exec)

interface UpdateServerConfigParams {
  port: number
  protocol: 'udp' | 'tcp'
  tunnel_mode: 'full' | 'split'
  vpn_network: string
  vpn_netmask: string
  dns_servers: string
  push_routes?: string
  compression: string
  cipher: string
  keepalive_ping: number
  keepalive_timeout: number
  /** CIDR strings for all groups (e.g. ["10.8.2.0/24","10.8.3.0/24"]).
   *  The agent generates a `route` directive for each that falls outside
   *  the server pool, allowing CCD ifconfig-push from those subnets. */
  group_subnets?: string[]
  custom_push_directives?: string
}

// ── Subnet helpers ──────────────────────────────────────────────────────────

/** Convert dotted-decimal netmask to prefix length (e.g. "255.255.255.0" → 24). */
function netmaskToPrefix(netmask: string): number {
  return netmask
    .split('.')
    .reduce((bits, oct) => bits + (parseInt(oct, 10).toString(2).match(/1/g) ?? []).length, 0)
}

/** Convert prefix length to dotted-decimal netmask (e.g. 24 → "255.255.255.0"). */
function prefixToNetmask(prefix: number): string {
  const mask = (0xffffffff << (32 - prefix)) >>> 0
  return [24, 16, 8, 0].map(s => (mask >> s) & 0xff).join('.')
}

/** Convert dotted-decimal IP to 32-bit integer. */
function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, oct) => (acc << 8) | parseInt(oct, 10), 0) >>> 0
}

/** Convert 32-bit integer to dotted-decimal IP. */
function intToIp(n: number): string {
  return [24, 16, 8, 0].map(s => (n >> s) & 0xff).join('.')
}

/** Parse "10.8.3.0/24" or "10.8.3.0 255.255.255.0" into {network, netmask}. */
function parseCidr(cidr: string): { network: string; netmask: string } | null {
  if (cidr.includes('/')) {
    const [network, prefixStr] = cidr.split('/')
    const prefix = parseInt(prefixStr, 10)
    if (isNaN(prefix) || prefix < 0 || prefix > 32) return null
    return { network, netmask: prefixToNetmask(prefix) }
  }
  const parts = cidr.trim().split(/\s+/)
  if (parts.length === 2) return { network: parts[0], netmask: parts[1] }
  return null
}

/**
 * Returns true if subnetA is completely contained within subnetB.
 * Used to skip generating a `route` directive when the group subnet is
 * already inside the server pool.
 */
function isSubnetContainedIn(
  subNet: string, subMask: string,
  poolNet: string, poolMask: string,
): boolean {
  const poolPrefix = netmaskToPrefix(poolMask)
  const subPrefix  = netmaskToPrefix(subMask)
  if (subPrefix < poolPrefix) return false // subnet is wider than pool → not contained
  const poolInt = ipToInt(poolNet) & ipToInt(poolMask)
  const subInt  = ipToInt(subNet)  & ipToInt(poolMask) // mask to pool-width
  return poolInt === subInt
}

/**
 * Return the network address of a CIDR (zeroes host bits).
 * e.g. "10.8.3.10", "255.255.255.0" → "10.8.3.0"
 */
function networkAddress(ip: string, netmask: string): string {
  return intToIp(ipToInt(ip) & ipToInt(netmask))
}

// ── Main handler ────────────────────────────────────────────────────────────

export async function handleUpdateServerConfig(params: Record<string, unknown>, driver: VpnDriver): Promise<Record<string, unknown>> {
  const config = params as unknown as UpdateServerConfigParams

  if (!config.vpn_network || !config.vpn_netmask) {
    throw new Error('Missing required parameters: vpn_network, vpn_netmask')
  }

  const VPN_TYPE = process.env.VPN_TYPE || 'openvpn'

  if (VPN_TYPE === 'wireguard') {
    const WG_CONF = '/etc/wireguard/wg0.conf'
    if (!existsSync(WG_CONF)) {
      throw new Error('WireGuard config not found. Please install VPN server first.')
    }
    
    const wgPrefix = netmaskToPrefix(config.vpn_netmask)
    const serverNet = networkAddress(config.vpn_network, config.vpn_netmask)
    const serverIp = intToIp(ipToInt(serverNet) + 1)
    
    // Update Address and port via sed (to preserve peers!)
    
    await execAsync(`sed -i 's|^Address = .*|Address = ${serverIp}/${wgPrefix}|' ${WG_CONF}`)
    if (config.port) {
      await execAsync(`sed -i 's|^ListenPort = .*|ListenPort = ${config.port}|' ${WG_CONF}`)
    }
    
    // Restart interface
    try {
      await execAsync('wg-quick down wg0 || true')
      await execAsync('wg-quick up wg0')
      console.log('[update-config] WireGuard restarted with new config')
    } catch (e: any) {
      throw new Error('Failed to restart WireGuard: ' + e.message)
    }
    
    return {
      success: true,
      message: 'WireGuard configuration updated successfully. Interface restarted.',
      configPath: WG_CONF
    }
  }

  const CONFIG_PATH = '/etc/openvpn/server/server.conf'
  const BACKUP_PATH = '/etc/openvpn/server/server.conf.backup'

  if (!existsSync(CONFIG_PATH)) {
    throw new Error('VPN server config not found. Please install VPN server first.')
  }

  // Defaults
  const port              = config.port              || 1194
  const protocol          = config.protocol          || 'udp'
  const dnsServers        = config.dns_servers       || '8.8.8.8,1.1.1.1'
  const tunnelMode        = config.tunnel_mode       || 'full'
  const cipher            = config.cipher            || 'AES-256-GCM'
  const keepalivePing     = config.keepalive_ping    || 10
  const keepaliveTimeout  = config.keepalive_timeout || 120
  const enableCompression = config.compression === 'lz4-v2'

  // Detect OpenVPN version — data-ciphers was introduced in 2.5 (renamed from ncp-ciphers)
  let cipherDirective = 'data-ciphers'
  try {
    const { stdout } = await execAsync('openvpn --version 2>/dev/null || true')
    const match = stdout.match(/OpenVPN\s+(\d+)\.(\d+)/)
    if (match) {
      const major = parseInt(match[1], 10)
      const minor = parseInt(match[2], 10)
      if (major < 2 || (major === 2 && minor < 5)) {
        cipherDirective = 'ncp-ciphers'
      }
    }
  } catch {
    // fallback to data-ciphers (safe for OpenVPN 2.5+)
  }
  console.log(`[update-config] Using cipher directive: ${cipherDirective}`)

  const customRoutes = config.push_routes
    ? config.push_routes.split(',').map(r => r.trim()).filter(Boolean)
    : []

  const customPushLines = (config.custom_push_directives ?? '')
    .split('\n').map(l => l.trim()).filter(Boolean)

    // ── Compute group-subnet route directives ──────────────────────────────────
    // For every group subnet that is NOT already inside the server pool we emit
    // a `route <network> <netmask>` directive.  This tells OpenVPN to accept
    // and route packets for that subnet through the tun interface, which allows
    // CCD files to use `ifconfig-push` IPs from those subnets.
    const serverNet  = networkAddress(config.vpn_network, config.vpn_netmask)
    const serverMask = config.vpn_netmask

    // Detect network change to clean up stale CCD files
    const CCD_DIR = '/etc/openvpn/ccd'
    const NETWORK_MARKER = `${CCD_DIR}/.current_network`
    const currentNetworkString = `${config.vpn_network}/${config.vpn_netmask}`
    
    if (existsSync(CCD_DIR)) {
      let previousNetwork = ''
      try {
        if (existsSync(NETWORK_MARKER)) {
          previousNetwork = readFileSync(NETWORK_MARKER, 'utf-8').trim()
        }
        
        if (previousNetwork && previousNetwork !== currentNetworkString) {
          console.log(`[update-config] Network changed from ${previousNetwork} to ${currentNetworkString}. Cleaning up stale CCD files...`)
          // Use the static execSync imported at the top
          execSync(`find ${CCD_DIR} -type f ! -name ".current_network" -delete`)
          console.log('[update-config] CCD directory cleaned.')
        }
        
        writeFileSync(NETWORK_MARKER, currentNetworkString)
      } catch (err: any) {
        console.error('[update-config] Failed to process CCD cleanup:', err.message)
      }
    }

    const extraRoutes: Array<{ network: string; netmask: string; cidr: string }> = []

  for (const cidr of (config.group_subnets ?? [])) {
    const parsed = parseCidr(cidr)
    if (!parsed) {
      console.warn(`[update-config] Skipping unparseable group subnet: ${cidr}`)
      continue
    }
    const groupNet  = networkAddress(parsed.network, parsed.netmask)
    const groupMask = parsed.netmask

    if (isSubnetContainedIn(groupNet, groupMask, serverNet, serverMask)) {
      // Already inside the server pool — no extra route needed
      console.log(`[update-config] Group subnet ${cidr} is inside server pool — skipping route`)
      continue
    }

    // Deduplicate
    const already = extraRoutes.some(r => r.network === groupNet && r.netmask === groupMask)
    if (!already) {
      extraRoutes.push({ network: groupNet, netmask: groupMask, cidr })
      console.log(`[update-config] Will add route for group subnet: ${groupNet} ${groupMask}`)
    }
  }

  try {
    const currentConfig = readFileSync(CONFIG_PATH, 'utf-8')
    writeFileSync(BACKUP_PATH, currentConfig)
    console.log('[update-config] Backed up current config')

    const dnsArray = dnsServers.split(',').map((d: string) => d.trim()).filter(Boolean)

    // ── Build server.conf ────────────────────────────────────────────────────
    let newConfig = `# VPN Server Configuration
# Generated by VPN Manager
# Last updated: ${new Date().toISOString()}

port ${port}
proto ${protocol}
dev tun

ca /etc/openvpn/server/ca.crt
cert /etc/openvpn/server/server.crt
key /etc/openvpn/server/server.key
dh none
tls-crypt /etc/openvpn/server/tls-crypt.key

# Server pool — as configured by admin
server ${config.vpn_network} ${config.vpn_netmask}
topology subnet

`

    // Route directives for group subnets outside the server pool
    if (extraRoutes.length > 0) {
      newConfig += `# Routes for group subnets outside the server pool\n`
      newConfig += `# These allow CCD ifconfig-push to assign IPs from these subnets.\n`
      for (const r of extraRoutes) {
        newConfig += `route ${r.network} ${r.netmask}\n`
      }
      newConfig += '\n'
    }

    newConfig += `# DNS Configuration\n`
    dnsArray.forEach((dns: string) => {
      newConfig += `push "dhcp-option DNS ${dns}"\n`
    })

    if (customPushLines.length > 0) {
      newConfig += `\n# Custom Push Directives\n`
      customPushLines.forEach(line => {
        newConfig += line.startsWith('push ') ? `${line}\n` : `push "${line}"\n`
      })
    }

    newConfig += `\n# Tunnel Mode: ${tunnelMode}\n`

    if (tunnelMode === 'full') {
      newConfig += `push "redirect-gateway def1 bypass-dhcp"\n`
    } else {
      newConfig += `# Split tunnel - only route specific networks\n`
      customRoutes.forEach(route => {
        newConfig += `push "route ${route}"\n`
      })
    }

    newConfig += `
# Connection Settings
keepalive ${keepalivePing} ${keepaliveTimeout}
explicit-exit-notify 1
cipher ${cipher}
${cipherDirective} ${cipher}
auth SHA256
tls-server
tls-version-min 1.2
tls-cipher TLS-ECDHE-RSA-WITH-AES-256-GCM-SHA384
persist-key
persist-tun
`

    if (enableCompression) {
      newConfig += `compress lz4-v2\npush "compress lz4-v2"\n`
    }

    newConfig += `
# Drop privileges (comment out if you have permission issues)
user nobody
group nogroup

# Logging
status /var/log/openvpn/status.log 1
status-version 3
log /var/log/openvpn/openvpn.log
verb 3

script-security 2

# Management Interface
management /run/openvpn/server.sock unix

# Client Config Directory — required for per-user IP assignments (ifconfig-push in CCD)
client-config-dir /etc/openvpn/ccd

# Check revoked certificates
crl-verify /etc/openvpn/server/crl.pem
`

    // Ensure CRL exists to prevent OpenVPN startup failure
    const CRL_PATH = '/etc/openvpn/server/crl.pem'
    const EASYRSA_DIR = '/etc/openvpn/easy-rsa'
    if (!existsSync(CRL_PATH)) {
      console.log(`[update-config] CRL not found at ${CRL_PATH}. Generating...`)
      if (existsSync(EASYRSA_DIR)) {
        try {
          execSync(`./easyrsa --batch gen-crl`, { cwd: EASYRSA_DIR })
          execSync(`cp ${EASYRSA_DIR}/pki/crl.pem ${CRL_PATH}`)
          execSync(`chmod 644 ${CRL_PATH}`)
          console.log('[update-config] Initial CRL generated successfully.')
        } catch (crlErr: any) {
          console.error('[update-config] Failed to generate initial CRL:', crlErr.message)
        }
      } else {
        // If easy-rsa is not available, touch an empty file just so OpenVPN doesn't crash, 
        // though it might still complain if it's not a valid PEM. 
        // Usually easy-rsa is where we expect it to be.
      }
    }

    writeFileSync(CONFIG_PATH, newConfig)
    console.log('[update-config] Wrote new config')
    if (extraRoutes.length > 0) {
      console.log(`[update-config] Added ${extraRoutes.length} group-subnet route(s): ${extraRoutes.map(r => r.cidr).join(', ')}`)
    }

    // Reload OpenVPN
    try {
      await driver.sendCommand('signal SIGHUP')
      console.log('[update-config] Sent SIGHUP signal to OpenVPN')
    } catch (err) {
      console.error('[update-config] Failed to send SIGHUP:', err)
      writeFileSync(CONFIG_PATH, currentConfig)
      throw new Error('Failed to reload VPN. Config restored from backup.')
    }

    console.log('[update-config] Waiting for OpenVPN to reload...')
    await new Promise(resolve => setTimeout(resolve, 5000))

    return {
      success: true,
      message: 'Server configuration updated successfully. OpenVPN is reloading.',
      configPath: CONFIG_PATH,
      backupPath: BACKUP_PATH,
      groupRoutes: extraRoutes.map(r => `${r.network} ${r.netmask}`),
      note: 'OpenVPN will reconnect automatically after reload completes',
    }
  } catch (error: any) {
    console.error('[update-config] Error:', error.message)
    throw new Error(`Failed to update server config: ${error.message}`)
  }
}
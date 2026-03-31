import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import type { VpnDriver } from '../drivers'
import { loadAgentEnv } from '../config/env'

interface WriteClientCcdParams {
  username: string
  vpn_ip: string
  netmask?: string        // default: 255.255.255.0
  extra_lines?: string[]  // any additional CCD directives to merge
}

const CCD_DIR = process.env.OPENVPN_CCD_DIR ?? '/etc/openvpn/ccd'

/**
 * Write (or update) a CCD file for a user with ifconfig-push.
 *
 * CCD file format:
 *   ifconfig-push <vpn_ip> <netmask>
 *   [optional: disable]
 *   [optional: extra lines]
 *
 * If the file already exists (e.g. user was kicked with "disable"),
 * we preserve the "disable" line and only update the ifconfig-push line.
 */
export async function handleWriteClientCcd(
  params: Record<string, unknown>,
  _driver: VpnDriver,
): Promise<Record<string, unknown>> {
  const { username, vpn_ip, netmask = '255.255.255.0', extra_lines = [], public_key } = params as any

  if (!username || !vpn_ip) {
    throw new Error('username and vpn_ip are required')
  }

  const env = loadAgentEnv()

  // WIRE GUARD LOGIC
  if (env.VPN_TYPE === 'wireguard') {
    if (!public_key) {
      console.warn(`[write-ccd] Warning: No public key provided for WireGuard client ${username}. Skipping peer injection.`)
      return { success: false, reason: 'missing_public_key' }
    }

    const iface = env.WIREGUARD_INTERFACE || 'wg0'
    try {
      // Inject peer into active WireGuard interface
      execSync(`wg set ${iface} peer ${public_key} allowed-ips ${vpn_ip}/32`)
      console.log(`[write-ccd] ✓ WireGuard peer injected for ${username} with IP ${vpn_ip}/32`)
      
      // Persist the active state back to wg0.conf
      execSync(`wg-quick save ${iface}`)
      console.log(`[write-ccd] ✓ Preserved configuration to /etc/wireguard/${iface}.conf`)
      return { success: true, username, vpn_ip, public_key, interface: iface }
    } catch (err: any) {
      console.error(`[write-ccd] Failed to inject WireGuard peer:`, err.message)
      throw new Error(`WireGuard peer setup failed: ${err.message}`)
    }
  }

  // OPENVPN LOGIC

  // Ensure CCD dir exists
  if (!existsSync(CCD_DIR)) {
    mkdirSync(CCD_DIR, { recursive: true })
    console.log(`[write-ccd] Created CCD directory: ${CCD_DIR}`)
  }

  const ccdPath = join(CCD_DIR, username)

  // Read existing file to preserve "disable" lines (kick state)
  let existingLines: string[] = []
  if (existsSync(ccdPath)) {
    existingLines = readFileSync(ccdPath, 'utf-8')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
  }

  // Preserve disable directive if present (user was kicked)
  const isDisabled = existingLines.some(l => l === 'disable')

  // Build new CCD content
  const lines: string[] = []

  // IP assignment — always first
  lines.push(`ifconfig-push ${vpn_ip} ${netmask}`)

  // Preserve kick state
  if (isDisabled) {
    lines.push('disable')
    console.log(`[write-ccd] Preserving "disable" for kicked user: ${username}`)
  }

  // Extra directives (e.g. push routes, iroute)
  for (const line of extra_lines as string[]) {
    if (line.trim()) lines.push(line.trim())
  }

  const content = lines.join('\n') + '\n'
  writeFileSync(ccdPath, content, { encoding: 'utf-8', mode: 0o644 })

  console.log(`[write-ccd] ✓ CCD written for ${username}: ${ccdPath}`)
  console.log(`[write-ccd]   ifconfig-push ${vpn_ip} ${netmask}`)

  return {
    success: true,
    username,
    vpn_ip,
    netmask,
    ccd_path: ccdPath,
    is_disabled: isDisabled,
  }
}

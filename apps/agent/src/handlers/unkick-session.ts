import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import type { VpnDriver } from '../drivers'
import { loadAgentEnv } from '../config/env'

/**
 * unkick_vpn_session handler
 *
 * Payload: { common_name: string }
 *
 * Removes the CCD `disable` file written by a permanent kick, restoring
 * the user's ability to reconnect to the VPN.
 */

const CCD_DIR = process.env['OPENVPN_CCD_DIR'] ?? '/etc/openvpn/ccd'

export async function handleUnkickSession(
  payload: Record<string, unknown>,
  _driver: VpnDriver,
): Promise<Record<string, unknown>> {
  const { common_name } = payload

  if (!common_name || typeof common_name !== 'string') {
    throw new Error('unkick_vpn_session: common_name is required in payload')
  }

  const env = loadAgentEnv()

  // WIRE GUARD LOGIC
  if (env.VPN_TYPE === 'wireguard') {
    const { public_key, vpn_ip } = payload as any
    if (!public_key || !vpn_ip) {
      console.warn(`[unkick-session] Missing public_key or vpn_ip for WireGuard peer ${common_name}`)
      return { unkicked: false, common_name, error: 'missing_payload_data' }
    }

    const iface = env.WIREGUARD_INTERFACE || 'wg0'
    try {
      // Re-inject the peer that was removed during permanent kick
      execSync(`wg set ${iface} peer ${public_key} allowed-ips ${vpn_ip}/32`)
      execSync(`wg-quick save ${iface}`)
      console.log(`[unkick-session] ✓ WireGuard peer ${common_name} restored to ${iface}`)
      return { unkicked: true, common_name, method: 'wg_restore' }
    } catch (err: any) {
      console.error(`[unkick-session] Failed to restore WireGuard peer:`, err.message)
      throw new Error(`WireGuard peer restore failed: ${err.message}`)
    }
  }

  // OPENVPN LOGIC
  const ccdFile = path.join(CCD_DIR, common_name)

  if (!existsSync(ccdFile)) {
    console.log(`[unkick-session] No CCD file found for ${common_name} — nothing to remove`)
    return { unkicked: true, common_name, note: 'no_ccd_file' }
  }

  try {
    const content = readFileSync(ccdFile, 'utf-8')

    if (content.trim() === 'disable') {
      // File only contains disable — remove it entirely
      unlinkSync(ccdFile)
      console.log(`[unkick-session] ✓ Removed CCD disable file: ${ccdFile}`)
      return { unkicked: true, common_name, ccd_file_removed: true }
    } else if (content.includes('disable')) {
      // File has other rules — only strip the disable line
      const cleaned = content
        .split('\n')
        .filter(l => l.trim() !== 'disable')
        .join('\n')
        .trimEnd() + '\n'
      writeFileSync(ccdFile, cleaned, 'utf-8')
      console.log(`[unkick-session] ✓ Removed disable line from: ${ccdFile}`)
      return { unkicked: true, common_name, ccd_file_updated: true }
    } else {
      console.log(`[unkick-session] CCD file exists but has no disable line: ${ccdFile}`)
      return { unkicked: true, common_name, note: 'no_disable_line' }
    }
  } catch (err) {
    throw new Error(`unkick_vpn_session: Failed to update CCD file: ${(err as Error).message}`)
  }
}

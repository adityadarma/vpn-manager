import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import type { VpnDriver } from '../drivers'
import { loadAgentEnv } from '../config/env'

const CCD_DIR = '/etc/openvpn/ccd'

/**
 * Delete a user's CCD file (OpenVPN) or remove their WireGuard peer.
 * Called when a user is removed from a group and loses their VPN IP.
 */
export async function handleDeleteClientCcd(
  params: Record<string, unknown>,
  _driver: VpnDriver,
): Promise<Record<string, unknown>> {
  const { username, public_key } = params as { username: string; public_key?: string }

  if (!username) {
    throw new Error('username is required')
  }

  const env = loadAgentEnv()

  if (env.VPN_TYPE === 'wireguard') {
    if (!public_key) {
      console.warn(`[delete-ccd] No public key provided for WireGuard client ${username}, skipping peer removal`)
      return { success: false, reason: 'missing_public_key' }
    }
    try {
      execSync(`wg set wg0 peer ${public_key} remove`)
      execSync(`wg-quick save wg0`)
      console.log(`[delete-ccd] ✓ WireGuard peer removed for ${username}`)
      return { success: true, username }
    } catch (err: any) {
      throw new Error(`Failed to remove WireGuard peer: ${err.message}`)
    }
  }

  // OpenVPN: delete CCD file
  const ccdPath = join(CCD_DIR, username)
  if (existsSync(ccdPath)) {
    unlinkSync(ccdPath)
    console.log(`[delete-ccd] ✓ CCD file deleted: ${ccdPath}`)
    return { success: true, username, ccd_path: ccdPath }
  }

  console.log(`[delete-ccd] CCD file not found (already gone): ${ccdPath}`)
  return { success: true, username, ccd_path: ccdPath, note: 'file_not_found' }
}

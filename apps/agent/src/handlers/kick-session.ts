import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'
import net from 'node:net'
import type { VpnDriver } from '../drivers'
import { loadAgentEnv } from '../config/env'

/**
 * kick_vpn_session handler
 *
 * Payload: { common_name: string; permanent?: boolean }
 *
 * permanent = false (default) — Kick only:
 *   Drops the current tunnel. User can reconnect normally after the
 *   keepalive timeout (~10-120s depending on server config).
 *
 * permanent = true — Kick & block:
 *   Drops the current tunnel AND writes a CCD `disable` file so
 *   OpenVPN rejects all future reconnect attempts for this client.
 *   Requires server.conf: client-config-dir /etc/openvpn/ccd
 *   To unkick, remove the file: rm /etc/openvpn/ccd/<username>
 *   or call the unkick endpoint (if implemented).
 */

const MGMT_SOCKET = '/run/openvpn/server.sock'
const CCD_DIR = '/etc/openvpn/ccd'

// ── Raw management socket kill ─────────────────────────────────────────────
// Opens a dedicated connection so it never conflicts with the driver's
// async command queue when realtime events arrive concurrently.
function killViaRawSocket(commonName: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    let response = ''

    const timeout = setTimeout(() => {
      socket.destroy()
      reject(new Error('Raw socket kill timed out after 8s'))
    }, 8000)

    socket.connect(MGMT_SOCKET, () => {
      socket.write(`kill ${commonName}\n`)
    })

    socket.on('data', (chunk) => {
      response += chunk.toString()
      if (response.includes('SUCCESS:') || response.includes('ERROR:')) {
        clearTimeout(timeout)
        socket.destroy()
        if (response.includes('ERROR:')) {
          reject(new Error(`Management kill error: ${response.trim()}`))
        } else {
          resolve(response.trim())
        }
      }
    })

    socket.on('error', (err) => {
      clearTimeout(timeout)
      reject(new Error(`Raw socket error: ${err.message}`))
    })

    socket.on('close', () => {
      clearTimeout(timeout)
      // Socket closed before SUCCESS/ERROR — usually means kill already fired
      if (!response.includes('ERROR:')) {
        resolve(response.trim() || 'socket closed after kill')
      }
    })
  })
}

// ── CCD helpers ────────────────────────────────────────────────────────────

function writeCcdDisable(commonName: string): void {
  try {
    if (!existsSync(CCD_DIR)) {
      require('node:fs').mkdirSync(CCD_DIR, { recursive: true })
      console.log(`[kick-session] Created CCD directory: ${CCD_DIR}`)
    }

    const ccdFile = path.join(CCD_DIR, commonName)
    let existing = ''
    try { existing = readFileSync(ccdFile, 'utf-8') } catch { /* new file */ }

    if (!existing.includes('disable')) {
      const content = existing ? `${existing.trimEnd()}\ndisable\n` : 'disable\n'
      writeFileSync(ccdFile, content, 'utf-8')
      console.log(`[kick-session] ✓ CCD disable written: ${ccdFile}`)
    } else {
      console.log(`[kick-session] CCD disable already present: ${ccdFile}`)
    }
  } catch (err) {
    console.error(`[kick-session] ✗ Failed to write CCD disable: ${(err as Error).message}`)
    console.error('[kick-session]   Check that /etc/openvpn/ccd is mounted in docker-compose')
  }
}

function removeCcdDisable(commonName: string): void {
  try {
    const ccdFile = path.join(CCD_DIR, commonName)
    if (!existsSync(ccdFile)) return

    const content = readFileSync(ccdFile, 'utf-8')
    if (content.trim() === 'disable') {
      unlinkSync(ccdFile)
      console.log(`[kick-session] Removed leftover CCD disable: ${ccdFile}`)
    } else if (content.includes('disable')) {
      const cleaned = content.split('\n').filter(l => l.trim() !== 'disable').join('\n').trimEnd() + '\n'
      writeFileSync(ccdFile, cleaned, 'utf-8')
      console.log(`[kick-session] Removed disable line from CCD: ${ccdFile}`)
    }
  } catch (err) {
    console.warn(`[kick-session] Could not remove CCD disable: ${(err as Error).message}`)
  }
}

export async function handleKickSession(
  payload: Record<string, unknown>,
  driver: VpnDriver,
): Promise<Record<string, unknown>> {
  const { common_name, permanent = false } = payload

  if (!common_name || typeof common_name !== 'string') {
    throw new Error('kick_vpn_session: common_name is required in payload')
  }

  const result: Record<string, unknown> = {
    kicked: false,
    common_name,
    permanent,
    kill_method: null,
    kill_response: null,
  }

  const env = loadAgentEnv()

  // ── WIRE GUARD LOGIC ─────────────────────────────────────────────────────
  if (env.VPN_TYPE === 'wireguard') {
    const { public_key, vpn_ip } = payload as any
    if (!public_key) {
      console.warn(`[kick-session] Missing public_key for WireGuard peer ${common_name}`)
      result.error = 'missing_public_key'
      return result
    }

    const iface = 'wg0'
    try {
      if (permanent) {
        // PERMANENT: Remove peer from wg0 and save config
        execSync(`wg set ${iface} peer ${public_key} remove`)
        execSync(`wg-quick save ${iface}`)
        console.log(`[kick-session] ✓ WireGuard peer ${common_name} PERMANENTLY removed from ${iface}`)
        result.kicked = true
        result.kill_method = 'wg_remove'
        result.ccd_disabled = true
      } else {
        // TEMPORARY KICK: Drop connection by removing and re-adding peer
        if (vpn_ip) {
          execSync(`wg set ${iface} peer ${public_key} remove`)
          // Delay to drop connection, then add back
          setTimeout(() => {
            try {
              execSync(`wg set ${iface} peer ${public_key} allowed-ips ${vpn_ip}/32`)
              console.log(`[kick-session] ✓ WireGuard peer ${common_name} restored after temporary kick`)
            } catch(e: any) {
              console.error(`[kick-session] Failed to restore peer:`, e.message)
            }
          }, 2000)
          console.log(`[kick-session] ✓ WireGuard peer ${common_name} temporarily kicked from ${iface}`)
          result.kicked = true
          result.kill_method = 'wg_temp_remove'
        } else {
          console.warn(`[kick-session] Missing vpn_ip for temporary kick of WireGuard peer ${common_name}`)
        }
      }
      return result
    } catch (err: any) {
      console.error(`[kick-session] WireGuard kill failed:`, err.message)
      throw new Error(`WireGuard kill failed: ${err.message}`)
    }
  }

  // ── OPENVPN LOGIC ────────────────────────────────────────────────────────
  
  // ── CCD management ───────────────────────────────────────────────────────
  if (permanent) {
    // Write disable → blocks all future reconnects via TLS handshake rejection
    writeCcdDisable(common_name)
    result.ccd_disabled = true
  } else {
    // Clean up any leftover disable from a previous permanent kick
    // so the user can reconnect normally after this kick
    removeCcdDisable(common_name)
  }

  // ── Step 1: Raw socket kill (primary) ────────────────────────────────────
  try {
    console.log(`[kick-session] Sending kill via raw socket (permanent=${permanent}): ${MGMT_SOCKET}`)
    const response = await killViaRawSocket(common_name)
    console.log(`[kick-session] ✓ Raw socket kill response: ${response}`)
    result.kicked = true
    result.kill_method = 'raw_socket'
    result.kill_response = response
    return result
  } catch (rawErr) {
    console.warn(`[kick-session] Raw socket kill failed: ${(rawErr as Error).message}`)
    console.warn('[kick-session] Falling back to driver.disconnectClient()...')
  }

  // ── Step 2: Driver fallback ───────────────────────────────────────────────
  if (driver.isConnected()) {
    try {
      await driver.disconnectClient(common_name)
      console.log(`[kick-session] ✓ Driver kill succeeded for: ${common_name}`)
      result.kicked = true
      result.kill_method = 'driver'
      return result
    } catch (driverErr) {
      console.error(`[kick-session] Driver kill failed: ${(driverErr as Error).message}`)
    }
  } else {
    console.warn('[kick-session] Driver not connected to management interface')
  }

  // ── Step 3: socat last resort ─────────────────────────────────────────────
  try {
    console.warn('[kick-session] Trying socat fallback...')
    const output = execSync(
      `printf 'kill ${common_name}\\r\\n' | socat - UNIX-CONNECT:${MGMT_SOCKET}`,
      { encoding: 'utf-8', timeout: 5000 },
    )
    console.log(`[kick-session] ✓ socat kill output: ${output.trim()}`)
    result.kicked = true
    result.kill_method = 'socat'
    result.kill_response = output.trim()
    return result
  } catch (socatErr) {
    console.error(`[kick-session] socat fallback failed: ${(socatErr as Error).message}`)
  }

  console.error(`[kick-session] ✗ All kill methods failed for: ${common_name}`)
  console.error(`[kick-session]   Socket: ${MGMT_SOCKET} | Driver connected: ${driver.isConnected()}`)
  return result
}

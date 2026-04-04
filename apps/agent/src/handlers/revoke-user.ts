import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import type { VpnDriver } from '../drivers'

const execAsync = promisify(exec)

export async function handleRevokeUser(
  payload: Record<string, unknown>,
  driver: VpnDriver,
): Promise<Record<string, unknown>> {
  const username = payload['username'] as string
  if (!username) throw new Error('Missing username in payload')

  const VPN_TYPE = process.env.VPN_TYPE || 'openvpn'

  if (VPN_TYPE === 'wireguard') {
    const pubKey = payload['client_cert'] as string
    if (!pubKey) throw new Error('Missing client_cert (public key) in payload for WireGuard revocation')
    
    // Remove peer from running interface (will also kick them)
    try {
      await execAsync(`wg set wg0 peer ${pubKey} remove`)
      
      console.log(`[revoke-user] WireGuard peer removed: ${pubKey}`)
      return { username, stdout: 'Peer removed' }
    } catch (err: any) {
      throw new Error(`Failed to remove WireGuard peer: ${err.message}`)
    }
  }

  // OpenVPN flow
  const EASYRSA_DIR = '/etc/openvpn/easy-rsa'
  const EASYRSA_BIN = `${EASYRSA_DIR}/easyrsa`

  if (!existsSync(EASYRSA_BIN)) {
    throw new Error(`EasyRSA script not found at ${EASYRSA_BIN}`)
  }

  // Revoke certificate and regenerate CRL
  const { stdout } = await execAsync(
    `${EASYRSA_BIN} --batch revoke ${username} && ${EASYRSA_BIN} gen-crl`,
    { cwd: EASYRSA_DIR }
  )

  // Copy CRL to server directory
  await execAsync(`cp ${EASYRSA_DIR}/pki/crl.pem /etc/openvpn/server/crl.pem`)
  await execAsync(`chmod 644 /etc/openvpn/server/crl.pem`)

  // CRITICAL: Reload OpenVPN FIRST so it loads the new CRL,
  // THEN disconnect the client. This way, when the client auto-reconnects,
  // it is immediately rejected by the updated CRL.
  try {
    await driver.sendCommand('signal SIGHUP')
    console.log(`[revoke-user] Sent SIGHUP — OpenVPN is reloading CRL`)
    // Wait for OpenVPN to finish reloading before kicking
    await new Promise(resolve => setTimeout(resolve, 3000))
  } catch (err) {
    console.error('[revoke-user] Failed to send SIGHUP:', err)
  }

  // Now kick the active client — reconnect will be blocked by the updated CRL
  try {
    await driver.disconnectClient(username)
    console.log(`[revoke-user] Disconnected active client: ${username}`)
  } catch (err) {
    // Client might not be connected, that's ok
  }

  console.log(`[revoke-user] Certificate revoked for: ${username}`)
  return { username, stdout: stdout.trim() }
}

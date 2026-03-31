import { readFileSync, existsSync } from 'node:fs'
import type { VpnDriver } from '../drivers'

export async function handleSyncCertificates(_payload: Record<string, unknown>, _driver: VpnDriver): Promise<Record<string, unknown>> {
  // Get agent configuration from environment
  const MANAGER_URL = process.env.AGENT_MANAGER_URL
  const NODE_TOKEN = process.env.AGENT_SECRET_TOKEN

  if (!MANAGER_URL || !NODE_TOKEN) {
    throw new Error('AGENT_MANAGER_URL and AGENT_SECRET_TOKEN must be set')
  }

  const VPN_TYPE = process.env.VPN_TYPE || 'openvpn'

  if (VPN_TYPE === 'wireguard') {
    const WG_PUB_PATH = '/etc/wireguard/publickey'
    const WG_PRIV_PATH = '/etc/wireguard/privatekey'
    
    if (!existsSync(WG_PUB_PATH) || !existsSync(WG_PRIV_PATH)) {
      throw new Error(`WireGuard keys not found at ${WG_PUB_PATH} or ${WG_PRIV_PATH}`)
    }
    
    const pubKey = readFileSync(WG_PUB_PATH, 'utf-8')
    const privKey = readFileSync(WG_PRIV_PATH, 'utf-8')
    
    console.log('[sync-keys] WireGuard keys read successfully')
    
    const syncUrl = `${MANAGER_URL}/api/v1/nodes/sync-certs`
    const response = await fetch(syncUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NODE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        public_key: pubKey.trim(),
        private_key: privKey.trim(),
      }),
    })

    if (!response.ok) {
      throw new Error(`Failed to upload WireGuard keys: HTTP ${response.status} - ${await response.text()}`)
    }

    const result = await response.json() as { success: boolean; message: string; node_id: string }
    return {
      success: true,
      message: 'WireGuard keys synced to database',
      node_id: result.node_id
    }
  }

  // OpenVPN flow
  const CA_CERT_PATH = '/etc/openvpn/server/ca.crt'
  const TLS_CRYPT_PATH = '/etc/openvpn/server/tls-crypt.key'
  const TLS_AUTH_PATH = '/etc/openvpn/server/ta.key'

  // Check if CA cert exists
  if (!existsSync(CA_CERT_PATH)) {
    throw new Error(`CA certificate not found at ${CA_CERT_PATH}`)
  }

  // Check for TLS key (prefer tls-crypt over tls-auth)
  let tlsKeyPath = TLS_CRYPT_PATH
  if (!existsSync(TLS_CRYPT_PATH)) {
    if (existsSync(TLS_AUTH_PATH)) {
      console.log('[sync-certs] Using tls-auth key (consider upgrading to tls-crypt)')
      tlsKeyPath = TLS_AUTH_PATH
    } else {
      throw new Error('No TLS key found. Please generate tls-crypt.key or ta.key')
    }
  }

  try {
    // Read certificates
    const caCert = readFileSync(CA_CERT_PATH, 'utf-8')
    const tlsKey = readFileSync(tlsKeyPath, 'utf-8')

    if (!caCert || !tlsKey) {
      throw new Error('Failed to read certificate files')
    }

    console.log('[sync-certs] Certificates read successfully')
    console.log(`[sync-certs] CA Cert: ${caCert.length} bytes`)
    console.log(`[sync-certs] TLS Key: ${tlsKey.length} bytes (${tlsKeyPath.includes('tls-crypt') ? 'tls-crypt' : 'tls-auth'})`)

    // Upload certificates to API
    const syncUrl = `${MANAGER_URL}/api/v1/nodes/sync-certs`
    console.log(`[sync-certs] Uploading certificates to: ${syncUrl}`)

    const response = await fetch(syncUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NODE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ca_cert: caCert.trim(),
        ta_key: tlsKey.trim(),
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to upload certificates: HTTP ${response.status} - ${errorText}`)
    }

    const result = await response.json() as { success: boolean; message: string; node_id: string }
    console.log('[sync-certs] ✓ Certificates uploaded successfully to database')

    return {
      success: true,
      message: 'Certificates synced to database',
      ca_cert_size: caCert.length,
      ta_key_size: tlsKey.length,
      tls_method: tlsKeyPath.includes('tls-crypt') ? 'tls-crypt' : 'tls-auth',
      node_id: result.node_id
    }
  } catch (error: any) {
    console.error('[sync-certs] Failed to sync certificates:', error.message)
    throw new Error(`Failed to sync certificates: ${error.message}`)
  }
}

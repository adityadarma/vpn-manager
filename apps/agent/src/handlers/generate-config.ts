import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { VpnDriver } from '../drivers'

const EASY_RSA_PKI = '/etc/openvpn/easy-rsa/pki'
const OPENVPN_CA = `${EASY_RSA_PKI}/ca.crt`

export async function handleGenerateConfig(
  payload: Record<string, unknown>,
  _driver: VpnDriver,
): Promise<Record<string, unknown>> {
  const username = payload['username'] as string
  const serverIp = payload['serverIp'] as string
  const serverPort = (payload['serverPort'] as number) ?? 1194
  const protocol = (payload['protocol'] as string) ?? 'udp'
  const cipher = (payload['cipher'] as string) ?? 'AES-256-GCM'
  const authDigest = (payload['authDigest'] as string) ?? 'SHA256'

  if (!username) throw new Error('Missing username in payload')
  if (!serverIp) throw new Error('Missing serverIp in payload')

  // Read TLS key
  const tlsKeyPath = '/etc/openvpn/server/tls-crypt.key'
  let tlsKey = ''
  try {
    tlsKey = await readFile(tlsKeyPath, 'utf-8')
  } catch (err) {
    // Try fallback to ta.key
    try {
      tlsKey = await readFile('/etc/openvpn/server/ta.key', 'utf-8')
    } catch (err2) {
      console.warn('TLS key not found, config will not include tls-crypt')
    }
  }

  const [ca, cert, key] = await Promise.all([
    readFile(OPENVPN_CA, 'utf-8'),
    readFile(path.join(EASY_RSA_PKI, 'issued', `${username}.crt`), 'utf-8'),
    readFile(path.join(EASY_RSA_PKI, 'private', `${username}.key`), 'utf-8'),
  ])

  // Use tcp-client for TCP protocol
  const protoClient = protocol === 'tcp' ? 'tcp-client' : protocol
  
  // Determine TLS cipher based on server cipher (ECDSA — Easy-RSA configured to use EC/prime256v1)
  let tlsCipher = 'TLS-ECDHE-ECDSA-WITH-AES-128-GCM-SHA256'
  if (cipher.includes('256')) {
    tlsCipher = 'TLS-ECDHE-ECDSA-WITH-AES-256-GCM-SHA384'
  }

  const config = `client
proto ${protoClient}
${protocol === 'udp' ? 'explicit-exit-notify' : ''}
remote ${serverIp} ${serverPort}
dev tun
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
auth ${authDigest}
auth-nocache
cipher ${cipher}
tls-client
tls-version-min 1.2
tls-cipher ${tlsCipher}
ignore-unknown-option block-outside-dns
setenv opt block-outside-dns
verb 3

<ca>
${ca.trim()}
</ca>

<cert>
${cert.trim()}
</cert>

<key>
${key.trim()}
</key>
${tlsKey ? `
<tls-crypt>
${tlsKey.trim()}
</tls-crypt>` : ''}
`.trim()

  return { config, filename: `${username}.ovpn` }
}

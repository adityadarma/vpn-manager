import type { VpnDriver } from '../drivers'
import { assertUsername } from '../core/net-validate'

export async function handleGenerateConfig(
  payload: Record<string, unknown>,
  driver: VpnDriver,
): Promise<Record<string, unknown>> {
  const username         = assertUsername(payload['username'])
  const serverIp         = payload['serverIp'] as string
  const serverPort       = (payload['serverPort'] as number) ?? undefined
  const protocol         = payload['protocol'] as string | undefined
  const cipher           = payload['cipher'] as string | undefined
  const authDigest       = payload['authDigest'] as string | undefined
  const clientPrivateKey = payload['clientPrivateKey'] as string | undefined
  const clientVpnIp      = payload['clientVpnIp'] as string | undefined
  const dns              = payload['dns'] as string | undefined

  if (!serverIp) throw new Error('Missing serverIp in payload')

  const config = await driver.generateClientConfig(username, {
    serverIp, serverPort, protocol, cipher, authDigest,
    clientPrivateKey, clientVpnIp, dns,
  })

  return { config, filename: `${username}.conf` }
}

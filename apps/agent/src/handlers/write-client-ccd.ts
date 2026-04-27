import type { VpnDriver } from '../drivers'

export async function handleWriteClientCcd(
  params: Record<string, unknown>,
  driver: VpnDriver,
): Promise<Record<string, unknown>> {
  const username   = params['username'] as string
  const vpnIp      = params['vpn_ip'] as string
  const netmask    = params['netmask'] as string | undefined
  const extraLines = params['extra_lines'] as string[] | undefined
  const publicKey  = params['public_key'] as string | undefined

  if (!username || !vpnIp) throw new Error('username and vpn_ip are required')

  return driver.writeClientConfig(username, vpnIp, { publicKey, netmask, extraLines })
}

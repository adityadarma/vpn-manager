import type { VpnDriver } from '../drivers'

export async function handleKickSession(
  payload: Record<string, unknown>,
  driver: VpnDriver,
): Promise<Record<string, unknown>> {
  const commonName = payload['common_name'] as string
  if (!commonName || typeof commonName !== 'string') {
    throw new Error('kick_vpn_session: common_name is required in payload')
  }

  // Validate permanent is actually a boolean (not a truthy string like "true")
  let permanent: boolean | undefined
  if (payload['permanent'] !== undefined) {
    permanent = payload['permanent'] === true || payload['permanent'] === 'true'
  }

  return driver.kickSession(commonName, {
    permanent,
    publicKey:  typeof payload['public_key'] === 'string' ? payload['public_key'] : undefined,
    vpnIp:     typeof payload['vpn_ip'] === 'string' ? payload['vpn_ip'] : undefined,
  })
}

import type { VpnDriver } from '../drivers'

export async function handleKickSession(
  payload: Record<string, unknown>,
  driver: VpnDriver,
): Promise<Record<string, unknown>> {
  const commonName = payload['common_name'] as string
  if (!commonName || typeof commonName !== 'string') {
    throw new Error('kick_vpn_session: common_name is required in payload')
  }

  return driver.kickSession(commonName, {
    permanent:  payload['permanent'] as boolean | undefined,
    publicKey:  payload['public_key'] as string | undefined,
    vpnIp:      payload['vpn_ip'] as string | undefined,
  })
}

import type { VpnDriver } from '../drivers'

export async function handleUnkickSession(
  payload: Record<string, unknown>,
  driver: VpnDriver,
): Promise<Record<string, unknown>> {
  const commonName = payload['common_name'] as string
  if (!commonName || typeof commonName !== 'string') {
    throw new Error('unkick_vpn_session: common_name is required in payload')
  }

  return driver.unkickSession(commonName, {
    publicKey: payload['public_key'] as string | undefined,
    vpnIp:     payload['vpn_ip'] as string | undefined,
  })
}

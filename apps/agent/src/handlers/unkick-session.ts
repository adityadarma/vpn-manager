import type { VpnDriver } from '../drivers'
import { assertUsername } from '../core/net-validate'

export async function handleUnkickSession(
  payload: Record<string, unknown>,
  driver: VpnDriver,
): Promise<Record<string, unknown>> {
  // See kick-session.ts: common_name is the certificate CN / VPN username.
  const commonName = assertUsername(payload['common_name'], 'common_name')

  return driver.unkickSession(commonName, {
    publicKey: payload['public_key'] as string | undefined,
    vpnIp:     payload['vpn_ip'] as string | undefined,
  })
}

import type { VpnDriver } from '../drivers'
import { assertUsername } from '../core/net-validate'

export async function handleKickSession(
  payload: Record<string, unknown>,
  driver: VpnDriver,
): Promise<Record<string, unknown>> {
  // For OpenVPN the common name is the certificate CN, which is the VPN
  // username — same character set, so the same guard applies. It reaches both
  // the management socket and a CCD filename.
  const commonName = assertUsername(payload['common_name'], 'common_name')

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

import type { VpnDriver } from '../drivers'
import { assertUsername, assertIpv4, filterSafeCcdLines } from '../core/net-validate'

export async function handleWriteClientCcd(
  params: Record<string, unknown>,
  driver: VpnDriver,
): Promise<Record<string, unknown>> {
  const username   = assertUsername(params['username'])
  const vpnIp      = params['vpn_ip'] as string
  const netmask    = params['netmask'] as string | undefined
  const publicKey  = params['public_key'] as string | undefined

  if (!vpnIp) throw new Error('vpn_ip is required')
  // vpnIp lands in the CCD `ifconfig-push` directive; netmask too when set.
  assertIpv4(vpnIp, 'vpn_ip')
  if (netmask !== undefined) assertIpv4(netmask, 'netmask')

  // extra_lines are written verbatim into the client's CCD file, so anything
  // outside the known-safe directive set is dropped (and logged) here rather
  // than trusted from the manager.
  const extraLines = filterSafeCcdLines(params['extra_lines'])

  return driver.writeClientConfig(username, vpnIp, { publicKey, netmask, extraLines })
}

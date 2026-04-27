import type { VpnDriver } from '../drivers'
import type { ServerConfigParams } from '../drivers/vpn-driver.interface'

export async function handleUpdateServerConfig(
  params: Record<string, unknown>,
  driver: VpnDriver,
): Promise<Record<string, unknown>> {
  if (!params['vpn_network'] || !params['vpn_netmask']) {
    throw new Error('Missing required parameters: vpn_network, vpn_netmask')
  }
  return driver.updateServerConfig(params as unknown as ServerConfigParams)
}

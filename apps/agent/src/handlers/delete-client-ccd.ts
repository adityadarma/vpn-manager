import type { VpnDriver } from '../drivers'
import { assertUsername } from '../core/net-validate'

export async function handleDeleteClientCcd(
  params: Record<string, unknown>,
  driver: VpnDriver,
): Promise<Record<string, unknown>> {
  const username  = assertUsername(params['username'])
  const publicKey = params['public_key'] as string | undefined

  return driver.deleteClientConfig(username, { publicKey })
}

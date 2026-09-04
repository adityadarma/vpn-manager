import type { VpnDriver } from '../drivers'
import { assertUsername } from '../core/net-validate'

export async function handleRevokeUser(
  payload: Record<string, unknown>,
  driver: VpnDriver,
): Promise<Record<string, unknown>> {
  const username = assertUsername(payload['username'])
  const clientCert = payload['client_cert'] as string | undefined
  return driver.revokeUser(username, clientCert)
}

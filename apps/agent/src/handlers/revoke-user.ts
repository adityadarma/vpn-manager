import type { VpnDriver } from '../drivers'

export async function handleRevokeUser(
  payload: Record<string, unknown>,
  driver: VpnDriver,
): Promise<Record<string, unknown>> {
  const username = payload['username'] as string
  if (!username) throw new Error('Missing username in payload')
  const clientCert = payload['client_cert'] as string | undefined
  return driver.revokeUser(username, clientCert)
}

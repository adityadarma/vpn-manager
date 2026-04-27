import type { VpnDriver } from '../drivers'

export async function handleDeleteClientCcd(
  params: Record<string, unknown>,
  driver: VpnDriver,
): Promise<Record<string, unknown>> {
  const username  = params['username'] as string
  const publicKey = params['public_key'] as string | undefined

  if (!username) throw new Error('username is required')

  return driver.deleteClientConfig(username, { publicKey })
}

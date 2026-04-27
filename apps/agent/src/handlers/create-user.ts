import type { VpnDriver } from '../drivers'

export async function handleCreateUser(
  payload: Record<string, unknown>,
  driver: VpnDriver,
): Promise<Record<string, unknown>> {
  const username = payload['username'] as string
  if (!username) throw new Error('Missing username in payload')
  return driver.createUser(username)
}

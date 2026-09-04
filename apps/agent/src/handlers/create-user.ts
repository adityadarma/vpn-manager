import type { VpnDriver } from '../drivers'
import { assertUsername } from '../core/net-validate'

export async function handleCreateUser(
  payload: Record<string, unknown>,
  driver: VpnDriver,
): Promise<Record<string, unknown>> {
  const username = assertUsername(payload['username'])
  return driver.createUser(username)
}

import type { VpnDriver } from '../drivers'

export async function handleSyncServerConfig(
  _payload: Record<string, unknown>,
  driver: VpnDriver,
): Promise<Record<string, unknown>> {
  return driver.syncServerConfig()
}

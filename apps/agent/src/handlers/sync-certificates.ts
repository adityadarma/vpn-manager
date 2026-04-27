import type { VpnDriver } from '../drivers'

export async function handleSyncCertificates(
  _payload: Record<string, unknown>,
  driver: VpnDriver,
): Promise<Record<string, unknown>> {
  return driver.syncCertificates()
}

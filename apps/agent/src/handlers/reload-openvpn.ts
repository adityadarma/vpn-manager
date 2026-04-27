import type { VpnDriver } from '../drivers'

export async function handleReloadOpenvpn(
  _payload: Record<string, unknown>,
  driver: VpnDriver,
): Promise<Record<string, unknown>> {
  await driver.reload()
  return { success: true, message: 'VPN daemon reloaded successfully' }
}

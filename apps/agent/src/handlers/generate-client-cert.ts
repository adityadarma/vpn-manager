import type { VpnDriver } from '../drivers'
import { assertUsername } from '../core/net-validate'

export async function handleGenerateClientCert(
  payload: Record<string, unknown>,
  driver: VpnDriver,
): Promise<Record<string, unknown>> {
  const username = assertUsername(payload['username'])

  const password  = payload['password'] as string | undefined
  const validDays = payload['validDays'] as number | null | undefined

  return driver.generateClientCert(username, { password, validDays }) as unknown as Record<string, unknown>
}

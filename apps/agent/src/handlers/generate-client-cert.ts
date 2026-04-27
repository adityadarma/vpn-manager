import type { VpnDriver } from '../drivers'

export async function handleGenerateClientCert(
  payload: Record<string, unknown>,
  driver: VpnDriver,
): Promise<Record<string, unknown>> {
  const username = payload['username'] as string | undefined
  if (!username || typeof username !== 'string') throw new Error('Username is required')

  const password  = payload['password'] as string | undefined
  const validDays = payload['validDays'] as number | null | undefined

  return driver.generateClientCert(username, { password, validDays }) as unknown as Record<string, unknown>
}

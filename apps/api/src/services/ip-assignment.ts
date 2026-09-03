import type { Knex } from 'knex'
import { nextAvailableIp } from './ip-pool'

/**
 * Atomically assign a VPN IP to an existing user within a transaction.
 * Uses a transaction with retry logic to prevent race conditions where two
 * concurrent requests could assign the same IP.
 *
 * @param db        Knex instance
 * @param userId    User ID to assign IP to (must already exist in users table)
 * @param subnet    CIDR subnet to allocate from (e.g. "10.8.1.0/24")
 * @param excludeUserId  Optional user ID to exclude from used IPs check (for updates)
 * @param maxRetries Number of retry attempts on conflict
 * @returns         The assigned IP, or null if subnet is full
 */
export async function assignVpnIpAtomic(
  db: Knex,
  userId: string,
  subnet: string,
  excludeUserId?: string,
  maxRetries = 3
): Promise<string | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const assignedIp = await db.transaction(async (trx) => {
        // Get all currently used IPs within the transaction for consistency
        const query = trx('users').whereNotNull('vpn_ip')
        if (excludeUserId) {
          query.whereNot({ id: excludeUserId })
        }
        const usedIps = await query.pluck('vpn_ip') as string[]

        const newIp = nextAvailableIp(subnet, usedIps)
        if (!newIp) return null

        // Update the user's VPN IP — unique constraint will catch duplicates
        await trx('users').where({ id: userId }).update({ vpn_ip: newIp })

        return newIp
      })

      return assignedIp
    } catch (err: any) {
      const msg = (err.message || '').toLowerCase()
      const isUniqueViolation =
        msg.includes('unique') ||
        msg.includes('duplicate') ||
        msg.includes('constraint') ||
        err.code === '23505' ||       // PostgreSQL unique violation
        err.code === 'ER_DUP_ENTRY' || // MySQL
        err.errno === 19              // SQLite UNIQUE constraint failed

      if (isUniqueViolation && attempt < maxRetries - 1) {
        // Retry — another request grabbed the same IP concurrently
        continue
      }
      throw err
    }
  }

  return null
}

/**
 * Compute the next available VPN IP from a subnet atomically within a transaction.
 * This variant does NOT update the user — it only returns the IP to be used
 * during user creation (where the user row doesn't exist yet).
 * The caller must include the IP in the INSERT and handle unique constraint errors.
 *
 * @param db        Knex instance (or transaction)
 * @param subnet    CIDR subnet to allocate from
 * @param excludeUserId  Optional user ID to exclude from used IPs check
 * @returns         The next available IP, or null if subnet is full
 */
export async function computeNextVpnIp(
  db: Knex,
  subnet: string,
  excludeUserId?: string
): Promise<string | null> {
  const query = db('users').whereNotNull('vpn_ip')
  if (excludeUserId) {
    query.whereNot({ id: excludeUserId })
  }
  const usedIps = await query.pluck('vpn_ip') as string[]
  return nextAvailableIp(subnet, usedIps)
}

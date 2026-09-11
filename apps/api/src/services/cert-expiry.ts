import type { Knex } from 'knex'
import { v7 as uuidv7 } from 'uuid'

export interface RevocationResult {
  userId: string
  username: string
  nodeId: string
  success: boolean
  error?: string
}

/**
 * Automatically revokes certificates whose expiration date has passed (expires_at <= now).
 * Lifetime certificates (expires_at = null) are never expired and never touched.
 */
export async function revokeExpiredCertificates(db: Knex): Promise<RevocationResult[]> {
  const results: RevocationResult[] = []

  try {
    const now = new Date()

    const expiredCerts = await db('user_node_certificates as c')
      .join('users as u', 'c.user_id', 'u.id')
      .join('vpn_nodes as n', 'c.node_id', 'n.id')
      .where('c.is_revoked', false)
      .whereNotNull('c.expires_at')
      .where('c.expires_at', '<=', now.toISOString())
      .where('n.status', 'online')
      .select(
        'c.id as cert_id',
        'c.user_id',
        'c.node_id',
        'c.client_cert',
        'c.common_name',
        'c.expires_at',
        'u.username',
        'n.hostname as node_hostname',
        'n.vpn_type'
      )

    if (expiredCerts.length === 0) {
      return results
    }

    console.log(`[cert-expiry] Found ${expiredCerts.length} expired certificate(s) to revoke`)

    for (const cert of expiredCerts) {
      try {
        // 1. Immediately disconnect any active sessions
        await db('vpn_sessions')
          .where({ user_id: cert.user_id, node_id: cert.node_id })
          .whereNull('disconnected_at')
          .update({
            disconnected_at: new Date(),
            disconnect_reason: 'cert_expired',
          })

        // 2. If OpenVPN, record in CRL (cert_revocations table)
        if (cert.vpn_type !== 'wireguard' && cert.client_cert) {
          try {
            await db('cert_revocations').insert({
              id: uuidv7(),
              user_id: cert.user_id,
              node_id: cert.node_id,
              revoked_cert: cert.client_cert,
              revoked_by: null,
              revoked_at: new Date(),
              reason: 'Certificate expired',
            })
          } catch {
            // Ignore duplicate revocation entries
          }
        }

        // 3. Dispatch revoke task to the online node
        if (cert.client_cert) {
          const taskId = uuidv7()
          await db('tasks').insert({
            id: taskId,
            node_id: cert.node_id,
            action: 'revoke_vpn_user',
            payload: JSON.stringify({
              username: cert.common_name || cert.username,
              client_cert: cert.client_cert,
            }),
            status: 'pending',
            created_at: new Date(),
          })

          // Wait up to 30 seconds for the node agent to process revocation
          const deadline = Date.now() + 30_000
          while (Date.now() < deadline) {
            const task = await db('tasks').where({ id: taskId }).first()
            if (task?.status === 'done') break
            if (task?.status === 'failed') {
              console.error(
                `[cert-expiry] Node failed to revoke expired credential for ${cert.username}: ${task.error_message || 'unknown error'}`
              )
              break
            }
            await new Promise((resolve) => setTimeout(resolve, 500))
          }
        }

        // 4. Mark certificate as revoked in database
        await db('user_node_certificates').where({ id: cert.cert_id }).update({
          is_revoked: true,
          revoked_at: new Date(),
          revoke_reason: 'Certificate expired',
          updated_at: new Date(),
        })

        results.push({
          userId: cert.user_id,
          username: cert.username,
          nodeId: cert.node_id,
          success: true,
        })

        console.log(
          `[cert-expiry] Successfully revoked expired ${cert.vpn_type} certificate for ${cert.username} on ${cert.node_hostname}`
        )
      } catch (error: any) {
        results.push({
          userId: cert.user_id,
          username: cert.username,
          nodeId: cert.node_id,
          success: false,
          error: error.message,
        })
        console.error(`[cert-expiry] Failed to revoke expired certificate for ${cert.username}:`, error)
      }
    }
  } catch (error) {
    console.error('[cert-expiry] Error checking expired certificates:', error)
  }

  return results
}

/**
 * Starts the periodic scheduler to revoke expired certificates.
 * Runs silently every 5 minutes and only logs when an expired certificate is found & revoked.
 */
export function startCertExpiryWatcher(db: Knex): { stop: () => void } {
  console.log('[cert-expiry] Starting expired certificate watcher (checks every 5 minutes)')

  // Initial check on server start
  revokeExpiredCertificates(db).catch(console.error)

  // Periodic check every 5 minutes
  const interval = setInterval(() => {
    revokeExpiredCertificates(db).catch(console.error)
  }, 5 * 60 * 1000)

  return {
    stop: () => clearInterval(interval),
  }
}

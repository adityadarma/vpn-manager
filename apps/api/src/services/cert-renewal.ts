import type { Knex } from 'knex'
import { v7 as uuidv7 } from 'uuid'

interface RenewalResult {
  userId: string
  username: string
  nodeId: string
  success: boolean
  error?: string
}

export async function checkAndRenewCertificates(db: Knex): Promise<RenewalResult[]> {
  const results: RenewalResult[] = []

  try {
    await revokeExpiredWireGuardPeers(db)

    // Find certificates expiring soon (within 30 days)
    const now = new Date()
    const thirtyDaysFromNow = new Date()
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30)
    
    const expiringCerts = await db('user_node_certificates')
      .join('users', 'user_node_certificates.user_id', 'users.id')
      .join('vpn_nodes', 'user_node_certificates.node_id', 'vpn_nodes.id')
      .where('user_node_certificates.is_revoked', false)
      .whereNotNull('user_node_certificates.expires_at')
      .where('user_node_certificates.expires_at', '>', now.toISOString())
      .where('user_node_certificates.expires_at', '<=', thirtyDaysFromNow.toISOString())
      .where('vpn_nodes.status', 'online')
      .whereNot('vpn_nodes.vpn_type', 'wireguard')
      .select(
        'user_node_certificates.id as cert_id',
        'user_node_certificates.user_id',
        'user_node_certificates.node_id',
        'user_node_certificates.expires_at',
        'user_node_certificates.password_protected',
        'users.username',
        'vpn_nodes.hostname as node_hostname'
      )

    console.log(`[cert-renewal] Found ${expiringCerts.length} certificates expiring within 30 days`)

    for (const cert of expiringCerts) {
      try {
        // Add old certificate to revocation list
        const oldCertData = await db('user_node_certificates')
          .where('id', cert.cert_id)
          .select('client_cert')
          .first()

        if (oldCertData?.client_cert) {
          try {
            await db('cert_revocations').insert({
              id: uuidv7(),
              user_id: cert.user_id,
              node_id: cert.node_id,
              revoked_cert: oldCertData.client_cert,
              reason: 'Auto-renewal (expiring soon)',
              revoked_by: null, // System renewal
              revoked_at: new Date()
            })
          } catch (err: any) {
            const errMsg = err.message || 'Unknown error';
            console.error(`[cert-renewal] Failed to add revocation for ${cert.username}:`, errMsg.includes('Certificate:') ? errMsg.split('Certificate:')[0] + '[CERTIFICATE REDACTED]' : errMsg)
          }
        }

        // Create renewal task
        const taskId = uuidv7()
        await db('tasks').insert({
          id: taskId,
          node_id: cert.node_id,
          action: 'generate_client_cert',
          payload: JSON.stringify({
            username: cert.username,
            password: undefined, // Don't change password on renewal
            validDays: 3650 // Default 10 years
          }),
          status: 'pending',
          created_at: new Date(),
        })

        // Wait for task completion (with timeout)
        const maxWait = 30000
        const startTime = Date.now()
        let renewed = false

        while (Date.now() - startTime < maxWait) {
          const task = await db('tasks').where({ id: taskId }).first()
          
          if (task.status === 'done') {
            const result = JSON.parse(task.result || '{}')
            
            // Update certificate in user_node_certificates table
            await db('user_node_certificates')
              .where('id', cert.cert_id)
              .update({
                client_cert: result.clientCert,
                client_key: result.clientKey,
                password_protected: result.passwordProtected,
                generated_at: new Date(),
                expires_at: result.expiresAt ? new Date(result.expiresAt) : null,
                is_revoked: false,
                updated_at: new Date()
              })

            renewed = true
            results.push({
              userId: cert.user_id,
              username: cert.username,
              nodeId: cert.node_id,
              success: true
            })
            
            console.log(`[cert-renewal] Successfully renewed certificate for ${cert.username} on ${cert.node_hostname}`)
            break
          }
          
          if (task.status === 'failed') {
            results.push({
              userId: cert.user_id,
              username: cert.username,
              nodeId: cert.node_id,
              success: false,
              error: task.error_message || 'Task failed'
            })
            break
          }
          
          await new Promise(resolve => setTimeout(resolve, 1000))
        }

        if (!renewed && !results.find(r => r.userId === cert.user_id && r.nodeId === cert.node_id)) {
          results.push({
            userId: cert.user_id,
            username: cert.username,
            nodeId: cert.node_id,
            success: false,
            error: 'Renewal timeout'
          })
        }
      } catch (error: any) {
        results.push({
          userId: cert.user_id,
          username: cert.username,
          nodeId: cert.node_id,
          success: false,
          error: error.message
        })
        console.error(`[cert-renewal] Failed to renew certificate for ${cert.username}:`, error)
      }
    }
  } catch (error) {
    console.error('[cert-renewal] Error checking certificates:', error)
  }

  return results
}

async function revokeExpiredWireGuardPeers(db: Knex): Promise<void> {
  const expired = await db('user_node_certificates as c')
    .join('users as u', 'c.user_id', 'u.id')
    .join('vpn_nodes as n', 'c.node_id', 'n.id')
    .where({ 'c.is_revoked': false, 'n.vpn_type': 'wireguard', 'n.status': 'online' })
    .whereNotNull('c.expires_at')
    .where('c.expires_at', '<=', new Date())
    .select('c.id', 'c.user_id', 'c.node_id', 'c.client_cert', 'u.username')

  for (const cert of expired) {
    if (!cert.client_cert) continue
    const taskId = uuidv7()
    await db('tasks').insert({
      id: taskId,
      node_id: cert.node_id,
      action: 'revoke_vpn_user',
      payload: JSON.stringify({ username: cert.username, client_cert: cert.client_cert }),
      status: 'pending',
      created_at: new Date(),
    })

    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      const task = await db('tasks').where({ id: taskId }).first()
      if (task?.status === 'done') {
        await db('user_node_certificates').where({ id: cert.id }).update({
          is_revoked: true,
          revoked_at: new Date(),
          revoke_reason: 'Expired WireGuard key',
          updated_at: new Date(),
        })
        break
      }
      if (task?.status === 'failed') {
        console.error(`[cert-expiry] Failed to revoke expired WireGuard peer for ${cert.username}: ${task.error_message || 'unknown error'}`)
        break
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }
}

// Check expiry every minute so expired WireGuard peers are removed promptly.
export function startCertRenewalScheduler(db: Knex) {
  console.log('[cert-renewal] Starting certificate renewal scheduler')
  
  // Run immediately on start
  checkAndRenewCertificates(db).catch(console.error)
  
  // Then run every minute.
  setInterval(() => {
    checkAndRenewCertificates(db).catch(console.error)
  }, 60 * 1000)
}

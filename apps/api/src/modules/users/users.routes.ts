import type { FastifyPluginAsync } from 'fastify'
import { v7 as uuidv7 } from 'uuid'
import bcrypt from 'bcryptjs'
import { CreateUserSchema, UpdateUserSchema } from '@vpn/shared'
import { nextAvailableIp, getNetmask, cidrToRoute, cidrsToPushRoutes, nodePoolCidr } from '../../services/ip-pool'
import { logAudit, getClientIp } from '../../utils/audit'
import { stripTaskPayloadSecrets } from '../../utils/task-payload'
import { enqueueApplyPolicies } from '../policies/policies.routes'

function getCertificateExpiry(
  vpnType: string,
  validDays: number | null | undefined,
  issuedAt: Date,
  driverExpiresAt: string | null | undefined,
  requestedExpiresAt?: Date | null,
): Date | null {
  if (requestedExpiresAt) return requestedExpiresAt
  if (vpnType !== 'wireguard') return driverExpiresAt ? new Date(driverExpiresAt) : null
  if (validDays === null || validDays === undefined || validDays === 0) return null

  const expiresAt = new Date(issuedAt)
  expiresAt.setDate(expiresAt.getDate() + validDays)
  return expiresAt
}

const userRoutes: FastifyPluginAsync = async (app) => {
  const groupConcatExpr = app.db.raw('GROUP_CONCAT(g.name) as current_groups')

  async function revokeCertificateOnNode(nodeId: string, username: string, clientCert: string): Promise<string | null> {
    const taskId = uuidv7()
    await app.db('tasks').insert({
      id: taskId,
      node_id: nodeId,
      action: 'revoke_vpn_user',
      payload: JSON.stringify({ username, client_cert: clientCert }),
      status: 'pending',
      created_at: new Date(),
    })

    const deadline = Date.now() + 30_000
    while (Date.now() < deadline) {
      const task = await app.db('tasks').where({ id: taskId }).first()
      if (!task) return 'Revocation task disappeared unexpectedly'
      if (task.status === 'done') return null
      if (task.status === 'failed') return task.error_message || 'Node failed to revoke the existing credential'
      await new Promise(resolve => setTimeout(resolve, 500))
    }

    return 'Timed out waiting for the node to revoke the existing credential'
  }

  // GET /api/v1/users
  app.get(
    '/users',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['users'], summary: 'List all VPN users', security: [{ bearerAuth: [] }] } },
    async (request) => {
      const query = request.query as { page?: string; limit?: string; search?: string }
      const paginated = query.page !== undefined || query.limit !== undefined || query.search !== undefined
      const page = Math.max(1, Number.parseInt(query.page ?? '1', 10) || 1)
      const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit ?? '10', 10) || 10))
      const usersWithGroups = app.db('users as u')
        .leftJoin('user_groups as ug', 'u.id', 'ug.user_id')
        .leftJoin('groups as g', 'ug.group_id', 'g.id')
        .select(
          'u.id', 'u.username', 'u.email', 'u.role', 'u.is_active', 
          'u.last_login', 'u.created_at', 'u.updated_at',
          groupConcatExpr
        )
        .groupBy(
          'u.id',
          'u.username',
          'u.email',
          'u.role',
          'u.is_active',
          'u.last_login',
          'u.created_at',
          'u.updated_at',
        )

      if (query.search?.trim()) {
        const pattern = `%${query.search.trim()}%`
        usersWithGroups.where((builder: any) => {
          builder.where('u.username', 'like', pattern).orWhere('u.email', 'like', pattern)
        })
      }

      if (!paginated) return usersWithGroups

      const rows = await usersWithGroups.clone().orderBy('u.username').limit(limit).offset((page - 1) * limit)
      const countBuilder = app.db('users as u')
      if (query.search?.trim()) {
        const pattern = `%${query.search.trim()}%`
        countBuilder.where((builder: any) => {
          builder.where('u.username', 'like', pattern).orWhere('u.email', 'like', pattern)
        })
      }
      const countRow = await countBuilder.count<{ count: string }>('* as count').first()
      const total = Number(countRow?.count ?? 0)

      return {
        users: rows,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      }
    },
  )

  // GET /api/v1/users/:id
  app.get<{ Params: { id: string } }>(
    '/users/:id',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['users'], summary: 'Get user details', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const user = await app.db('users')
        .where({ id: request.params.id })
        .select('id', 'username', 'email', 'role', 'is_active', 'last_login', 'created_at', 'updated_at')
        .where({ id: request.params.id })
        .first()
      if (!user) return reply.status(404).send({ error: 'Not Found', message: 'User not found' })
      return user
    },
  )

  // POST /api/v1/users
  app.post(
    '/users',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['users'], summary: 'Create a new VPN user', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const input = CreateUserSchema.parse(request.body)
      const vpnGroupId = (request.body as any).vpn_group_id as string | undefined

      const existing = await app.db('users').where({ username: input.username }).first()
      if (existing) {
        return reply.status(409).send({ error: 'Conflict', message: 'Username already exists' })
      }

      const passwordHash = input.password ? await bcrypt.hash(input.password, 10) : null
      const id = uuidv7()

      let resolvedGroupId: string | null = vpnGroupId ?? null

      if (vpnGroupId) {
        const group = await app.db('groups').where({ id: vpnGroupId }).first()
        if (!group) return reply.status(400).send({ error: 'vpn_group_id not found' })
      }

      await app.db('users').insert({
        id,
        username: input.username,
        email: input.email ?? null,
        password: passwordHash,
        role: input.role ?? 'user',
        is_active: true,
      })

      // Also add to user_groups table if group was specified
      if (resolvedGroupId) {
        await app.db('user_groups')
          .insert({ group_id: resolvedGroupId, user_id: id })
          .onConflict(['group_id', 'user_id']).ignore()
      }

      const user = await app.db('users').where({ id }).first()

      const userObj = request.user as { id: string; username: string }
      await logAudit(app, {
        userId: userObj.id,
        username: userObj.username,
        action: 'user_create',
        resourceType: 'user',
        resourceId: id,
        ipAddress: getClientIp(request),
        metadata: { created_username: input.username, role: input.role }
      })

      return reply.status(201).send(user)
    },
  )

  // PATCH /api/v1/users/:id
  app.patch<{ Params: { id: string } }>(
    '/users/:id',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['users'], summary: 'Update a VPN user', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const input = UpdateUserSchema.parse(request.body)
      const vpnGroupId = (request.body as any).vpn_group_id as string | null | undefined
      const { id } = request.params

      const user = await app.db('users').where({ id }).first()
      if (!user) return reply.status(404).send({ error: 'Not Found', message: 'User not found' })

      if (input.username && input.username !== user.username) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Username cannot be changed after creation',
        })
      }

      const updates: Record<string, unknown> = {
        ...(input.email !== undefined && { email: input.email }),
        ...(input.role && { role: input.role }),
        ...(input.isActive !== undefined && { is_active: input.isActive }),
        updated_at: new Date(),
      }

      // If role or active status changed, revoke all existing tokens for this user
      if ((input.role && input.role !== user.role) || (input.isActive !== undefined && input.isActive !== user.is_active)) {
        const { revokeAllUserTokens } = await import('../../services/token-revocation')
        await revokeAllUserTokens(app.db, id)
      }

      if (input.password) {
        updates['password'] = await bcrypt.hash(input.password, 10)
      }

      if (input.isActive === false && user.is_active) {
        const now = new Date()
        const activeCredentials = await app.db('user_node_certificates')
          .where({ user_id: id, is_revoked: false })
          .select('id', 'node_id', 'common_name', 'client_cert')

        // Account disable must cut off every device. Queue node work without
        // waiting: an offline node receives the pending revocation on return.
        await app.db.transaction(async (trx) => {
          for (const credential of activeCredentials) {
            if (credential.client_cert) {
              await trx('tasks').insert({
                id: uuidv7(),
                node_id: credential.node_id,
                action: 'revoke_vpn_user',
                payload: JSON.stringify({ username: credential.common_name || user.username, client_cert: credential.client_cert }),
                status: 'pending',
                created_at: now,
              })
              await trx('cert_revocations').insert({
                id: uuidv7(),
                user_id: id,
                node_id: credential.node_id,
                revoked_cert: credential.client_cert,
                reason: 'User account disabled',
                revoked_by: (request.user as { id: string }).id,
                revoked_at: now,
              })
            }
          }

          await trx('user_node_certificates').where({ user_id: id, is_revoked: false }).update({
            is_revoked: true,
            revoked_at: now,
            revoked_by: (request.user as { id: string }).id,
            revoke_reason: 'User account disabled',
            updated_at: now,
          })
          await trx('vpn_sessions').where({ user_id: id }).whereNull('disconnected_at').update({
            disconnected_at: now,
            disconnect_reason: 'user_disabled',
          })
        })
      }

      // Group membership controls credential policy; IP assignment happens when a
      // credential is issued for a concrete node.
      if (vpnGroupId !== undefined) {
        if (vpnGroupId === null) {
          await app.db('user_groups').where({ user_id: id }).delete()
          await app.db('user_node_certificates').where({ user_id: id }).update({ group_id: null, updated_at: new Date() })
        } else {
          const newGroup = await app.db('groups').where({ id: vpnGroupId }).first()
          if (!newGroup) return reply.status(400).send({ error: 'vpn_group_id not found' })
          await app.db('user_groups').where({ user_id: id }).delete()
          await app.db('user_groups').insert({ group_id: vpnGroupId, user_id: id })
          await app.db('user_node_certificates').where({ user_id: id }).update({ group_id: vpnGroupId, updated_at: new Date() })
        }
      }

      await app.db('users').where({ id }).update(updates)
      if (vpnGroupId !== undefined) await enqueueApplyPolicies(app)
      
      const userObj = request.user as { id: string; username: string }
      await logAudit(app, {
        userId: userObj.id,
        username: userObj.username,
        action: 'user_update',
        resourceType: 'user',
        resourceId: id,
        ipAddress: getClientIp(request),
        metadata: { updated_fields: Object.keys(updates) }
      })

      return app.db('users').where({ id }).first()
    },
  )

  // POST /api/v1/users/:id/generate-cert
  app.post<{ Params: { id: string }; Body: { nodeId: string; credentialName: string; password?: string; passwordProtected?: boolean; validDays?: number | null; expiresAt?: number | null } }>(
    '/users/:id/generate-cert',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['users'],
        summary: 'Generate client certificate for user on specific node',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['nodeId', 'credentialName'],
          properties: {
            nodeId: { type: 'string', format: 'uuid' },
            credentialName: { type: 'string', minLength: 1, maxLength: 100, description: 'Unique device label for this credential on the node' },
            password: { type: 'string', description: 'Password to encrypt private key (optional)' },
            passwordProtected: { type: 'boolean', description: 'Whether to password-protect the key', default: false },
            validDays: { type: ['number', 'null'], description: 'Certificate validity in days (null = unlimited)', default: null },
            expiresAt: { type: ['number', 'null'], description: 'Expiry as Unix epoch milliseconds (null = unlimited)', default: null }
          }
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params
      const { nodeId, credentialName, password, passwordProtected, validDays = null, expiresAt = null } = request.body

      let requestedExpiresAt: Date | null = null
      if (expiresAt !== null) {
        if (!Number.isSafeInteger(expiresAt)) {
          return reply.status(400).send({ error: 'Bad Request', message: 'expiresAt must be a Unix epoch timestamp in milliseconds' })
        }
        requestedExpiresAt = new Date(expiresAt)
        if (requestedExpiresAt.getTime() <= Date.now()) {
          return reply.status(400).send({ error: 'Bad Request', message: 'Expiry must be in the future' })
        }
      }

      const authUser = request.user as { id: string; role: string }
      if (authUser.role !== 'admin') {
        return reply.status(403).send({ error: 'Forbidden', message: 'Only admins can generate certificates' })
      }

      const user = await app.db('users').where({ id }).first()
      if (!user) {
        return reply.status(404).send({ error: 'Not Found', message: 'User not found' })
      }

      const node = await app.db('vpn_nodes').where({ id: nodeId, status: 'online' }).first()
      if (!node) {
        return reply.status(400).send({ error: 'Bad Request', message: 'Node not found or offline' })
      }
      const membership = await app.db('user_groups').where({ user_id: id }).first('group_id')

      const label = credentialName?.trim()
      if (!label || label.length === 0 || label.length > 100 || /[\r\n\u0000]/.test(label)) {
        return reply.status(400).send({ error: 'Bad Request', message: 'credentialName is required and must be a single line up to 100 characters' })
      }
      const existingCredential = await app.db('user_node_certificates')
        .where({ user_id: id, node_id: nodeId, credential_name: label, is_revoked: false })
        .first()
      if (existingCredential) {
        return reply.status(409).send({ error: 'Conflict', message: 'An active credential with this name already exists on the node' })
      }

      const effectiveValidDays = requestedExpiresAt
        ? Math.max(1, Math.ceil((requestedExpiresAt.getTime() - Date.now()) / 86_400_000))
        : validDays

      let pool: string
      try {
        pool = nodePoolCidr(node.vpn_network, node.vpn_netmask)
      } catch (error) {
        return reply.status(400).send({ error: 'Bad Request', message: `Node VPN pool is invalid: ${(error as Error).message}` })
      }
      const reservedIps: string[] = []
      if (membership?.group_id) {
        const allocation = await app.db('group_node_dns_settings')
          .where({ group_id: membership.group_id, node_id: nodeId })
          .first('vpn_subnet', 'listener_ip')
        if (allocation) {
          pool = allocation.vpn_subnet
          if (allocation.listener_ip) reservedIps.push(allocation.listener_ip)
        }
      }
      const usedIps = await app.db('user_node_certificates')
        .where({ node_id: nodeId })
        .whereNotNull('vpn_ip')
        .pluck('vpn_ip') as string[]
      const vpnIp = nextAvailableIp(pool, [...usedIps, ...reservedIps])
      if (!vpnIp) return reply.status(422).send({ error: 'Subnet full', message: `No available IPs in ${pool}` })

      const credentialId = uuidv7()
      const commonName = `${user.username.slice(0, 20)}-${credentialId.replace(/-/g, '').slice(-11)}`

      // Create task for agent to generate certificate
      const taskId = uuidv7()
      await app.db('tasks').insert({
        id: taskId,
        node_id: nodeId,
        action: 'generate_client_cert',
        payload: JSON.stringify({
          username: commonName,
          password: passwordProtected ? password : undefined,
          validDays: effectiveValidDays
        }),
        status: 'pending',
        created_at: new Date(),
      })

      // Wait for task completion (with timeout)
      const maxWait = 30000 // 30 seconds
      const startTime = Date.now()
      let pollInterval = 500
      
      while (Date.now() - startTime < maxWait) {
        const task = await app.db('tasks').where({ id: taskId }).first()

        // Guard against task being deleted externally
        if (!task) {
          return reply.status(500).send({
            error: 'Internal Server Error',
            message: 'Task disappeared unexpectedly'
          })
        }
        
        if (task.status === 'done') {
          const result = JSON.parse(task.result || '{}')
          const issuedAt = new Date()
          const certificateExpiresAt = getCertificateExpiry(node.vpn_type, effectiveValidDays, issuedAt, result.expiresAt, requestedExpiresAt)
          
          await app.db('user_node_certificates').insert({
            id: credentialId,
            user_id: id,
            node_id: nodeId,
            credential_name: label,
            common_name: commonName,
            vpn_ip: vpnIp,
            group_id: membership?.group_id ?? null,
            client_cert: result.clientCert,
            client_key: result.clientKey,
            password_protected: result.passwordProtected,
            generated_at: issuedAt,
            expires_at: certificateExpiresAt,
            is_revoked: false,
            created_at: new Date(),
            updated_at: new Date(),
          })

          await enqueueCredentialCcdTask(app, nodeId, commonName, vpnIp, getNetmask(pool), result.clientCert)

          return reply.send({
            message: 'Certificate generated successfully',
            credentialId,
            commonName,
            vpnIp,
            expiresAt: certificateExpiresAt?.toISOString() ?? null,
            passwordProtected: result.passwordProtected
          })
        }
        
        if (task.status === 'failed') {
          return reply.status(500).send({
            error: 'Internal Server Error',
            message: `Failed to generate certificate: ${task.error_message || 'Unknown error'}`
          })
        }
        
        // Progressive backoff: 500ms → 1000ms → 1500ms (max)
        await new Promise(resolve => setTimeout(resolve, pollInterval))
        pollInterval = Math.min(pollInterval + 250, 1500)
      }

      // Timed out waiting for the agent. The task may still be picked up later,
      // but we stop tracking it here — so drop the passphrase now rather than
      // leaving cleartext behind for a task nobody is waiting on.
      try {
        await stripTaskPayloadSecrets(app.db, taskId)
      } catch (err) {
        app.log.warn(`[users] Failed to strip secrets from timed-out task ${taskId}: ${(err as Error).message}`)
      }

      return reply.status(408).send({
        error: 'Request Timeout',
        message: 'Certificate generation timed out'
      })
    }
  )

  // POST /api/v1/users/bulk-generate-cert
  app.post<{ Body: { userIds: string[]; nodeId: string; password?: string; passwordProtected?: boolean; validDays?: number | null } }>(
    '/users/bulk-generate-cert',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['users'],
        summary: 'Bulk generate certificates for multiple users',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['userIds', 'nodeId'],
          properties: {
            userIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
            nodeId: { type: 'string', format: 'uuid' },
            password: { type: 'string' },
            passwordProtected: { type: 'boolean', default: false },
            validDays: { type: 'number', default: 3650 }
          }
        }
      }
    },
    async (request, reply) => {
      const { userIds, nodeId, password, passwordProtected, validDays = 3650 } = request.body

      const authUser = request.user as { id: string; role: string }
      if (authUser.role !== 'admin') {
        return reply.status(403).send({ error: 'Forbidden', message: 'Only admins can generate certificates' })
      }

      const node = await app.db('vpn_nodes').where({ id: nodeId, status: 'online' }).first()
      if (!node) {
        return reply.status(400).send({ error: 'Bad Request', message: 'Node not found or offline' })
      }

      const results = {
        success: [] as string[],
        failed: [] as { userId: string; error: string }[]
      }

      // Process each user
      for (const userId of userIds) {
        try {
          const user = await app.db('users').where({ id: userId }).first()
          if (!user) {
            results.failed.push({ userId, error: 'User not found' })
            continue
          }
          const membership = await app.db('user_groups').where({ user_id: userId }).first('group_id')

          let pool: string
          try {
            pool = nodePoolCidr(node.vpn_network, node.vpn_netmask)
          } catch (error) {
            results.failed.push({ userId, error: `Node VPN pool is invalid: ${(error as Error).message}` })
            continue
          }
          const bulkReservedIps: string[] = []
          if (membership?.group_id) {
            const allocation = await app.db('group_node_dns_settings')
              .where({ group_id: membership.group_id, node_id: nodeId })
              .first('vpn_subnet', 'listener_ip')
            if (allocation) {
              pool = allocation.vpn_subnet
              if (allocation.listener_ip) bulkReservedIps.push(allocation.listener_ip)
            }
          }
          const usedIps = await app.db('user_node_certificates')
            .where({ node_id: nodeId })
            .whereNotNull('vpn_ip')
            .pluck('vpn_ip') as string[]
          const vpnIp = nextAvailableIp(pool, [...usedIps, ...bulkReservedIps])
          if (!vpnIp) {
            results.failed.push({ userId, error: `No available IPs in ${pool}` })
            continue
          }

          const credentialId = uuidv7()
          const commonName = `${user.username.slice(0, 20)}-${credentialId.replace(/-/g, '').slice(-11)}`
          const credentialName = `bulk-${credentialId.replace(/-/g, '').slice(-11)}`

          // Create task
          const taskId = uuidv7()
          await app.db('tasks').insert({
            id: taskId,
            node_id: nodeId,
            action: 'generate_client_cert',
            payload: JSON.stringify({
              username: commonName,
              password: passwordProtected ? password : undefined,
              validDays: validDays
            }),
            status: 'pending',
            created_at: new Date(),
          })

          // Wait for completion (shorter timeout for bulk)
          const maxWait = 15000
          const startTime = Date.now()
          let success = false
          let pollInterval = 500

          while (Date.now() - startTime < maxWait) {
            const task = await app.db('tasks').where({ id: taskId }).first()

            // Guard against task being deleted externally
            if (!task) {
              results.failed.push({ userId, error: 'Task disappeared unexpectedly' })
              break
            }
            
            if (task.status === 'done') {
              const result = JSON.parse(task.result || '{}')
              const issuedAt = new Date()
              const expiresAt = getCertificateExpiry(node.vpn_type, validDays, issuedAt, result.expiresAt)
              
              await app.db('user_node_certificates').insert({
                id: credentialId,
                user_id: userId,
                node_id: nodeId,
                credential_name: credentialName,
                common_name: commonName,
                vpn_ip: vpnIp,
                group_id: membership?.group_id ?? null,
                client_cert: result.clientCert,
                client_key: result.clientKey,
                password_protected: result.passwordProtected,
                generated_at: issuedAt,
                expires_at: expiresAt,
                is_revoked: false,
                created_at: new Date(),
                updated_at: new Date(),
              })

              await enqueueCredentialCcdTask(app, nodeId, commonName, vpnIp, getNetmask(pool), result.clientCert)

              success = true
              break
            }
            
            if (task.status === 'failed') {
              results.failed.push({ userId, error: task.error_message || 'Unknown error' })
              break
            }
            
            // Progressive backoff: 500ms → 750ms → 1000ms (max)
            await new Promise(resolve => setTimeout(resolve, pollInterval))
            pollInterval = Math.min(pollInterval + 250, 1000)
          }

          if (success) {
            results.success.push(userId)
          } else if (!results.failed.find(f => f.userId === userId)) {
            results.failed.push({ userId, error: 'Timeout' })
          }

          // Whether it succeeded, failed or timed out, we are done waiting on
          // this task — make sure no passphrase is left behind in its payload.
          try {
            await stripTaskPayloadSecrets(app.db, taskId)
          } catch (err) {
            app.log.warn(`[users] Failed to strip secrets from bulk task ${taskId}: ${(err as Error).message}`)
          }
        } catch (error: any) {
          results.failed.push({ userId, error: error.message })
        }
      }

      return reply.send({
        message: `Bulk generation completed: ${results.success.length} succeeded, ${results.failed.length} failed`,
        results
      })
    }
  )

  // GET /api/v1/users/expiring-certs
  app.get<{ Querystring: { days?: number } }>(
    '/users/expiring-certs',
    {
      onRequest: [app.authenticateAdmin],
      schema: {
        tags: ['users'],
        summary: 'Get certificates expiring soon',
        security: [{ bearerAuth: [] }],
        querystring: {
          type: 'object',
          properties: {
            days: { type: 'number', description: 'Days until expiration (default: 30)', default: 30 }
          }
        }
      }
    },
    async (request, reply) => {
      const { days = 30 } = request.query
      const expiryDate = new Date()
      expiryDate.setDate(expiryDate.getDate() + days)

      const certificates = await app.db('user_node_certificates')
        .join('users', 'user_node_certificates.user_id', 'users.id')
        .join('vpn_nodes', 'user_node_certificates.node_id', 'vpn_nodes.id')
        .whereNotNull('user_node_certificates.expires_at')
        .where('user_node_certificates.expires_at', '<=', expiryDate)
        .where('user_node_certificates.expires_at', '>', new Date())
        .where('user_node_certificates.is_revoked', false)
        .select(
          'user_node_certificates.id as cert_id',
          'users.id as user_id',
          'users.username',
          'users.email',
          'vpn_nodes.id as node_id',
          'vpn_nodes.hostname as node_hostname',
          'user_node_certificates.expires_at',
          'user_node_certificates.password_protected'
        )

      return reply.send(certificates)
    }
  )

  // GET /api/v1/users/:id/certificates
  app.get<{ Params: { id: string } }>(
    '/users/:id/certificates',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['users'],
        summary: 'List all certificates for user across all nodes',
        security: [{ bearerAuth: [] }]
      }
    },
    async (request, reply) => {
      const { id } = request.params

      const authUser = request.user as { id: string; role: string }
      if (authUser.role !== 'admin' && authUser.id !== id) {
        return reply.status(403).send({ error: 'Forbidden' })
      }

      const certificates = await app.db('user_node_certificates')
        .join('vpn_nodes', 'user_node_certificates.node_id', 'vpn_nodes.id')
        .where('user_node_certificates.user_id', id)
        .select(
          'user_node_certificates.id',
          'user_node_certificates.node_id',
          'user_node_certificates.credential_name',
          'user_node_certificates.common_name',
          'user_node_certificates.vpn_ip',
          'vpn_nodes.hostname as node_hostname',
           'vpn_nodes.ip_address as node_ip',
           'vpn_nodes.status as node_status',
           'vpn_nodes.vpn_type as node_vpn_type',
          'user_node_certificates.password_protected',
          'user_node_certificates.generated_at',
          'user_node_certificates.expires_at',
           'user_node_certificates.last_downloaded_at',
           'user_node_certificates.download_count',
           'user_node_certificates.last_vpn_connect',
          'user_node_certificates.is_revoked',
          'user_node_certificates.revoked_at',
          'user_node_certificates.revoke_reason'
        )
        .orderBy('user_node_certificates.generated_at', 'desc')

      return reply.send(certificates)
    }
  )

  // POST /api/v1/users/:id/certificates/:certId/revoke
  app.post<{ Params: { id: string; certId: string }; Body: { reason?: string } }>(
    '/users/:id/certificates/:certId/revoke',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['users'],
        summary: 'Revoke a certificate',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          properties: {
            reason: { type: 'string', description: 'Reason for revocation' }
          }
        }
      }
    },
    async (request, reply) => {
      const { id, certId } = request.params
      const { reason = 'Manually revoked' } = request.body

      const authUser = request.user as { id: string; role: string }
      if (authUser.role !== 'admin') {
        return reply.status(403).send({ error: 'Forbidden', message: 'Only admins can revoke certificates' })
      }

      const certificate = await app.db('user_node_certificates')
        .where({ id: certId, user_id: id })
        .first()

      if (!certificate) {
        return reply.status(404).send({ error: 'Not Found', message: 'Certificate not found' })
      }

      await app.db('vpn_sessions')
        .where({ credential_id: certificate.id })
        .whereNull('disconnected_at')
        .update({ disconnected_at: new Date(), disconnect_reason: 'cert_revoked' })

      if (certificate.is_revoked) {
        return reply.status(400).send({ error: 'Bad Request', message: 'Certificate already revoked' })
      }

      if (!certificate.client_cert) {
        return reply.status(409).send({
          error: 'Certificate revocation failed',
          message: 'Certificate has no credential to revoke on the node',
        })
      }

      const user = await app.db('users').where({ id }).first()
      if (!user) return reply.status(404).send({ error: 'Not Found', message: 'User not found' })

      const credentialCommonName = certificate.common_name || user.username
      const revokeError = await revokeCertificateOnNode(certificate.node_id, credentialCommonName, certificate.client_cert)
      if (revokeError) {
        return reply.status(502).send({
          error: 'Certificate revocation failed',
          message: `Credential was not revoked on the node: ${revokeError}`,
        })
      }

      // Record the revocation only after the node has removed the credential.
      if (certificate.client_cert) {
        try {
          await app.db('cert_revocations').insert({
            id: uuidv7(),
            user_id: id,
            node_id: certificate.node_id,
            revoked_cert: certificate.client_cert,
            reason: reason,
            revoked_by: authUser.id,
            revoked_at: new Date()
          })
        } catch (err: any) {
          app.log.error(`Failed to record certificate revocation: ${err.message}`)
        }
      }

      // Mark as revoked
      await app.db('user_node_certificates')
        .where({ id: certId })
        .update({
          is_revoked: true,
          revoked_at: new Date(),
          revoked_by: authUser.id,
          revoke_reason: reason,
          updated_at: new Date()
        })

      return reply.send({
        message: 'Certificate revoked successfully'
      })
    }
  )

  // GET /api/v1/users/:id/vpn
  app.get<{ Params: { id: string }; Querystring: { nodeId?: string; certId?: string } }>(
    '/users/:id/vpn',
    { onRequest: [app.authenticate], schema: { tags: ['users'], summary: 'Download .ovpn config', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const { id } = request.params
      const { nodeId, certId } = request.query

      const user = await app.db('users').where({ id }).first()
      if (!user) return reply.status(404).send({ error: 'Not Found', message: 'User not found' })

      const authUser = request.user as { id: string; role: string }
      if (authUser.role !== 'admin' && authUser.id !== id) {
        return reply.status(403).send({ error: 'Forbidden' })
      }

      // Get certificate - either by certId or by nodeId
      let certificate
      if (certId) {
        certificate = await app.db('user_node_certificates')
          .where({ id: certId, user_id: id })
          .first()
      } else if (nodeId) {
        const certificates = await app.db('user_node_certificates')
          .where({ user_id: id, node_id: nodeId })
          .orderBy('generated_at', 'desc')
        if (certificates.length > 1) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: 'Multiple credentials exist on this node; certId is required',
          })
        }
        certificate = certificates[0]
      } else {
        // Get any certificate (prefer non-revoked)
        certificate = await app.db('user_node_certificates')
          .where({ user_id: id, is_revoked: false })
          .first()
        
        if (!certificate) {
          certificate = await app.db('user_node_certificates')
            .where({ user_id: id })
            .first()
        }
      }

      if (!certificate) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'User does not have any certificates. Generate one first via POST /users/:id/generate-cert'
        })
      }

      if (certificate.is_revoked) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Certificate is revoked. Generate a new one.'
        })
      }

      if (!certificate.client_cert || !certificate.client_key) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Certificate data is incomplete. Generate a new one.'
        })
      }

      // Get node
      const node = await app.db('vpn_nodes').where({ id: certificate.node_id }).first()
      if (!node) {
        return reply.status(400).send({ error: 'Bad Request', message: 'Node not found' })
      }

      if (node.vpn_type !== 'wireguard' && (!node.ca_cert || !node.ta_key)) {
        return reply.status(400).send({ error: 'Bad Request', message: 'Node has not uploaded certificates yet (CA cert and TLS key required)' })
      }

      if (node.vpn_type === 'wireguard' && !node.public_key) {
        return reply.status(400).send({ error: 'Bad Request', message: 'Node WireGuard public key is missing' })
      }

      // Update download tracking
      try {
        await app.db('user_node_certificates')
          .where({ id: certificate.id })
          .update({
            last_downloaded_at: new Date(),
            download_count: app.db.raw('download_count + 1')
          })

        // Audit logs retain the download event without duplicating it in a
        // dedicated history table.
        await logAudit(app, {
          userId: id,
          username: user.username,
          action: 'cert_download',
          resourceType: 'certificate',
          resourceId: certificate.id,
          ipAddress: getClientIp(request),
          metadata: {
            node_id: node.id,
            node_hostname: node.hostname,
            device_name: request.headers['user-agent'] || 'unknown'
          }
        })
      } catch (err) {
        // Log but don't fail the download
        console.error('Failed to track download:', err)
      }

      // Get node configuration settings
      const protocol = node.protocol || 'udp'
      const cipher = node.cipher || 'AES-128-GCM'
      const authDigest = node.auth_digest || 'SHA256'
      let clientDns = node.dns_servers || ''
      if (node.managed_dns_enabled && node.dns_sync_status === 'healthy' && Number(node.dns_config_revision) > 0 && certificate.group_id) {
        const groupDns = await app.db('group_node_dns_settings')
          .where({ group_id: certificate.group_id, node_id: node.id, enabled: true })
          .first('listener_ip')
        if (groupDns?.listener_ip) clientDns = groupDns.listener_ip
      }

      // Fetch all network CIDRs assigned to ALL user's groups → split-tunnel routes
      const userGroupIds = await app.db('user_groups')
        .where({ user_id: id })
        .pluck('group_id') as string[]

      let splitCidrs: string[] = []
      let routeLines = ''
      
      let hasGroupSubnet = false

      if (userGroupIds.length > 0) {
        // 1. Add Group VPN Subnets allocated for this node
        const nodeGroupSubnets = await app.db('group_node_dns_settings')
          .whereIn('group_id', userGroupIds)
          .where({ node_id: node.id })
          .whereNotNull('vpn_subnet')
          .pluck('vpn_subnet') as string[]

        for (const s of nodeGroupSubnets) {
          splitCidrs.push(s)
          hasGroupSubnet = true
        }

        // 2. Add explicit target Networks (Filtered by Node Assignment)
        const allTargetNetworks = await app.db('group_networks as gn')
          .join('networks as n', 'gn.network_id', 'n.id')
          .leftJoin('node_networks as nn', function(this: any) {
            this.on('n.id', 'nn.network_id').andOn('nn.node_id', app.db.raw('?', [node.id]))
          })
          .whereIn('gn.group_id', userGroupIds)
          .select('n.cidr', 'n.name', 'nn.node_id')

        // Keep CIDR if: no node assigned (global) OR this node is assigned
        const filteredNetworks = allTargetNetworks.filter((row: any) => row.node_id === null || row.node_id === node.id)

        if (filteredNetworks.length > 0) {
          // Remove duplicate CIDRs in case multiple groups share the same network
          const uniqueNetworks = Array.from(new Map(filteredNetworks.map((item: any) => [item.cidr, item])).values()) as any[]
          
          splitCidrs.push(...uniqueNetworks.map((n) => n.cidr))
          const routeComments = uniqueNetworks.map((n) =>
            `# ${n.name}: ${n.cidr}\n${cidrToRoute(n.cidr)}`
          ).join('\n')
          routeLines = `\n# Split-tunnel routes (from group network assignments)\n${routeComments}\n`
        }
      }

      // Fallback to node's default VPN network if no group VPN subnet is assigned
      if (!hasGroupSubnet && node.vpn_network) {
        const vpnPrefixTemp = node.vpn_netmask === '255.255.255.0' ? '24' : '16'
        splitCidrs.push(`${node.vpn_network}/${vpnPrefixTemp}`)
      }

      // WIRE GUARD CONFIGURATION
      if (node.vpn_type === 'wireguard') {
        let allowedIps = '0.0.0.0/0, ::/0' // Full mode
        
        if (node.tunnel_mode === 'split') {
          const configuredAllowedIps = (node.wireguard_allowed_ips || '')
            .split(',')
            .map((cidr: string) => cidr.trim())
            .filter(Boolean)
          allowedIps = [...new Set([...splitCidrs, ...configuredAllowedIps])].join(', ')
        }

        // For WireGuard: prioritise explicit endpoint_port, then custom port, then fallback to standard 51820.
        // It's likely node.port is 1194 from default OpenVPN seeds, so ignore 1194 for WG.
        const actualPort = node.endpoint_port || (node.port && node.port !== 1194 ? node.port : 51820)
        const endpoint = `${node.ip_address}:${actualPort}`
        const wgConfig = `[Interface]
PrivateKey = ${certificate.client_key.trim()}
Address = ${certificate.vpn_ip}/32
${clientDns ? `DNS = ${clientDns}` : ''}

[Peer]
PublicKey = ${node.public_key}
Endpoint = ${endpoint}
AllowedIPs = ${allowedIps}
PersistentKeepalive = 25
`
        reply.header('Content-Disposition', `attachment; filename="${user.username}-${node.hostname}.conf"`)
        reply.type('text/plain')
        return reply.send(wgConfig)
      }

      // OPENVPN CONFIGURATION
      // Build config with node-specific settings
      const protoClient = protocol === 'tcp' ? 'tcp-client' : protocol

      // Determine TLS cipher based on server cipher (RSA cert + ECDHE key exchange via dh none)
      let tlsCipher = 'TLS-ECDHE-RSA-WITH-AES-128-GCM-SHA256'
      if (cipher.includes('256')) {
        tlsCipher = 'TLS-ECDHE-RSA-WITH-AES-256-GCM-SHA384'
      }

      const openVpnDns = clientDns
        .split(',')
        .map((dns: string) => dns.trim())
        .filter(Boolean)
        .map((dns: string) => `dhcp-option DNS ${dns}`)
        .join('\n')
      let config = `client
proto ${protoClient}
${protocol === 'udp' ? 'explicit-exit-notify' : ''}
remote ${node.ip_address} ${node.port}
dev tun
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
auth ${authDigest}
auth-nocache
cipher ${cipher}
tls-client
tls-version-min 1.2
tls-cipher ${tlsCipher}
ignore-unknown-option block-outside-dns
setenv opt block-outside-dns
verb 3
${openVpnDns}
${routeLines}
<ca>
${node.ca_cert?.trim() ?? ''}
</ca>

<cert>
${certificate.client_cert.trim()}
</cert>

<key>
${certificate.client_key.trim()}
</key>

<tls-crypt>
${node.ta_key?.trim() ?? ''}
</tls-crypt>
`
      reply.header('Content-Disposition', `attachment; filename="${user.username}-${node.hostname}.ovpn"`)
      reply.type('application/x-openvpn-profile')
      return reply.send(config)
    },
  )

  // DELETE /api/v1/users/:id
  app.delete<{ Params: { id: string } }>(
    '/users/:id',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['users'], summary: 'Delete a VPN user', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const { id } = request.params
      const deleted = await app.db('users').where({ id }).delete()
      if (!deleted) return reply.status(404).send({ error: 'Not Found', message: 'User not found' })
      const userObj = request.user as { id: string; username: string }
      await logAudit(app, {
        userId: userObj.id,
        username: userObj.username,
        action: 'user_delete',
        resourceType: 'user',
        resourceId: request.params.id,
        ipAddress: getClientIp(request),
      })

      return reply.status(204).send()
    },
  )
}

/**
 * Enqueue a write_client_ccd task to all online VPN nodes.
 * Fetches the user's group networks and includes them as push routes in the CCD.
 */
async function enqueueCcdTask(
  app: any,
  username: string,
  vpnIp: string,
  netmask: string,
  userId?: string,
): Promise<void> {
  const onlineNodes = await app.db('vpn_nodes').where({ status: 'online' }).select('id')
  if (onlineNodes.length === 0) {
    app.log.warn(`[ip-pool] No online nodes to enqueue write_client_ccd for ${username}`)
    return
  }

  // Fetch network routes from all user's groups
  let extraLines: string[] = []
  // Collect all group IDs for this user (needed per-node)
  let userGroupIds: string[] = []
  if (userId) {
    userGroupIds = await app.db('user_groups')
      .where({ user_id: userId })
      .pluck('group_id') as string[]
  }

  const tasks = []

  for (const node of onlineNodes) {
    // For wireguard support, fetch the user's generated public key if available
    let publicKey = undefined
    if (userId) {
      const cert = await app.db('user_node_certificates')
        .where({ user_id: userId, node_id: node.id })
        .first()
      if (cert && cert.client_cert) {
        publicKey = cert.client_cert
      }
    }

    // Per-node network filtering:
    // - Networks with node assignment → only push to matching nodes
    // - Networks with NO node assignment → push to ALL nodes (global)
    let nodeExtraLines = extraLines
    if (userGroupIds.length > 0) {
      const allGroupNetworks = await app.db('group_networks as gn')
        .join('networks as n', 'gn.network_id', 'n.id')
        .leftJoin('node_networks as nn', (builder: any) => {
          builder.on('n.id', 'nn.network_id').andOn('nn.node_id', app.db.raw('?', [node.id]))
        })
        .whereIn('gn.group_id', userGroupIds)
        .select('n.cidr', 'nn.node_id')

      const filteredCidrs: string[] = [...new Set(
        (allGroupNetworks as Array<{ cidr: string; node_id: string | null }>)
          .filter((row) => row.node_id === null || row.node_id === node.id)
          .map((row) => row.cidr)
      )]

      nodeExtraLines = cidrsToPushRoutes(filteredCidrs)
      if (nodeExtraLines.length > 0) {
        app.log.info(`[ip-pool] Node ${node.hostname}: pushing ${nodeExtraLines.length} network route(s) for ${username}`)
      }
    }

    tasks.push({
      id: uuidv7(),
      node_id: node.id,
      action: 'write_client_ccd',
      payload: JSON.stringify({ username, vpn_ip: vpnIp, netmask, extra_lines: nodeExtraLines, public_key: publicKey }),
      status: 'pending',
      created_at: new Date(),
    })
  }

  await app.db('tasks').insert(tasks)
  app.log.info(`[ip-pool] Queued write_client_ccd for ${username} → ${vpnIp} on ${tasks.length} node(s)`)
}

/** Configure one credential only on the node that issued it. */
async function enqueueCredentialCcdTask(
  app: any,
  nodeId: string,
  commonName: string,
  vpnIp: string,
  netmask: string,
  publicKey: string,
): Promise<void> {
  await app.db('tasks').insert({
    id: uuidv7(),
    node_id: nodeId,
    action: 'write_client_ccd',
    payload: JSON.stringify({ username: commonName, vpn_ip: vpnIp, netmask, public_key: publicKey }),
    status: 'pending',
    created_at: new Date(),
  })
}

export default userRoutes

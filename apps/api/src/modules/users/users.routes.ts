import type { FastifyPluginAsync } from 'fastify'
import { v7 as uuidv7 } from 'uuid'
import bcrypt from 'bcryptjs'
import { CreateUserSchema, UpdateUserSchema } from '@vpn/shared'
import { nextAvailableIp, getNetmask, cidrToRoute, cidrsToPushRoutes } from '../../services/ip-pool.service'
import { logAudit, getClientIp } from '../../utils/audit'

const userRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/v1/users
  app.get(
    '/users',
    { onRequest: [app.authenticate], schema: { tags: ['users'], summary: 'List all VPN users', security: [{ bearerAuth: [] }] } },
    async () => {
      const usersWithGroups = await app.db('users as u')
        .leftJoin('user_groups as ug', 'u.id', 'ug.user_id')
        .leftJoin('groups as g', 'ug.group_id', 'g.id')
        .select(
          'u.id', 'u.username', 'u.email', 'u.role', 'u.is_active', 
          'u.last_login', 'u.last_vpn_connect', 'u.created_at', 'u.updated_at',
          app.db.raw('GROUP_CONCAT(g.name) as current_groups')
        )
        .groupBy('u.id')

      return usersWithGroups
    },
  )

  // GET /api/v1/users/:id
  app.get<{ Params: { id: string } }>(
    '/users/:id',
    { onRequest: [app.authenticateAdmin], schema: { tags: ['users'], summary: 'Get user details', security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      const user = await app.db('users')
        .where({ id: request.params.id })
        .select('id', 'username', 'email', 'role', 'is_active', 'last_login', 'last_vpn_connect', 'created_at', 'updated_at')
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

      // --- Auto-assign VPN IP from group subnet ---
      let vpnIp: string | null = null
      let resolvedGroupId: string | null = vpnGroupId ?? null

      if (vpnGroupId) {
        const group = await app.db('groups').where({ id: vpnGroupId }).first()
        if (!group) return reply.status(400).send({ error: 'vpn_group_id not found' })

        if (group.vpn_subnet) {
          const usedIps = await app.db('users').whereNotNull('vpn_ip').pluck('vpn_ip') as string[]
          vpnIp = nextAvailableIp(group.vpn_subnet, usedIps)
          if (!vpnIp) {
            return reply.status(422).send({
              error: 'Subnet full',
              message: `Group "${group.name}" subnet ${group.vpn_subnet} has no available IPs`,
            })
          }
        }
      }

      await app.db('users').insert({
        id,
        username: input.username,
        email: input.email ?? null,
        password: passwordHash,
        role: input.role ?? 'user',
        is_active: true,
        vpn_ip: vpnIp,
        vpn_group_id: resolvedGroupId,
      })

      // Also add to user_groups table if group was specified
      if (resolvedGroupId) {
        await app.db('user_groups')
          .insert({ group_id: resolvedGroupId, user_id: id })
          .onConflict(['group_id', 'user_id']).ignore()
      }

      // Enqueue write_client_ccd task to all online nodes (if IP was assigned)
      if (vpnIp) {
        let netmask = '255.255.255.0'
        if (resolvedGroupId) {
          const group = await app.db('groups').where({ id: resolvedGroupId }).first()
          if (group?.vpn_subnet) netmask = getNetmask(group.vpn_subnet)
        }
        await enqueueCcdTask(app, input.username, vpnIp, netmask, id)
      }

      const user = await app.db('users as u')
        .leftJoin('groups as g', 'u.vpn_group_id', 'g.id')
        .select('u.id', 'u.username', 'u.email', 'u.role', 'u.is_active', 'u.vpn_ip', 'u.vpn_group_id', 'g.name as vpn_group_name', 'u.created_at')
        .where('u.id', id)
        .first()

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

      if (input.password) {
        updates['password'] = await bcrypt.hash(input.password, 10)
      }

      // Handle group change → reassign VPN IP
      if (vpnGroupId !== undefined) {
        if (vpnGroupId === null) {
          // Remove from group
          updates['vpn_group_id'] = null
          updates['vpn_ip'] = null
        } else if (vpnGroupId !== user.vpn_group_id) {
          // Moving to a different group
          const newGroup = await app.db('groups').where({ id: vpnGroupId }).first()
          if (!newGroup) return reply.status(400).send({ error: 'vpn_group_id not found' })

          if (newGroup.vpn_subnet) {
            const usedIps = await app.db('users')
              .whereNotNull('vpn_ip')
              .whereNot({ id }) // exclude current user so they can keep a slot
              .pluck('vpn_ip') as string[]

            const newIp = nextAvailableIp(newGroup.vpn_subnet, usedIps)
            if (!newIp) {
              return reply.status(422).send({
                error: 'Subnet full',
                message: `Group "${newGroup.name}" subnet ${newGroup.vpn_subnet} has no available IPs`,
              })
            }
            updates['vpn_ip'] = newIp
            updates['vpn_group_id'] = vpnGroupId

            // Update user_groups membership
            await app.db('user_groups').where({ user_id: id }).delete()
            await app.db('user_groups')
              .insert({ group_id: vpnGroupId, user_id: id })
              .onConflict(['group_id', 'user_id']).ignore()

            // Enqueue CCD update
            const netmask = getNetmask(newGroup.vpn_subnet)
            await enqueueCcdTask(app, user.username, newIp, netmask, id)
          } else {
            updates['vpn_group_id'] = vpnGroupId
          }
        }
      }

      await app.db('users').where({ id }).update(updates)
      
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

      return app.db('users as u')
        .leftJoin('groups as g', 'u.vpn_group_id', 'g.id')
        .select('u.id', 'u.username', 'u.email', 'u.role', 'u.is_active', 'u.vpn_ip', 'u.vpn_group_id', 'g.name as vpn_group_name', 'u.updated_at')
        .where('u.id', id)
        .first()
    },
  )

  // POST /api/v1/users/:id/generate-cert
  app.post<{ Params: { id: string }; Body: { nodeId: string; password?: string; passwordProtected?: boolean; validDays?: number | null } }>(
    '/users/:id/generate-cert',
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ['users'],
        summary: 'Generate client certificate for user on specific node',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['nodeId'],
          properties: {
            nodeId: { type: 'string', format: 'uuid' },
            password: { type: 'string', description: 'Password to encrypt private key (optional)' },
            passwordProtected: { type: 'boolean', description: 'Whether to password-protect the key', default: false },
            validDays: { type: ['number', 'null'], description: 'Certificate validity in days (null = unlimited)', default: null }
          }
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params
      const { nodeId, password, passwordProtected, validDays = null } = request.body

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

      // Ensure user has a VPN IP before configuring WireGuard/OpenVPN
      if (!user.vpn_ip) {
        let subnetToUse = ''
        
        if (user.vpn_group_id) {
          const group = await app.db('groups').where({ id: user.vpn_group_id }).first()
          if (group?.vpn_subnet) subnetToUse = group.vpn_subnet
        }
        
        // Dynamic fallback to node's configured network instead of hardcoded 10.8.0.0/24
        if (!subnetToUse) {
          const network = node.vpn_network || '10.8.0.0'
          let prefixLen = 24
          if (node.vpn_netmask) {
            const parts = node.vpn_netmask.split('.').map(Number)
            if (parts.length === 4) {
               const intMask = (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]
               prefixLen = 32 - Math.log2((~intMask >>> 0) + 1)
               if (isNaN(prefixLen) || prefixLen < 8 || prefixLen > 30) prefixLen = 24
            }
          }
          subnetToUse = `${network}/${prefixLen}`
        }

        const usedIps = await app.db('users').whereNotNull('vpn_ip').pluck('vpn_ip') as string[]
        const newIp = nextAvailableIp(subnetToUse, usedIps) || `${node.vpn_network ? node.vpn_network.substring(0, node.vpn_network.lastIndexOf('.')) : '10.8.0'}.2`
        
        await app.db('users').where({ id }).update({ vpn_ip: newIp })
        user.vpn_ip = newIp
      }

      // Check if certificate already exists for this user-node combination
      const existingCert = await app.db('user_node_certificates')
        .where({ user_id: id, node_id: nodeId })
        .first()

      // If exists and not revoked, add to revocation list
      if (existingCert && !existingCert.is_revoked && existingCert.client_cert) {
        try {
          await app.db('cert_revocations').insert({
            id: uuidv7(),
            user_id: id,
            node_id: nodeId,
            revoked_cert: existingCert.client_cert,
            reason: 'Certificate regenerated',
            revoked_by: authUser.id,
            revoked_at: new Date()
          })
        } catch (err: any) {
          const errMsg = err.message || 'Unknown error';
          console.error('Failed to add to revocation list:', errMsg.includes('Certificate:') ? errMsg.split('Certificate:')[0] + '[CERTIFICATE REDACTED]' : errMsg);
        }
      }

      // Create task for agent to generate certificate
      const taskId = uuidv7()
      await app.db('tasks').insert({
        id: taskId,
        node_id: nodeId,
        action: 'generate_client_cert',
        payload: JSON.stringify({
          username: user.username,
          password: passwordProtected ? password : undefined,
          validDays: validDays
        }),
        status: 'pending',
        created_at: new Date(),
      })

      // Wait for task completion (with timeout)
      const maxWait = 30000 // 30 seconds
      const startTime = Date.now()
      
      while (Date.now() - startTime < maxWait) {
        const task = await app.db('tasks').where({ id: taskId }).first()
        
        if (task.status === 'done') {
          const result = JSON.parse(task.result || '{}')
          
          // Save or update certificate in user_node_certificates table
          if (existingCert) {
            await app.db('user_node_certificates')
              .where({ user_id: id, node_id: nodeId })
              .update({
                client_cert: result.clientCert,
                client_key: result.clientKey,
                password_protected: result.passwordProtected,
                generated_at: new Date(),
                expires_at: result.expiresAt ? new Date(result.expiresAt) : null,
                is_revoked: false,
                revoked_at: null,
                revoked_by: null,
                revoke_reason: null,
                download_count: 0,
                updated_at: new Date()
              })
          } else {
            await app.db('user_node_certificates').insert({
              id: uuidv7(),
              user_id: id,
              node_id: nodeId,
              client_cert: result.clientCert,
              client_key: result.clientKey,
              password_protected: result.passwordProtected,
              generated_at: new Date(),
              expires_at: result.expiresAt ? new Date(result.expiresAt) : null,
              is_revoked: false,
              created_at: new Date(),
              updated_at: new Date()
            })
          }

          // Important for WireGuard: We must inject the newly generated peer to the server config!
          if (user.vpn_ip) {
            // Find netmask to pass to enqueueCcdTask
            let netmask = '255.255.255.0'
            if (user.vpn_group_id) {
              const group = await app.db('groups').where({ id: user.vpn_group_id }).first()
              if (group?.vpn_subnet) netmask = getNetmask(group.vpn_subnet)
            }
            await enqueueCcdTask(app, user.username, user.vpn_ip, netmask, id)
          }

          return reply.send({
            message: 'Certificate generated successfully',
            expiresAt: result.expiresAt,
            passwordProtected: result.passwordProtected
          })
        }
        
        if (task.status === 'failed') {
          return reply.status(500).send({
            error: 'Internal Server Error',
            message: `Failed to generate certificate: ${task.error_message || 'Unknown error'}`
          })
        }
        
        // Wait 500ms before checking again
        await new Promise(resolve => setTimeout(resolve, 500))
      }

      return reply.status(408).send({
        error: 'Request Timeout',
        message: 'Certificate generation timed out'
      })
    }
  )

  // POST /api/v1/users/bulk-generate-cert
  app.post<{ Body: { userIds: string[]; nodeId: string; password?: string; passwordProtected?: boolean; validDays?: number } }>(
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

          // Ensure user has a VPN IP before generating cert
          if (!user.vpn_ip) {
            let subnetToUse = ''
            
            if (user.vpn_group_id) {
              const group = await app.db('groups').where({ id: user.vpn_group_id }).first()
              if (group?.vpn_subnet) subnetToUse = group.vpn_subnet
            }
            
            // Dynamic fallback to node's configured network
            if (!subnetToUse) {
              const network = node.vpn_network || '10.8.0.0'
              let prefixLen = 24
              if (node.vpn_netmask) {
                const parts = node.vpn_netmask.split('.').map(Number)
                if (parts.length === 4) {
                   const intMask = (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]
                   prefixLen = 32 - Math.log2((~intMask >>> 0) + 1)
                   if (isNaN(prefixLen) || prefixLen < 8 || prefixLen > 30) prefixLen = 24
                }
              }
              subnetToUse = `${network}/${prefixLen}`
            }

            const usedIps = await app.db('users').whereNotNull('vpn_ip').pluck('vpn_ip') as string[]
            const newIp = nextAvailableIp(subnetToUse, usedIps) || `${node.vpn_network ? node.vpn_network.substring(0, node.vpn_network.lastIndexOf('.')) : '10.8.0'}.2`
            
            await app.db('users').where({ id: userId }).update({ vpn_ip: newIp })
            user.vpn_ip = newIp
          }

          const existingCert = await app.db('user_node_certificates')
            .where({ user_id: userId, node_id: nodeId })
            .first()

          // Revoke existing certificate
          if (existingCert && !existingCert.is_revoked && existingCert.client_cert) {
            try {
              // Verify node exists before inserting
              const nodeExists = await app.db('vpn_nodes').where({ id: nodeId }).first()
              if (nodeExists) {
                await app.db('cert_revocations').insert({
                  id: uuidv7(),
                  user_id: userId,
                  node_id: nodeId,
                  revoked_cert: existingCert.client_cert,
                  reason: 'Bulk certificate generation',
                  revoked_by: authUser.id,
                  revoked_at: new Date()
                })
              }
            } catch (err: any) {
              const errMsg = err.message || 'Unknown error';
              console.warn(`[bulk-gen] Failed to add revocation for user ${userId}:`, errMsg.includes('Certificate:') ? errMsg.split('Certificate:')[0] + '[CERTIFICATE REDACTED]' : errMsg);
              // Continue with certificate generation even if revocation logging fails
            }
          }

          // Create task
          const taskId = uuidv7()
          await app.db('tasks').insert({
            id: taskId,
            node_id: nodeId,
            action: 'generate_client_cert',
            payload: JSON.stringify({
              username: user.username,
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

          while (Date.now() - startTime < maxWait) {
            const task = await app.db('tasks').where({ id: taskId }).first()
            
            if (task.status === 'done') {
              const result = JSON.parse(task.result || '{}')
              
              if (existingCert) {
                await app.db('user_node_certificates')
                  .where({ user_id: userId, node_id: nodeId })
                  .update({
                    client_cert: result.clientCert,
                    client_key: result.clientKey,
                    password_protected: result.passwordProtected,
                    generated_at: new Date(),
                    expires_at: result.expiresAt ? new Date(result.expiresAt) : null,
                    is_revoked: false,
                    revoked_at: null,
                    revoked_by: null,
                    revoke_reason: null,
                    download_count: 0,
                    updated_at: new Date()
                  })
              } else {
                await app.db('user_node_certificates').insert({
                  id: uuidv7(),
                  user_id: userId,
                  node_id: nodeId,
                  client_cert: result.clientCert,
                  client_key: result.clientKey,
                  password_protected: result.passwordProtected,
                  generated_at: new Date(),
                  expires_at: result.expiresAt ? new Date(result.expiresAt) : null,
                  is_revoked: false,
                  created_at: new Date(),
                  updated_at: new Date()
                })
              }

              // Important for WireGuard: We must inject the newly generated peer to the server config!
              if (user.vpn_ip) {
                let netmask = '255.255.255.0'
                if (user.vpn_group_id) {
                  const group = await app.db('groups').where({ id: user.vpn_group_id }).first()
                  if (group?.vpn_subnet) netmask = getNetmask(group.vpn_subnet)
                }
                await enqueueCcdTask(app, user.username, user.vpn_ip, netmask, userId)
              }

              success = true
              break
            }
            
            if (task.status === 'failed') {
              results.failed.push({ userId, error: task.error_message || 'Unknown error' })
              break
            }
            
            await new Promise(resolve => setTimeout(resolve, 500))
          }

          if (success) {
            results.success.push(userId)
          } else if (!results.failed.find(f => f.userId === userId)) {
            results.failed.push({ userId, error: 'Timeout' })
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
      onRequest: [app.authenticate],
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
          'vpn_nodes.hostname as node_hostname',
          'vpn_nodes.ip_address as node_ip',
          'vpn_nodes.status as node_status',
          'user_node_certificates.password_protected',
          'user_node_certificates.generated_at',
          'user_node_certificates.expires_at',
          'user_node_certificates.last_downloaded_at',
          'user_node_certificates.download_count',
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

      if (certificate.is_revoked) {
        return reply.status(400).send({ error: 'Bad Request', message: 'Certificate already revoked' })
      }

      // Add to revocation list
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
          console.error('Failed to add to revocation list:', err.message)
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
        certificate = await app.db('user_node_certificates')
          .where({ user_id: id, node_id: nodeId })
          .first()
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

        await app.db('cert_download_history').insert({
          id: uuidv7(),
          user_id: id,
          node_id: node.id,
          ip_address: getClientIp(request),
          user_agent: request.headers['user-agent'] || null,
          downloaded_at: new Date()
        })

        // Also push to audit_logs for visibility in global logs
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

      // Fetch all network CIDRs assigned to ALL user's groups → split-tunnel routes
      const userGroupIds = await app.db('user_groups')
        .where({ user_id: id })
        .pluck('group_id') as string[]

      let splitCidrs: string[] = []
      let routeLines = ''
      
      let hasGroupSubnet = false

      if (userGroupIds.length > 0) {
        // 1. Add Group VPN Subnets
        const groupSubnets = await app.db('groups')
          .whereIn('id', userGroupIds)
          .whereNotNull('vpn_subnet')
          .select('vpn_subnet')
        
        for (const grp of groupSubnets) {
          if (grp.vpn_subnet) {
            splitCidrs.push(grp.vpn_subnet)
            hasGroupSubnet = true
          }
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
          allowedIps = [...new Set(splitCidrs)].join(', ')
        }

        // For WireGuard: prioritise explicit endpoint_port, then custom port, then fallback to standard 51820.
        // It's likely node.port is 1194 from default OpenVPN seeds, so ignore 1194 for WG.
        const actualPort = node.endpoint_port || (node.port && node.port !== 1194 ? node.port : 51820)
        const endpoint = `${node.ip_address}:${actualPort}`
        const wgConfig = `[Interface]
PrivateKey = ${certificate.client_key.trim()}
Address = ${user.vpn_ip || '10.8.0.2'}/32
${node.dns_servers ? `DNS = ${node.dns_servers}` : ''}

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

      // Determine TLS cipher based on server cipher
      let tlsCipher = 'TLS-ECDHE-ECDSA-WITH-AES-128-GCM-SHA256'
      if (cipher.includes('256')) {
        tlsCipher = 'TLS-ECDHE-ECDSA-WITH-AES-256-GCM-SHA384'
      }

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

export default userRoutes

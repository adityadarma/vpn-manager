import type { FastifyPluginAsync } from 'fastify'
import { v7 as uuidv7 } from 'uuid'
import { getClientIp, logAudit } from '../../utils/audit'
import { enqueueDnsSyncForGroups } from '../../services/managed-dns'

const FQDN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const RELATIVE_NAME = /^(?:@|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*)$/

function normalizeFqdn(value: string): string | null {
  const normalized = value.trim().toLowerCase().replace(/\.$/, '')
  return FQDN.test(normalized) ? normalized : null
}

function normalizeDomainPattern(value: string): string | null {
  const raw = value.trim().toLowerCase().replace(/\.$/, '')
  if (raw.startsWith('*.')) {
    const suffix = raw.slice(2)
    return normalizeFqdn(suffix) ? `*.${suffix}` : null
  }
  return normalizeFqdn(raw)
}

function isIpv4(value: string): boolean {
  const parts = value.split('.').map(Number)
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
}

function normalizeRecord(name: string, type: string, value: string): { name: string; type: string; value: string } | null {
  const normalizedName = name.trim().toLowerCase().replace(/\.$/, '') || '@'
  const normalizedType = type.trim().toUpperCase()
  const rawValue = value.trim()
  if (!RELATIVE_NAME.test(normalizedName) || !['A', 'AAAA', 'CNAME', 'TXT'].includes(normalizedType)) return null
  if (normalizedType === 'A' && !/^([0-9]{1,3}\.){3}[0-9]{1,3}$/.test(rawValue)) return null
  if (normalizedType === 'A' && rawValue.split('.').some((part) => Number(part) > 255)) return null
  if (normalizedType === 'AAAA' && !/^[0-9a-f:]+$/i.test(rawValue)) return null
  if (normalizedType === 'CNAME' && !normalizeFqdn(rawValue)) return null
  if (normalizedType === 'TXT' && (rawValue.length > 1024 || /[\r\n\u0000]/.test(rawValue))) return null
  return { name: normalizedName, type: normalizedType, value: normalizedType === 'CNAME' ? normalizeFqdn(rawValue)! : rawValue }
}

const dnsRoutes: FastifyPluginAsync = async (app) => {
  const audit = async (request: any, action: string, resourceType: string, resourceId: string, metadata?: Record<string, unknown>) => {
    const user = request.user as { id: string; username: string }
    await logAudit(app, { userId: user.id, username: user.username, action, resourceType, resourceId, ipAddress: getClientIp(request), metadata })
  }

  app.get('/dns/zones', { onRequest: [app.authenticateAdmin] }, async () => {
    return app.db('dns_zones as z')
      .leftJoin('dns_records as r', 'z.id', 'r.zone_id')
      .select('z.*', app.db.raw('COUNT(r.id) as record_count'))
      .groupBy('z.id', 'z.name', 'z.description', 'z.enabled', 'z.created_at', 'z.updated_at')
      .orderBy('z.name')
  })

  app.post<{ Body: { name: string; description?: string; enabled?: boolean } }>('/dns/zones', { onRequest: [app.authenticateAdmin] }, async (request, reply) => {
    const name = normalizeFqdn(request.body.name ?? '')
    if (!name) return reply.status(400).send({ error: 'Zone name must be a valid lowercase DNS name' })
    if (request.body.description && request.body.description.length > 500) return reply.status(400).send({ error: 'description is too long' })
    const id = uuidv7()
    try {
      await app.db('dns_zones').insert({ id, name, description: request.body.description?.trim() ?? null, enabled: request.body.enabled ?? true })
    } catch (error: any) {
      if (String(error.message).toLowerCase().includes('unique')) return reply.status(409).send({ error: 'Zone already exists' })
      throw error
    }
    await audit(request, 'dns_zone_create', 'dns_zone', id, { name })
    return reply.status(201).send(await app.db('dns_zones').where({ id }).first())
  })

  app.patch<{ Params: { id: string }; Body: { description?: string | null; enabled?: boolean } }>('/dns/zones/:id', { onRequest: [app.authenticateAdmin] }, async (request, reply) => {
    if (request.body.description !== undefined && request.body.description !== null && request.body.description.length > 500) return reply.status(400).send({ error: 'description is too long' })
    const updated = await app.db('dns_zones').where({ id: request.params.id }).update({
      ...(request.body.description !== undefined ? { description: request.body.description?.trim() ?? null } : {}),
      ...(request.body.enabled !== undefined ? { enabled: request.body.enabled } : {}),
      updated_at: new Date(),
    })
    if (!updated) return reply.status(404).send({ error: 'Zone not found' })
    const groups = await app.db('group_dns_zones').where({ zone_id: request.params.id }).pluck('group_id') as string[]
    await enqueueDnsSyncForGroups(app, groups)
    await audit(request, 'dns_zone_update', 'dns_zone', request.params.id)
    return app.db('dns_zones').where({ id: request.params.id }).first()
  })

  app.delete<{ Params: { id: string } }>('/dns/zones/:id', { onRequest: [app.authenticateAdmin] }, async (request, reply) => {
    const groups = await app.db('group_dns_zones').where({ zone_id: request.params.id }).pluck('group_id') as string[]
    const deleted = await app.db('dns_zones').where({ id: request.params.id }).delete()
    if (!deleted) return reply.status(404).send({ error: 'Zone not found' })
    await enqueueDnsSyncForGroups(app, groups)
    await audit(request, 'dns_zone_delete', 'dns_zone', request.params.id)
    return reply.status(204).send()
  })

  app.get<{ Params: { id: string } }>('/dns/zones/:id/records', { onRequest: [app.authenticateAdmin] }, async (request, reply) => {
    const zone = await app.db('dns_zones').where({ id: request.params.id }).first()
    if (!zone) return reply.status(404).send({ error: 'Zone not found' })
    return app.db('dns_records').where({ zone_id: zone.id }).orderBy('name').orderBy('type')
  })

  app.post<{ Params: { id: string }; Body: { name: string; type: string; value: string; ttl?: number; enabled?: boolean } }>('/dns/zones/:id/records', { onRequest: [app.authenticateAdmin] }, async (request, reply) => {
    const zone = await app.db('dns_zones').where({ id: request.params.id }).first()
    if (!zone) return reply.status(404).send({ error: 'Zone not found' })
    const record = normalizeRecord(request.body.name ?? '', request.body.type ?? '', request.body.value ?? '')
    const ttl = request.body.ttl ?? 60
    if (!record || !Number.isInteger(ttl) || ttl < 30 || ttl > 86400) return reply.status(400).send({ error: 'Invalid DNS record' })
    const id = uuidv7()
    try {
      await app.db('dns_records').insert({ id, zone_id: zone.id, ...record, ttl, enabled: request.body.enabled ?? true })
    } catch (error: any) {
      if (String(error.message).toLowerCase().includes('unique')) return reply.status(409).send({ error: 'Record already exists' })
      throw error
    }
    await audit(request, 'dns_record_create', 'dns_record', id, { zone_id: zone.id, ...record })
    const groups = await app.db('group_dns_zones').where({ zone_id: zone.id }).pluck('group_id') as string[]
    await enqueueDnsSyncForGroups(app, groups)
    return reply.status(201).send(await app.db('dns_records').where({ id }).first())
  })

  app.patch<{ Params: { id: string }; Body: { name?: string; type?: string; value?: string; ttl?: number; enabled?: boolean } }>('/dns/records/:id', { onRequest: [app.authenticateAdmin] }, async (request, reply) => {
    const current = await app.db('dns_records').where({ id: request.params.id }).first()
    if (!current) return reply.status(404).send({ error: 'Record not found' })
    const record = normalizeRecord(request.body.name ?? current.name, request.body.type ?? current.type, request.body.value ?? current.value)
    const ttl = request.body.ttl ?? current.ttl
    if (!record || !Number.isInteger(ttl) || ttl < 30 || ttl > 86400) return reply.status(400).send({ error: 'Invalid DNS record' })
    try {
      await app.db('dns_records').where({ id: current.id }).update({ ...record, ttl, ...(request.body.enabled !== undefined ? { enabled: request.body.enabled } : {}), updated_at: new Date() })
    } catch (error: any) {
      if (String(error.message).toLowerCase().includes('unique')) return reply.status(409).send({ error: 'Record already exists' })
      throw error
    }
    await audit(request, 'dns_record_update', 'dns_record', current.id)
    const groups = await app.db('group_dns_zones').where({ zone_id: current.zone_id }).pluck('group_id') as string[]
    await enqueueDnsSyncForGroups(app, groups)
    return app.db('dns_records').where({ id: current.id }).first()
  })

  app.delete<{ Params: { id: string } }>('/dns/records/:id', { onRequest: [app.authenticateAdmin] }, async (request, reply) => {
    const record = await app.db('dns_records').where({ id: request.params.id }).first()
    if (!record) return reply.status(404).send({ error: 'Record not found' })
    const deleted = await app.db('dns_records').where({ id: request.params.id }).delete()
    if (!deleted) return reply.status(404).send({ error: 'Record not found' })
    const groups = await app.db('group_dns_zones').where({ zone_id: record.zone_id }).pluck('group_id') as string[]
    await enqueueDnsSyncForGroups(app, groups)
    await audit(request, 'dns_record_delete', 'dns_record', request.params.id)
    return reply.status(204).send()
  })

  app.get<{ Params: { id: string } }>('/groups/:id/dns/zones', { onRequest: [app.authenticateAdmin] }, async (request, reply) => {
    const group = await app.db('groups').where({ id: request.params.id }).first()
    if (!group) return reply.status(404).send({ error: 'Group not found' })
    return app.db('dns_zones as z')
      .join('group_dns_zones as gz', 'z.id', 'gz.zone_id')
      .where('gz.group_id', group.id)
      .select('z.*')
      .orderBy('z.name')
  })

  app.put<{ Params: { id: string }; Body: { zone_ids: string[] } }>('/groups/:id/dns/zones', { onRequest: [app.authenticateAdmin] }, async (request, reply) => {
    if (!Array.isArray(request.body.zone_ids) || request.body.zone_ids.length > 100) return reply.status(400).send({ error: 'zone_ids must contain up to 100 zone IDs' })
    const group = await app.db('groups').where({ id: request.params.id }).first()
    if (!group) return reply.status(404).send({ error: 'Group not found' })
    const zoneIds = [...new Set(request.body.zone_ids)]
    const zones = zoneIds.length === 0 ? [] : await app.db('dns_zones').whereIn('id', zoneIds).select('id')
    if (zones.length !== zoneIds.length) return reply.status(400).send({ error: 'One or more zones do not exist' })
    await app.db.transaction(async (trx) => {
      await trx('group_dns_zones').where({ group_id: group.id }).delete()
      if (zoneIds.length > 0) await trx('group_dns_zones').insert(zoneIds.map((zone_id) => ({ group_id: group.id, zone_id })))
    })
    await audit(request, 'group_dns_zones_update', 'group', group.id, { zone_ids: zoneIds })
    await enqueueDnsSyncForGroups(app, [group.id])
    return app.db('dns_zones as z').join('group_dns_zones as gz', 'z.id', 'gz.zone_id').where('gz.group_id', group.id).select('z.*').orderBy('z.name')
  })

  app.get<{ Params: { id: string } }>('/groups/:id/dns/policies', { onRequest: [app.authenticateAdmin] }, async (request, reply) => {
    const group = await app.db('groups').where({ id: request.params.id }).first()
    if (!group) return reply.status(404).send({ error: 'Group not found' })
    return app.db('dns_policies').where({ group_id: group.id }).orderBy('priority', 'desc').orderBy('domain_pattern')
  })

  app.post<{ Params: { id: string }; Body: { domain_pattern: string; action: 'allow' | 'block' | 'sinkhole'; scope?: 'public' | 'internal' | 'any'; priority?: number; sinkhole_ipv4?: string | null; enabled?: boolean } }>('/groups/:id/dns/policies', { onRequest: [app.authenticateAdmin] }, async (request, reply) => {
    const group = await app.db('groups').where({ id: request.params.id }).first()
    if (!group) return reply.status(404).send({ error: 'Group not found' })
    const policy = validatePolicy(request.body)
    if (!policy) return reply.status(400).send({ error: 'Invalid DNS policy' })
    const id = uuidv7()
    try {
      await app.db('dns_policies').insert({ id, group_id: group.id, ...policy, enabled: request.body.enabled ?? true })
    } catch (error: any) {
      if (String(error.message).toLowerCase().includes('unique')) return reply.status(409).send({ error: 'A policy for this domain pattern and scope already exists' })
      throw error
    }
    await audit(request, 'dns_policy_create', 'dns_policy', id, { group_id: group.id, ...policy })
    await enqueueDnsSyncForGroups(app, [group.id])
    return reply.status(201).send(await app.db('dns_policies').where({ id }).first())
  })

  app.patch<{ Params: { id: string }; Body: { domain_pattern?: string; action?: 'allow' | 'block' | 'sinkhole'; scope?: 'public' | 'internal' | 'any'; priority?: number; sinkhole_ipv4?: string | null; enabled?: boolean } }>('/dns/policies/:id', { onRequest: [app.authenticateAdmin] }, async (request, reply) => {
    const current = await app.db('dns_policies').where({ id: request.params.id }).first()
    if (!current) return reply.status(404).send({ error: 'DNS policy not found' })
    const policy = validatePolicy({ ...current, ...request.body })
    if (!policy) return reply.status(400).send({ error: 'Invalid DNS policy' })
    try {
      await app.db('dns_policies').where({ id: current.id }).update({ ...policy, ...(request.body.enabled !== undefined ? { enabled: request.body.enabled } : {}), updated_at: new Date() })
    } catch (error: any) {
      if (String(error.message).toLowerCase().includes('unique')) return reply.status(409).send({ error: 'A policy for this domain pattern and scope already exists' })
      throw error
    }
    await audit(request, 'dns_policy_update', 'dns_policy', current.id)
    await enqueueDnsSyncForGroups(app, [current.group_id])
    return app.db('dns_policies').where({ id: current.id }).first()
  })

  app.delete<{ Params: { id: string } }>('/dns/policies/:id', { onRequest: [app.authenticateAdmin] }, async (request, reply) => {
    const policy = await app.db('dns_policies').where({ id: request.params.id }).first()
    if (!policy) return reply.status(404).send({ error: 'DNS policy not found' })
    const deleted = await app.db('dns_policies').where({ id: request.params.id }).delete()
    if (!deleted) return reply.status(404).send({ error: 'DNS policy not found' })
    await enqueueDnsSyncForGroups(app, [policy.group_id])
    await audit(request, 'dns_policy_delete', 'dns_policy', request.params.id)
    return reply.status(204).send()
  })
}

function validatePolicy(input: { domain_pattern?: string; action?: string; scope?: string; priority?: number; sinkhole_ipv4?: string | null }) {
  const domain_pattern = normalizeDomainPattern(input.domain_pattern ?? '')
  const action = input.action
  const scope = input.scope ?? 'any'
  const priority = input.priority ?? 0
  const sinkhole_ipv4 = input.sinkhole_ipv4?.trim() || null
  if (!domain_pattern || !['allow', 'block', 'sinkhole'].includes(action ?? '')) return null
  if (!['public', 'internal', 'any'].includes(scope)) return null
  if (!Number.isInteger(priority) || priority < -10000 || priority > 10000) return null
  if (action === 'sinkhole' && (!sinkhole_ipv4 || !isIpv4(sinkhole_ipv4))) return null
  if (action !== 'sinkhole' && sinkhole_ipv4) return null
  return { domain_pattern, action, scope, priority, sinkhole_ipv4 }
}

export default dnsRoutes

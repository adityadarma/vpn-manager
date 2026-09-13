import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { v7 as uuidv7 } from 'uuid'
import { buildApp } from '../src/app'
import { loginAsAdmin } from './helpers'

describe('Private DNS API', () => {
  let app: FastifyInstance
  let cookie: string
  let zoneId: string
  let recordId: string
  let groupId: string

  beforeAll(async () => {
    app = await buildApp({
      JWT_SECRET: 'test-secret-test-secret-test-secret', JWT_EXPIRES_IN: '1h', NODE_ENV: 'test',
    } as any)
    await app.db.migrate.latest()
    await app.db.seed.run()
    cookie = await loginAsAdmin(app)
    groupId = uuidv7()
    await app.db('groups').insert({ id: groupId, name: 'private-dns-group' })
  })

  afterAll(async () => app.close())

  it('creates a normalized zone and private A record', async () => {
    const zone = await app.inject({ method: 'POST', url: '/api/v1/dns/zones', headers: { Cookie: cookie }, payload: { name: 'Corp.Internal.', description: 'Private services' } })
    expect(zone.statusCode).toBe(201)
    zoneId = zone.json().id
    expect(zone.json().name).toBe('corp.internal')

    const record = await app.inject({ method: 'POST', url: `/api/v1/dns/zones/${zoneId}/records`, headers: { Cookie: cookie }, payload: { name: 'Git', type: 'A', value: '10.20.10.15', ttl: 60 } })
    expect(record.statusCode).toBe(201)
    recordId = record.json().id
    expect(record.json()).toMatchObject({ name: 'git', type: 'A', value: '10.20.10.15', ttl: 60 })
  })

  it('rejects unsafe records and duplicate zones', async () => {
    const duplicate = await app.inject({ method: 'POST', url: '/api/v1/dns/zones', headers: { Cookie: cookie }, payload: { name: 'corp.internal' } })
    expect(duplicate.statusCode).toBe(409)
    const unsafe = await app.inject({ method: 'POST', url: `/api/v1/dns/zones/${zoneId}/records`, headers: { Cookie: cookie }, payload: { name: 'bad\nname', type: 'TXT', value: 'test' } })
    expect(unsafe.statusCode).toBe(400)
    const invalidA = await app.inject({ method: 'POST', url: `/api/v1/dns/zones/${zoneId}/records`, headers: { Cookie: cookie }, payload: { name: 'bad', type: 'A', value: '999.1.1.1' } })
    expect(invalidA.statusCode).toBe(400)
  })

  it('updates a record and assigns the zone to a group', async () => {
    const updated = await app.inject({ method: 'PATCH', url: `/api/v1/dns/records/${recordId}`, headers: { Cookie: cookie }, payload: { type: 'CNAME', value: 'git-backend.corp.internal.' } })
    expect(updated.statusCode).toBe(200)
    expect(updated.json()).toMatchObject({ type: 'CNAME', value: 'git-backend.corp.internal' })

    const assignment = await app.inject({ method: 'PUT', url: `/api/v1/groups/${groupId}/dns/zones`, headers: { Cookie: cookie }, payload: { zone_ids: [zoneId] } })
    expect(assignment.statusCode).toBe(200)
    expect(assignment.json()).toHaveLength(1)
    expect(assignment.json()[0].id).toBe(zoneId)

    const assigned = await app.inject({ method: 'GET', url: `/api/v1/groups/${groupId}/dns/zones`, headers: { Cookie: cookie } })
    expect(assigned.statusCode).toBe(200)
    expect(assigned.json().map((zone: { id: string }) => zone.id)).toEqual([zoneId])

    const cleared = await app.inject({ method: 'PUT', url: `/api/v1/groups/${groupId}/dns/zones`, headers: { Cookie: cookie }, payload: { zone_ids: [] } })
    expect(cleared.statusCode).toBe(200)
    const afterClear = await app.inject({ method: 'GET', url: `/api/v1/groups/${groupId}/dns/zones`, headers: { Cookie: cookie } })
    expect(afterClear.json()).toHaveLength(0)
  })

  it('creates normalized exact and wildcard domain policies', async () => {
    const block = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${groupId}/dns/policies`,
      headers: { Cookie: cookie },
      payload: { domain_pattern: '*.YouTube.com.', action: 'block', scope: 'public', priority: 20 },
    })
    expect(block.statusCode).toBe(201)
    expect(block.json()).toMatchObject({ domain_pattern: '*.youtube.com', action: 'block', scope: 'public', priority: 20 })

    const sinkhole = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${groupId}/dns/policies`,
      headers: { Cookie: cookie },
      payload: { domain_pattern: 'tracker.example', action: 'sinkhole', sinkhole_ipv4: '10.20.10.254' },
    })
    expect(sinkhole.statusCode).toBe(201)
    expect(sinkhole.json()).toMatchObject({ domain_pattern: 'tracker.example', action: 'sinkhole', sinkhole_ipv4: '10.20.10.254' })
  })

  it('rejects unsupported wildcard forms and invalid sinkhole policies', async () => {
    const wildcard = await app.inject({
      method: 'POST', url: `/api/v1/groups/${groupId}/dns/policies`, headers: { Cookie: cookie },
      payload: { domain_pattern: 'api.*.example.com', action: 'block' },
    })
    expect(wildcard.statusCode).toBe(400)
    const invalidSinkhole = await app.inject({
      method: 'POST', url: `/api/v1/groups/${groupId}/dns/policies`, headers: { Cookie: cookie },
      payload: { domain_pattern: 'tracker.invalid', action: 'sinkhole', sinkhole_ipv4: '999.1.1.1' },
    })
    expect(invalidSinkhole.statusCode).toBe(400)
    const straySinkhole = await app.inject({
      method: 'POST', url: `/api/v1/groups/${groupId}/dns/policies`, headers: { Cookie: cookie },
      payload: { domain_pattern: 'example.net', action: 'block', sinkhole_ipv4: '10.0.0.1' },
    })
    expect(straySinkhole.statusCode).toBe(400)
  })
})

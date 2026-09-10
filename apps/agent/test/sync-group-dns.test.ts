import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEnv } from '../src/config/env'
import type { VpnDriver } from '../src/drivers'

// The handler assigns listener addresses with `ip`, which does not exist on
// every dev machine. Stub the service so these tests stay about config
// generation; the real address handling is covered by the live E2E script.
const { ensureDnsListenerAddresses, currentDnsListenerAddresses } = vi.hoisted(() => ({
  ensureDnsListenerAddresses: vi.fn().mockResolvedValue(undefined),
  currentDnsListenerAddresses: vi.fn().mockResolvedValue([]),
}))
vi.mock('../src/services/managed-dns-listener', () => ({ ensureDnsListenerAddresses, currentDnsListenerAddresses }))

import { handleSyncGroupDns } from '../src/handlers/sync-group-dns'

const roots: string[] = []

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vpn-dns-'))
  roots.push(root)
  const env = {
    DNS_ENABLED: true,
    FIREWALL_ENGINE: 'none',
    VPN_TYPE: 'openvpn',
    COREDNS_CONFIG_DIR: root,
    COREDNS_HEALTH_URL: 'http://127.0.0.1:8181/health',
  } as AgentEnv
  return { root, env }
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('sync_group_dns handler', () => {
  const payload = {
    revision: 1,
    config_hash: `sha256:${'a'.repeat(64)}`,
    groups: [{
      id: '018f1d8b-4f90-7ce1-b9d7-018f1d8b4f90',
      name: 'engineering',
      vpn_subnet: '10.20.10.0/24',
      listener_ip: '10.20.10.53',
      listener_port: 53,
      public_default_action: 'allow',
      upstreams: ['1.1.1.1'],
      zones: [{ name: 'corp.internal', records: [{ name: 'git', type: 'A', value: '10.20.10.15', ttl: 60 }] }],
      policies: [
        { domain_pattern: '*.youtube.com', action: 'block', scope: 'public', priority: 10, sinkhole_ipv4: null },
        { domain_pattern: 'tracker.example', action: 'sinkhole', scope: 'public', priority: 5, sinkhole_ipv4: '10.20.10.254' },
      ],
    }],
  }

  it('atomically activates a healthy generated revision', async () => {
    const { root, env } = await fixture()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    const result = await handleSyncGroupDns(payload, {} as VpnDriver, env)
    expect(result).toMatchObject({ revision: 1, status: 'healthy', listeners: ['10.20.10.53:53'] })
    expect(await fs.readlink(path.join(root, 'active'))).toBe('revisions/1')
    expect(await fs.readFile(path.join(root, 'Corefile'), 'utf8')).toContain('file /etc/coredns/active/groups/018f1d8b-4f90-7ce1-b9d7-018f1d8b4f90/zones/corp.internal.db corp.internal')
    const corefile = await fs.readFile(path.join(root, 'Corefile'), 'utf8')
    // A listener must be `.:port` + `bind`, never `ip:port` (that is a zone name).
    expect(corefile).toContain('.:53 {')
    expect(corefile).toContain('    bind 10.20.10.53')
    expect(corefile).not.toContain('10.20.10.53:53 {')
    expect(corefile).toContain('match ^(?:.+\\.youtube\\.com)\\.$')
    expect(corefile).toContain('answer "{{ .Name }} 60 IN A 10.20.10.254"')
    // CoreDNS runs `template` before hosts/file/forward, so every generated
    // block must fall through or it answers all queries for the listener.
    const templateBlocks = corefile.split('\n').filter((line) => line.trim().startsWith('template IN ')).length
    const fallthroughs = corefile.split('\n').filter((line) => line.trim() === 'fallthrough').length
    expect(templateBlocks).toBeGreaterThan(0)
    expect(fallthroughs).toBe(templateBlocks)
    expect(await fs.readFile(path.join(root, 'revisions/1/groups/018f1d8b-4f90-7ce1-b9d7-018f1d8b4f90/zones/corp.internal.db'), 'utf8')).toContain('git 60 IN A 10.20.10.15')
    // The listener address must be assigned before the config goes live, or
    // CoreDNS cannot bind it and exits.
    expect(ensureDnsListenerAddresses).toHaveBeenCalledWith(['10.20.10.53'])
  })

  it('restores the previous revision when CoreDNS health fails', async () => {
    const { root, env } = await fixture()
    await fs.mkdir(path.join(root, 'revisions/0'), { recursive: true })
    await fs.symlink('revisions/0', path.join(root, 'active'))
    await fs.writeFile(path.join(root, 'Corefile'), 'previous config\n')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    await expect(handleSyncGroupDns(payload, {} as VpnDriver, env)).rejects.toThrow('CoreDNS health check returned HTTP 503')
    expect(await fs.readlink(path.join(root, 'active'))).toBe('revisions/0')
    expect(await fs.readFile(path.join(root, 'Corefile'), 'utf8')).toBe('previous config\n')
  })

  it('serialises overlapping syncs instead of interleaving them', async () => {
    const { root, env } = await fixture()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

    // Two syncs started before the first finished. The Agent poller runs on an
    // interval, so this is the real-node case where a slow sync overlaps the
    // next poll and both try to claim the same listener address.
    let active = 0
    let overlapped = false
    ensureDnsListenerAddresses.mockImplementation(async () => {
      active += 1
      if (active > 1) overlapped = true
      await new Promise((resolve) => setTimeout(resolve, 20))
      active -= 1
    })

    const second = { ...payload, revision: 2 }
    const results = await Promise.all([
      handleSyncGroupDns(payload, {} as VpnDriver, env),
      handleSyncGroupDns(second, {} as VpnDriver, env),
    ])

    expect(overlapped).toBe(false)
    expect(results.map((result) => result['revision'])).toEqual([1, 2])
    // The later revision must win the active symlink.
    expect(await fs.readlink(path.join(root, 'active'))).toBe('revisions/2')

    ensureDnsListenerAddresses.mockResolvedValue(undefined)
  })

  it('generates a whitelist-mode Corefile for public_default_action=deny', async () => {
    const { root, env } = await fixture()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    const whitelist = structuredClone(payload)
    whitelist.groups[0]!.public_default_action = 'deny'
    whitelist.groups[0]!.policies = [
      { domain_pattern: 'docs.example.com', action: 'allow', scope: 'public', priority: 0, sinkhole_ipv4: null },
    ]
    const result = await handleSyncGroupDns(whitelist, {} as VpnDriver, env)
    expect(result).toMatchObject({ revision: 1, status: 'healthy' })
    const corefile = await fs.readFile(path.join(root, 'Corefile'), 'utf8')
    // The allow-listed domain (plus the group's own internal zone) gets its
    // own server block that reaches `forward`; every other name falls to a
    // second `.` block that always answers NXDOMAIN.
    expect(corefile).toContain('corp.internal:53 docs.example.com:53 {')
    expect(corefile).toContain('.:53 {')
    expect(corefile).toContain('    template ANY ANY {')
    expect(corefile).toContain('        rcode NXDOMAIN')
    expect(corefile).toContain('forward . 1.1.1.1')
  })

  it('scopes an internal DNS policy to the group\'s own zones only', async () => {
    const { root, env } = await fixture()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    const scoped = structuredClone(payload)
    scoped.groups[0]!.policies = [
      { domain_pattern: 'blocked.corp.internal', action: 'block', scope: 'internal', priority: 0, sinkhole_ipv4: null },
    ]
    await handleSyncGroupDns(scoped, {} as VpnDriver, env)
    const corefile = await fs.readFile(path.join(root, 'Corefile'), 'utf8')
    // The template line carries the group's own zone as an explicit argument,
    // so the rule cannot affect lookups for names outside that zone.
    expect(corefile).toMatch(/template IN A corp\.internal \{/)
    expect(corefile).toContain('match ^(?:blocked\\.corp\\.internal)\\.$')
  })
})

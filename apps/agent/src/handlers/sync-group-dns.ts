import fs from 'node:fs/promises'
import path from 'node:path'
import { validateTaskPayload } from '@vpn/shared'
import type { AgentEnv } from '../config/env'
import type { VpnDriver } from '../drivers'
import { applyManagedDnsFirewall } from '../services/managed-dns-firewall'
import { currentDnsListenerAddresses, ensureDnsListenerAddresses } from '../services/managed-dns-listener'

type DnsRecord = { name: string; type: 'A' | 'AAAA' | 'CNAME' | 'TXT'; value: string; ttl: number }
type DnsZone = { name: string; records: DnsRecord[] }
type DnsPolicy = {
  domain_pattern: string
  action: 'allow' | 'block' | 'sinkhole'
  scope: 'public' | 'internal' | 'any'
  priority: number
  sinkhole_ipv4: string | null
}
type DnsGroup = {
  id: string
  vpn_subnet: string
  listener_ip: string
  listener_port: number
  public_default_action: 'allow' | 'deny'
  upstreams: string[]
  zones: DnsZone[]
  policies: DnsPolicy[]
}

const TEMPLATE_TYPES = ['A', 'AAAA', 'CNAME', 'HTTPS', 'MX', 'NAPTR', 'NS', 'PTR', 'SRV', 'SVCB', 'TXT']

/** Keeps a generated `match` line readable instead of one unbounded regex. */
const PATTERNS_PER_TEMPLATE = 40

/** Returns the RE2 body for one pattern, without anchors. */
function policyPattern(pattern: string): string {
  if (pattern.startsWith('*.')) {
    const escapedSuffix = pattern.slice(2).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return `.+\\.${escapedSuffix}`
  }
  return pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function matchExpression(patterns: string[]): string {
  return `^(?:${patterns.join('|')})\\.$`
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }
  return batches
}

/**
 * Emits one sinkhole `template` block (plus NXDOMAIN blocks for every other
 * record type, so a sinkholed name cannot leak data through e.g. TXT/AAAA).
 *
 * `zoneArgs`, when non-empty, is appended after the record type so the rule
 * only applies within those CoreDNS zones (used for `scope=internal`)
 * instead of the enclosing server block's full zone set.
 */
function emitSinkholeBlock(templates: string[], sinkholeIp: string, patterns: string[], zoneArgs: string): void {
  const match = matchExpression(patterns)
  const zonePart = zoneArgs ? `${zoneArgs} ` : ''
  templates.push(`    template IN A ${zonePart}{`)
  templates.push(`        match ${match}`)
  templates.push(`        answer "{{ .Name }} 60 IN A ${sinkholeIp}"`)
  templates.push('        fallthrough')
  templates.push('    }')
  for (const type of TEMPLATE_TYPES.filter((candidate) => candidate !== 'A')) {
    templates.push(`    template IN ${type} ${zonePart}{`)
    templates.push(`        match ${match}`)
    templates.push('        rcode NXDOMAIN')
    templates.push('        fallthrough')
    templates.push('    }')
  }
}

/** Emits blanket-NXDOMAIN `template` blocks for a batch of blocked patterns. */
function emitBlockedBlock(templates: string[], patterns: string[], zoneArgs: string): void {
  const match = matchExpression(patterns)
  const zonePart = zoneArgs ? `${zoneArgs} ` : ''
  for (const type of TEMPLATE_TYPES) {
    templates.push(`    template IN ${type} ${zonePart}{`)
    templates.push(`        match ${match}`)
    templates.push('        rcode NXDOMAIN')
    templates.push('        fallthrough')
    templates.push('    }')
  }
}

/**
 * Builds the `template` blocks that enforce domain policy.
 *
 * Every block ends with `fallthrough`. This is required, not cosmetic: CoreDNS
 * orders plugins by its own plugin.cfg, not by Corefile order, and `template`
 * runs before `hosts`, `file` and `forward`. A block without `fallthrough`
 * therefore answers *every* query for the listener — verified against
 * coredns/coredns:1.14.7, where it turned all lookups into SERVFAIL.
 *
 * `scope=internal` policies are restricted to the group's own declared zones
 * via an explicit zone argument on the `template` line — CoreDNS accepts a
 * zone list narrower than the enclosing server block's zones, restricting
 * the rule's effect to just those zones instead of the whole listener.
 * Verified on coredns/coredns:1.14.7: a `template` scoped to `corp.internal`
 * left unrelated public lookups on the same listener untouched.
 */
function policyTemplates(group: DnsGroup): string[] {
  const publicBlocked: string[] = []
  const internalBlocked: string[] = []
  const publicSinkholed = new Map<string, string[]>()
  const internalSinkholed = new Map<string, string[]>()
  const internalZoneNames = group.zones.map((zone) => zone.name)
  const policies = [...group.policies].sort((a, b) => b.priority - a.priority || a.domain_pattern.localeCompare(b.domain_pattern))

  for (const policy of policies) {
    if (policy.action === 'allow') continue
    const isInternal = policy.scope === 'internal'
    // A scope=internal policy has nothing to scope to without a declared
    // internal zone. Skip it rather than emit a template with an empty zone
    // argument, which CoreDNS would treat as "no restriction" — the opposite
    // of what an unscoped internal policy should do.
    if (isInternal && internalZoneNames.length === 0) continue
    const pattern = policyPattern(policy.domain_pattern)
    if (policy.action === 'sinkhole') {
      if (!policy.sinkhole_ipv4) {
        throw new Error(`Group ${group.id} has a sinkhole policy without sinkhole_ipv4`)
      }
      const map = isInternal ? internalSinkholed : publicSinkholed
      const existing = map.get(policy.sinkhole_ipv4) ?? []
      existing.push(pattern)
      map.set(policy.sinkhole_ipv4, existing)
    } else {
      const list = isInternal ? internalBlocked : publicBlocked
      list.push(pattern)
    }
  }

  const templates: string[] = []
  const internalZoneArgs = internalZoneNames.join(' ')

  // Sinkhole first: an A answer is more specific than a blanket NXDOMAIN.
  for (const [sinkholeIp, patterns] of publicSinkholed) {
    for (const batch of chunk(patterns, PATTERNS_PER_TEMPLATE)) emitSinkholeBlock(templates, sinkholeIp, batch, '')
  }
  for (const [sinkholeIp, patterns] of internalSinkholed) {
    for (const batch of chunk(patterns, PATTERNS_PER_TEMPLATE)) emitSinkholeBlock(templates, sinkholeIp, batch, internalZoneArgs)
  }
  for (const batch of chunk(publicBlocked, PATTERNS_PER_TEMPLATE)) emitBlockedBlock(templates, batch, '')
  for (const batch of chunk(internalBlocked, PATTERNS_PER_TEMPLATE)) emitBlockedBlock(templates, batch, internalZoneArgs)

  return templates
}

function zoneFile(zone: DnsZone): string {
  const lines = [
    `$ORIGIN ${zone.name}.`,
    '$TTL 60',
    `@ IN SOA ns1.${zone.name}. hostmaster.${zone.name}. 1 3600 600 86400 60`,
    `@ IN NS ns1.${zone.name}.`,
  ]
  for (const record of zone.records) {
    const value = record.type === 'TXT' ? `"${record.value.replace(/"/g, '\\"')}"` : record.value
    lines.push(`${record.name} ${record.ttl} IN ${record.type} ${value}`)
  }
  return `${lines.join('\n')}\n`
}

/** Strips a leading `*.` so an allow pattern can be used as a CoreDNS zone name. */
function zoneNameFromPattern(pattern: string): string {
  return pattern.startsWith('*.') ? pattern.slice(2) : pattern
}

/**
 * Emits the Corefile block(s) for one group.
 *
 * `public_default_action=allow` (the common case) needs exactly one `.`
 * block: everything not explicitly blocked/sinkholed reaches `forward`.
 *
 * `public_default_action=deny` (whitelist mode) needs two blocks, because no
 * standard CoreDNS plugin can express "forward this query, unless denied" —
 * `template` always answers a match directly and never re-delegates
 * (verified by reading coredns/coredns plugin/template/template.go: a
 * matching template returns its own message, it does not call `plugin.Next`).
 * Zone *scoping* is the only primitive available: CoreDNS routes a query to
 * whichever server block's zone list has the longest match on the query
 * name, so declaring the group's internal zones plus its allow-listed
 * domains as one block's explicit zones, and leaving `.` for a second block
 * that always answers NXDOMAIN, reproduces "allow-list, deny everything
 * else" with zero custom code. Verified on coredns/coredns:1.14.7: a name
 * inside a declared zone resolves via that block's `forward`, and any other
 * name falls to the `.` block's blanket NXDOMAIN.
 *
 * Because an allow pattern becomes a CoreDNS *zone*, it also permits every
 * subdomain of that name, not just the exact FQDN — a zone is defined that
 * way in DNS. This is wider than the exact-vs-`*.`-prefix distinction the
 * `block`/`sinkhole` policies observe, and is an accepted trade-off for
 * avoiding a custom CoreDNS plugin.
 */
function buildGroupBlocks(group: DnsGroup, includeHealth: boolean): string[] {
  const templates = policyTemplates(group)
  const zoneFiles = group.zones.map(
    (zone) => `    file /etc/coredns/active/groups/${group.id}/zones/${zone.name}.db ${zone.name}`,
  )
  const forwardLine = group.upstreams.length > 0 ? `    forward . ${group.upstreams.join(' ')}` : null

  if (group.public_default_action === 'allow') {
    const blocks: string[] = []
    // `.:port` plus an explicit `bind` is required. Writing `ip:port {` makes
    // CoreDNS treat the address as a *zone name* instead of a listen address,
    // which answers REFUSED for everything — verified on coredns/coredns:1.14.7.
    blocks.push(`.:${group.listener_port} {`)
    blocks.push(`    bind ${group.listener_ip}`)
    blocks.push('    errors')
    if (includeHealth) blocks.push('    health 127.0.0.1:8181')
    blocks.push('    cache 30')
    blocks.push(...zoneFiles)
    blocks.push(...templates)
    if (forwardLine) blocks.push(forwardLine)
    blocks.push('    reload 2s')
    blocks.push('}')
    blocks.push('')
    return blocks
  }

  // Whitelist mode: permittedZones is every name this listener may forward
  // for. Anything outside it lands on the second, always-NXDOMAIN block.
  const allowedZoneNames = group.policies.filter((policy) => policy.action === 'allow').map((policy) => zoneNameFromPattern(policy.domain_pattern))
  const internalZoneNames = group.zones.map((zone) => zone.name)
  const permittedZones = [...new Set([...internalZoneNames, ...allowedZoneNames])]

  const blocks: string[] = []
  let healthPlaced = false

  if (permittedZones.length > 0) {
    blocks.push(`${permittedZones.map((zone) => `${zone}:${group.listener_port}`).join(' ')} {`)
    blocks.push(`    bind ${group.listener_ip}`)
    blocks.push('    errors')
    if (includeHealth) {
      blocks.push('    health 127.0.0.1:8181')
      healthPlaced = true
    }
    blocks.push('    cache 30')
    blocks.push(...zoneFiles)
    blocks.push(...templates)
    if (forwardLine) blocks.push(forwardLine)
    blocks.push('    reload 2s')
    blocks.push('}')
    blocks.push('')
  }

  blocks.push(`.:${group.listener_port} {`)
  blocks.push(`    bind ${group.listener_ip}`)
  blocks.push('    errors')
  if (includeHealth && !healthPlaced) blocks.push('    health 127.0.0.1:8181')
  blocks.push('    template ANY ANY {')
  blocks.push('        rcode NXDOMAIN')
  blocks.push('    }')
  blocks.push('    reload 2s')
  blocks.push('}')
  blocks.push('')
  return blocks
}

function corefile(groups: DnsGroup[]): string {
  const blocks: string[] = []
  for (const [index, group] of groups.entries()) {
    blocks.push(...buildGroupBlocks(group, index === 0))
  }
  return blocks.join('\n')
}

async function health(url: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) })
  if (!response.ok) throw new Error(`CoreDNS health check returned HTTP ${response.status}`)
}

async function replaceSymlink(target: string, link: string): Promise<void> {
  const temp = `${link}.next`
  await fs.rm(temp, { force: true })
  await fs.symlink(target, temp)
  await fs.rename(temp, link)
}

/**
 * Serialises DNS syncs within this Agent process.
 *
 * The poller runs on an interval, so a sync slower than that interval is still
 * running when the next poll starts. Two overlapping syncs interleave their
 * staging directories, `active` symlink swaps and listener addresses, and the
 * loser fails with "Address already assigned" — reproduced on a real node.
 *
 * Chaining rather than rejecting keeps the newest desired state applied: the
 * queued sync runs immediately after the current one finishes.
 */
let syncQueue: Promise<unknown> = Promise.resolve()

export function handleSyncGroupDns(
  payload: Record<string, unknown>,
  driver: VpnDriver,
  env: AgentEnv,
): Promise<Record<string, unknown>> {
  const run = syncQueue.then(
    () => applySyncGroupDns(payload, driver, env),
    () => applySyncGroupDns(payload, driver, env),
  )
  // Swallow rejection on the queue itself so one failure cannot reject the next
  // caller; the real result is still returned to this caller.
  syncQueue = run.catch(() => undefined)
  return run
}

async function applySyncGroupDns(
  payload: Record<string, unknown>,
  _driver: VpnDriver,
  env: AgentEnv,
): Promise<Record<string, unknown>> {
  if (!env.DNS_ENABLED) throw new Error('Managed DNS is disabled on this Agent')
  const validated = validateTaskPayload('sync_group_dns', payload)
  if (!validated.ok) throw new Error(validated.error)
  const { revision, config_hash, groups } = validated.payload as unknown as { revision: number; config_hash: string; groups: DnsGroup[] }
  if (groups.length === 0) throw new Error('Managed DNS sync has no enabled groups')

  const root = path.resolve(env.COREDNS_CONFIG_DIR)
  const revisions = path.join(root, 'revisions')
  const revisionDir = path.join(revisions, String(revision))
  const staging = path.join(revisions, `.staging-${revision}`)
  const active = path.join(root, 'active')
  const rootCorefile = path.join(root, 'Corefile')
  const previous = await fs.readlink(active).catch(() => null)
  const previousCorefile = await fs.readFile(rootCorefile, 'utf8').catch(() => null)
  const previousListeners = await currentDnsListenerAddresses().catch(() => [])

  await fs.mkdir(revisions, { recursive: true })
  await fs.rm(staging, { recursive: true, force: true })
  await fs.mkdir(staging, { recursive: true })
  try {
    for (const group of groups) {
      const zoneDir = path.join(staging, 'groups', group.id, 'zones')
      await fs.mkdir(zoneDir, { recursive: true })
      for (const zone of group.zones) {
        await fs.writeFile(path.join(zoneDir, `${zone.name}.db`), zoneFile(zone), { mode: 0o644 })
      }
      // Preserve policy desired state for the next enforcement step without
      // accepting any executable CoreDNS directives from the Manager.
      await fs.writeFile(path.join(staging, 'groups', group.id, 'policies.json'), JSON.stringify(group.policies), { mode: 0o600 })
    }
    const generatedCorefile = corefile(groups)
    await fs.writeFile(path.join(staging, 'Corefile'), generatedCorefile, { mode: 0o644 })
    await fs.rm(revisionDir, { recursive: true, force: true })
    await fs.rename(staging, revisionDir)

    // The listener addresses must exist before CoreDNS reads the new Corefile.
    // A group listener sits inside the VPN pool but is never assigned to a
    // client, so without this CoreDNS fails with
    // "bind: cannot assign requested address" and the container exits.
    await ensureDnsListenerAddresses(groups.map((group) => group.listener_ip))

    await replaceSymlink(`revisions/${revision}`, active)
    await fs.writeFile(`${rootCorefile}.next`, generatedCorefile, { mode: 0o644 })
    await fs.rename(`${rootCorefile}.next`, rootCorefile)

    // CoreDNS reload checks its Corefile every two seconds. Wait for the first
    // reload window before accepting the new revision as healthy.
    await new Promise((resolve) => setTimeout(resolve, 2_500))
    await health(env.COREDNS_HEALTH_URL)
    await applyManagedDnsFirewall(groups, String(payload['firewall_engine'] ?? env.FIREWALL_ENGINE), String(payload['vpn_type'] ?? env.VPN_TYPE), env.DNS_BLOCK_DOT)
  } catch (error) {
    if (previous) await replaceSymlink(previous, active).catch(() => undefined)
    else await fs.rm(active, { force: true }).catch(() => undefined)
    if (previousCorefile !== null) await fs.writeFile(rootCorefile, previousCorefile, { mode: 0o644 }).catch(() => undefined)
    else await fs.rm(rootCorefile, { force: true }).catch(() => undefined)
    // Restore the listener set that belonged to the revision being rolled back
    // to, so a failed sync never leaves an address the config no longer uses.
    await ensureDnsListenerAddresses(previousListeners).catch(() => undefined)
    throw error
  }

  const entries = await fs.readdir(revisions, { withFileTypes: true })
  const old = entries.filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name)).map((entry) => Number(entry.name)).sort((a, b) => b - a).slice(6)
  await Promise.all(old.map((oldRevision) => fs.rm(path.join(revisions, String(oldRevision)), { recursive: true, force: true })))
  return { revision, config_hash, status: 'healthy', listeners: groups.map((group) => `${group.listener_ip}:${group.listener_port}`) }
}

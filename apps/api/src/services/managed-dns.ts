import crypto from 'node:crypto'
import { v7 as uuidv7 } from 'uuid'
import { validateTaskPayload } from '@vpn/shared'

function hash(value: unknown): string {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
}

export async function enqueueNodeDnsSync(app: any, nodeId: string): Promise<string | null> {
  const node = await app.db('vpn_nodes').where({ id: nodeId }).first()
  if (!node || !node.managed_dns_enabled) return null

  const settings = await app.db('group_node_dns_settings as s')
    .join('groups as g', 's.group_id', 'g.id')
    .where({ 's.node_id': nodeId, 's.enabled': true })
    .select('s.*', 'g.name as group_name')
    .orderBy('g.name')

  const groups = []
  for (const setting of settings) {
    if (!setting.listener_ip) continue
    const zones = await app.db('group_dns_zones as gz')
      .join('dns_zones as z', 'gz.zone_id', 'z.id')
      .where({ 'gz.group_id': setting.group_id, 'z.enabled': true })
      .select('z.id', 'z.name')
      .orderBy('z.name')
    const zonePayload = []
    for (const zone of zones) {
      const records = await app.db('dns_records')
        .where({ zone_id: zone.id, enabled: true })
        .select('name', 'type', 'value', 'ttl')
        .orderBy('name').orderBy('type').orderBy('value')
      zonePayload.push({ name: zone.name, records })
    }
    const policies = await app.db('dns_policies')
      .where({ group_id: setting.group_id, enabled: true })
      .select('domain_pattern', 'action', 'scope', 'priority', 'sinkhole_ipv4')
      .orderBy('priority', 'desc').orderBy('domain_pattern')
    groups.push({
      id: setting.group_id,
      name: setting.group_name,
      vpn_subnet: setting.vpn_subnet,
      listener_ip: setting.listener_ip,
      listener_port: setting.listener_port,
      public_default_action: setting.public_default_action,
      // Existing rows created before the default was added may be empty.
      upstreams: (() => {
        const configured = JSON.parse(setting.upstreams || '[]')
        return configured.length > 0 ? configured : ['1.1.1.1', '8.8.8.8']
      })(),
      zones: zonePayload,
      policies,
    })
  }

  const desired = { groups }
  const config_hash = hash(desired)

  const taskId = uuidv7()
  const queuedTaskId = await app.db.transaction(async (trx: any) => {
    // The revision must advance from the highest revision already *recorded*,
    // not from the node's applied revision. `dns_config_revision` only moves
    // when the Agent reports success, so deriving from it made a second
    // desired-state change before the first sync completes reuse the same
    // number and fail the unique constraint with an HTTP 500.
    //
    // Computed inside the transaction so two concurrent mutations cannot pick
    // the same revision.
    const pendingRevision = await trx('node_dns_revisions')
      .where({ node_id: nodeId, status: 'pending' })
      .whereNotNull('task_id')
      .orderBy('revision', 'desc')
      .first()

    // Coalesce rapid desired-state edits into the existing queue entry. This
    // avoids creating one revision per record form keystroke/import row while
    // the Agent has not started the task yet.
    if (pendingRevision?.task_id) {
      const payload = { revision: pendingRevision.revision, config_hash, ...desired }
      const validated = validateTaskPayload('sync_group_dns', payload)
      if (!validated.ok) throw new Error(validated.error)
      await trx('tasks').where({ id: pendingRevision.task_id, status: 'pending' }).update({
        payload: JSON.stringify(validated.payload),
        updated_at: new Date(),
      })
      await trx('node_dns_revisions').where({ id: pendingRevision.id }).update({
        config_hash,
        updated_at: new Date(),
      })
      await trx('vpn_nodes').where({ id: nodeId }).update({ dns_sync_status: 'pending', dns_last_sync_error: null })
      return pendingRevision.task_id as string
    }

    const highest = await trx('node_dns_revisions').where({ node_id: nodeId }).max('revision as max').first()
    // Applied revision acts as a floor in case old revision rows were pruned.
    const nextRevision = Math.max(Number(highest?.max || 0), Number(node.dns_config_revision || 0)) + 1

    const payload = { revision: nextRevision, config_hash, ...desired }
    const validated = validateTaskPayload('sync_group_dns', payload)
    if (!validated.ok) throw new Error(validated.error)

    await trx('tasks').insert({ id: taskId, node_id: nodeId, action: 'sync_group_dns', payload: JSON.stringify(validated.payload), status: 'pending', created_at: new Date() })
    await trx('node_dns_revisions').insert({ id: uuidv7(), node_id: nodeId, revision: nextRevision, config_hash, status: 'pending', task_id: taskId, created_at: new Date(), updated_at: new Date() })
    await trx('vpn_nodes').where({ id: nodeId }).update({ dns_sync_status: 'pending', dns_last_sync_error: null })
    return taskId
  })

  await pruneNodeDnsRevisions(app, nodeId)

  return queuedTaskId
}

/** Keeps the latest 100 terminal revisions per node; pending/applying rows stay. */
export async function pruneNodeDnsRevisions(app: any, nodeId?: string): Promise<void> {
  const nodeIds = nodeId
    ? [nodeId]
    : await app.db('node_dns_revisions').distinct('node_id').pluck('node_id') as string[]
  for (const id of nodeIds) {
    const terminal = await app.db('node_dns_revisions')
      .where({ node_id: id })
      .whereIn('status', ['healthy', 'failed', 'superseded', 'rolled_back'])
      .orderBy('revision', 'desc')
      .select('id')
    const staleIds = terminal.slice(100).map((row: { id: string }) => row.id)
    if (staleIds.length > 0) await app.db('node_dns_revisions').whereIn('id', staleIds).delete()
  }
}

export async function enqueueDnsSyncForGroups(app: any, groupIds: string[]): Promise<void> {
  if (groupIds.length === 0) return
  const nodes = await app.db('group_node_dns_settings as s')
    .join('vpn_nodes as n', 's.node_id', 'n.id')
    .whereIn('s.group_id', groupIds)
    .where({ 'n.managed_dns_enabled': true })
    .distinct('s.node_id')
    .pluck('s.node_id') as string[]
  for (const nodeId of nodes) await enqueueNodeDnsSync(app, nodeId)
}

import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('vpn_nodes', (table) => {
    table.string('id', 36).primary().notNullable()
    table.string('hostname', 255).notNullable()
    table.string('ip_address', 45).notNullable()
    table.integer('port').notNullable().defaultTo(1194)
    table.string('region', 100).nullable()
    table.string('token', 255).notNullable().unique()
    table.enu('status', ['online', 'offline']).notNullable().defaultTo('offline')
    table.string('version', 50).nullable()
    table.text('ca_cert').nullable()
    table.text('ta_key').nullable()
    table.timestamp('last_seen').nullable()
    table.string('protocol', 10).defaultTo('udp').comment('VPN protocol (udp/tcp)')
    table.string('tunnel_mode', 10).defaultTo('full').comment('Tunnel mode (full/split)')
    table.string('vpn_network', 18).defaultTo('10.8.0.0').comment('VPN network address')
    table.string('vpn_netmask', 15).defaultTo('255.255.255.0').comment('VPN network mask')
    table.string('dns_servers', 500).defaultTo('8.8.8.8,1.1.1.1').comment('DNS servers (comma-separated)')
    table.text('push_routes').nullable().comment('Custom routes for split tunnel (comma-separated)')
    table.string('cipher', 50).defaultTo('AES-128-GCM').comment('Encryption cipher')
    table.string('auth_digest', 20).defaultTo('SHA256').comment('Auth digest algorithm')
    table.string('compression', 20).defaultTo('lz4-v2').comment('Compression algorithm')
    table.integer('keepalive_ping').defaultTo(10).comment('Keepalive ping interval (seconds)')
    table.integer('keepalive_timeout').defaultTo(120).comment('Keepalive timeout (seconds)')
    table.integer('max_clients').defaultTo(100).comment('Maximum concurrent clients')
    table.text('custom_push_directives').nullable().comment('Custom push directives (one per line)')
    
    table.timestamps(true, true)
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('vpn_nodes')
}

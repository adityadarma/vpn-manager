import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('vpn_nodes', (table) => {
    table.text('wireguard_allowed_ips').nullable().comment('Additional WireGuard AllowedIPs for split tunnel (comma-separated)')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('vpn_nodes', (table) => {
    table.dropColumn('wireguard_allowed_ips')
  })
}

import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  const client = String(knex.client.config.client || '')
  if (client.includes('sqlite') || client.includes('pg')) {
    await knex.raw('DROP INDEX IF EXISTS idx_users_vpn_ip_unique')
  } else {
    await knex.schema.alterTable('users', (table) => {
      table.dropUnique(['vpn_ip'], 'idx_users_vpn_ip_unique')
    })
  }

  await knex.schema.alterTable('users', (table) => {
    table.dropForeign(['vpn_group_id'])
    table.dropColumn('vpn_ip')
    table.dropColumn('vpn_group_id')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('users', (table) => {
    table.string('vpn_ip', 45).nullable().defaultTo(null)
    table.string('vpn_group_id', 36).nullable().defaultTo(null)
    table.foreign('vpn_group_id').references('id').inTable('groups').onDelete('SET NULL')
  })

  const client = String(knex.client.config.client || '')
  if (client.includes('sqlite') || client.includes('pg')) {
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_vpn_ip_unique ON users(vpn_ip) WHERE vpn_ip IS NOT NULL')
  } else {
    await knex.schema.alterTable('users', (table) => {
      table.unique(['vpn_ip'], { indexName: 'idx_users_vpn_ip_unique' })
    })
  }
}

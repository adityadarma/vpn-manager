import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  const client = String(knex.client.config.client || '')

  if (client.includes('sqlite')) {
    // SQLite: create a unique index with a WHERE clause (partial index)
    await knex.raw(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_vpn_ip_unique ON users(vpn_ip) WHERE vpn_ip IS NOT NULL'
    )
  } else if (client.includes('pg')) {
    // PostgreSQL: partial unique index
    await knex.raw(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_vpn_ip_unique ON users(vpn_ip) WHERE vpn_ip IS NOT NULL'
    )
  } else {
    // MySQL: unique index (NULL values are ignored in MySQL unique indexes)
    await knex.schema.alterTable('users', (table) => {
      table.unique(['vpn_ip'], { indexName: 'idx_users_vpn_ip_unique' })
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  const client = String(knex.client.config.client || '')

  if (client.includes('sqlite') || client.includes('pg')) {
    await knex.raw('DROP INDEX IF EXISTS idx_users_vpn_ip_unique')
  } else {
    await knex.schema.alterTable('users', (table) => {
      table.dropIndex([], 'idx_users_vpn_ip_unique')
    })
  }
}

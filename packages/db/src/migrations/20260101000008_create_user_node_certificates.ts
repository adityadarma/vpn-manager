import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('user_node_certificates', (table) => {
    table.string('id', 36).primary().notNullable()
    table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE')
    table.string('node_id', 36).notNullable().references('id').inTable('vpn_nodes').onDelete('CASCADE')
    table.text('client_cert').nullable()
    table.text('client_key').nullable()
    table.boolean('password_protected').nullable().defaultTo(false)
    table.timestamp('generated_at').nullable()
    table.timestamp('expires_at').nullable()
    table.timestamp('last_downloaded_at').nullable()
    table.integer('download_count').nullable().defaultTo(0)
    table.boolean('is_revoked').nullable().defaultTo(false)
    table.timestamp('revoked_at').nullable()
    table.string('revoked_by', 36).nullable().references('id').inTable('users')
    table.string('revoke_reason', 255).nullable()
    table.string('credential_name', 100).notNullable().defaultTo('default')
    table.string('common_name', 32).nullable()
    table.string('vpn_ip', 45).nullable()
    table.string('group_id', 36).nullable().references('id').inTable('groups').onDelete('SET NULL')
    table.timestamp('last_vpn_connect').nullable()
    table.timestamps(true, true)
    table.unique(['node_id', 'common_name'], { indexName: 'idx_credential_node_common_name_unique' })
    table.index('user_id')
    table.index('node_id')
    table.index('is_revoked')
    table.index('expires_at')
  })

  const client = String(knex.client.config.client || '')
  if (client.includes('sqlite') || client.includes('pg')) {
    await knex.raw('CREATE UNIQUE INDEX idx_credential_node_vpn_ip_unique ON user_node_certificates(node_id, vpn_ip) WHERE vpn_ip IS NOT NULL')
  } else {
    await knex.schema.alterTable('user_node_certificates', (table) => {
      table.unique(['node_id', 'vpn_ip'], { indexName: 'idx_credential_node_vpn_ip_unique' })
    })
  }
}

export async function down(knex: Knex): Promise<void> { await knex.schema.dropTableIfExists('user_node_certificates') }

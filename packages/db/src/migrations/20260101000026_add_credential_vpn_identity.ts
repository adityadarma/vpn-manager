import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('user_node_certificates', (table) => {
    table.string('credential_name', 100).notNullable().defaultTo('default')
    table.string('common_name', 32).nullable()
    table.string('vpn_ip', 45).nullable()
    table.string('group_id', 36).nullable()
    table.foreign('group_id').references('id').inTable('groups').onDelete('SET NULL')
  })

  const certificates = await knex('user_node_certificates').select('id', 'user_id')
  for (const certificate of certificates) {
    const user = await knex('users').where({ id: certificate.user_id }).first('username', 'vpn_ip', 'vpn_group_id')
    await knex('user_node_certificates').where({ id: certificate.id }).update({
      common_name: user?.username ?? `legacy-${certificate.id.replace(/-/g, '').slice(-16)}`,
      vpn_ip: user?.vpn_ip ?? null,
      group_id: user?.vpn_group_id ?? null,
    })
  }

  await knex.schema.alterTable('user_node_certificates', (table) => {
    table.dropUnique(['user_id', 'node_id'])
    table.unique(['node_id', 'common_name'], { indexName: 'idx_credential_node_common_name_unique' })
  })

  const client = String(knex.client.config.client || '')
  if (client.includes('sqlite') || client.includes('pg')) {
    await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS idx_credential_node_vpn_ip_unique ON user_node_certificates(node_id, vpn_ip) WHERE vpn_ip IS NOT NULL')
  } else {
    await knex.schema.alterTable('user_node_certificates', (table) => {
      table.unique(['node_id', 'vpn_ip'], { indexName: 'idx_credential_node_vpn_ip_unique' })
    })
  }
}

export async function down(knex: Knex): Promise<void> {
  const client = String(knex.client.config.client || '')
  if (client.includes('sqlite') || client.includes('pg')) {
    await knex.raw('DROP INDEX IF EXISTS idx_credential_node_vpn_ip_unique')
  } else {
    await knex.schema.alterTable('user_node_certificates', (table) => {
      table.dropUnique(['node_id', 'vpn_ip'], 'idx_credential_node_vpn_ip_unique')
    })
  }

  await knex.schema.alterTable('user_node_certificates', (table) => {
    table.dropUnique(['node_id', 'common_name'], 'idx_credential_node_common_name_unique')
    table.unique(['user_id', 'node_id'])
    table.dropForeign(['group_id'])
    table.dropColumn('credential_name')
    table.dropColumn('common_name')
    table.dropColumn('vpn_ip')
    table.dropColumn('group_id')
  })
}

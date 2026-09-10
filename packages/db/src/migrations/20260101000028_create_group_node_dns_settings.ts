import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('group_node_dns_settings', (table) => {
    table.string('group_id', 36).notNullable()
    table.string('node_id', 36).notNullable()
    table.boolean('enabled').notNullable().defaultTo(false)
    table.string('vpn_subnet', 43).notNullable()
    table.string('listener_ip', 45).nullable()
    table.integer('listener_port').notNullable().defaultTo(53)
    table.string('public_default_action', 10).notNullable().defaultTo('allow')
    table.json('upstreams').notNullable()
    table.timestamps(true, true)

    table.primary(['group_id', 'node_id'])
    table.foreign('group_id').references('id').inTable('groups').onDelete('CASCADE')
    table.foreign('node_id').references('id').inTable('vpn_nodes').onDelete('CASCADE')
    table.unique(['node_id', 'listener_ip', 'listener_port'], { indexName: 'idx_group_node_dns_listener_unique' })
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('group_node_dns_settings')
}

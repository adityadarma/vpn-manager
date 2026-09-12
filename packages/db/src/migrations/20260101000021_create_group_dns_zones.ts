import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('group_dns_zones', (table) => {
    table.string('group_id', 36).notNullable().references('id').inTable('groups').onDelete('CASCADE')
    table.string('zone_id', 36).notNullable().references('id').inTable('dns_zones').onDelete('CASCADE')
    table.primary(['group_id', 'zone_id'])
    table.timestamps(true, true)
  })
}

export async function down(knex: Knex): Promise<void> { await knex.schema.dropTableIfExists('group_dns_zones') }

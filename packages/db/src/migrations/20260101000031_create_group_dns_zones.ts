import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('group_dns_zones', (table) => {
    table.string('group_id', 36).notNullable()
    table.string('zone_id', 36).notNullable()
    table.timestamps(true, true)
    table.primary(['group_id', 'zone_id'])
    table.foreign('group_id').references('id').inTable('groups').onDelete('CASCADE')
    table.foreign('zone_id').references('id').inTable('dns_zones').onDelete('CASCADE')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('group_dns_zones')
}

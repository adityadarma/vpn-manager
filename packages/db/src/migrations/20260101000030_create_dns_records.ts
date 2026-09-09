import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('dns_records', (table) => {
    table.string('id', 36).primary().notNullable()
    table.string('zone_id', 36).notNullable()
    table.string('name', 253).notNullable()
    table.string('type', 10).notNullable()
    table.string('value', 1024).notNullable()
    table.integer('ttl').notNullable().defaultTo(60)
    table.boolean('enabled').notNullable().defaultTo(true)
    table.timestamps(true, true)
    table.foreign('zone_id').references('id').inTable('dns_zones').onDelete('CASCADE')
    table.unique(['zone_id', 'name', 'type', 'value'], { indexName: 'idx_dns_records_unique_value' })
    table.index(['zone_id', 'enabled'], 'idx_dns_records_zone_enabled')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('dns_records')
}

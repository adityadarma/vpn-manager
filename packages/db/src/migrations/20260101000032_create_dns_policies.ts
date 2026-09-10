import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('dns_policies', (table) => {
    table.string('id', 36).primary().notNullable()
    table.string('group_id', 36).notNullable()
    table.string('domain_pattern', 253).notNullable()
    table.string('action', 10).notNullable()
    table.string('scope', 10).notNullable().defaultTo('any')
    table.integer('priority').notNullable().defaultTo(0)
    table.string('sinkhole_ipv4', 15).nullable()
    table.boolean('enabled').notNullable().defaultTo(true)
    table.timestamps(true, true)
    table.foreign('group_id').references('id').inTable('groups').onDelete('CASCADE')
    table.unique(['group_id', 'domain_pattern', 'scope'], { indexName: 'idx_dns_policies_group_pattern_scope_unique' })
    table.index(['group_id', 'enabled', 'priority'], 'idx_dns_policies_group_enabled_priority')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('dns_policies')
}

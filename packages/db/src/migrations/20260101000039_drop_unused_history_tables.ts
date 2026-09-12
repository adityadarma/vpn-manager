import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('node_config_history')
  await knex.schema.dropTableIfExists('cert_download_history')
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.createTable('node_config_history', (table) => {
    table.string('id', 36).primary().notNullable()
    table.string('node_id', 36).notNullable()
    table.foreign('node_id').references('id').inTable('vpn_nodes').onDelete('CASCADE')
    table.string('changed_by', 36).nullable()
    table.foreign('changed_by').references('id').inTable('users')
    table.text('old_config').nullable()
    table.text('new_config').notNullable()
    table.text('change_summary').nullable()
    table.timestamps(true, true)
    table.index(['node_id', 'changed_by', 'created_at'])
  })

  await knex.schema.createTable('cert_download_history', (table) => {
    table.string('id', 36).primary().notNullable()
    table.string('user_id', 36).notNullable()
    table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE')
    table.string('node_id', 36).notNullable()
    table.foreign('node_id').references('id').inTable('vpn_nodes').onDelete('CASCADE')
    table.string('ip_address', 45).nullable()
    table.string('user_agent', 500).nullable()
    table.timestamp('downloaded_at').notNullable().defaultTo(knex.fn.now())
    table.timestamps(true, true)
    table.index(['user_id', 'downloaded_at'])
  })
}

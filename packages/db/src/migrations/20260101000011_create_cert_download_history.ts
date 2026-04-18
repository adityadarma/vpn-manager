import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('cert_download_history', (table) => {
    table.string('id', 36).primary().notNullable()
    table.string('user_id', 36).notNullable()
    table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE')
    table.string('node_id', 36).notNullable()
    table.foreign('node_id').references('id').inTable('vpn_nodes').onDelete('CASCADE')
    table.string('ip_address', 45).nullable().comment('IP address of downloader')
    table.string('user_agent', 500).nullable().comment('Browser user agent')
    table.timestamp('downloaded_at').notNullable().defaultTo(knex.fn.now())
    table.timestamps(true, true)
    
    table.index(['user_id', 'downloaded_at'])
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('cert_download_history')
}

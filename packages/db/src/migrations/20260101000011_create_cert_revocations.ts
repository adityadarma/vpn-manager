import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('cert_revocations', (table) => {
    table.string('id', 36).primary().notNullable()
    table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE')
    table.string('node_id', 36).notNullable().references('id').inTable('vpn_nodes').onDelete('CASCADE')
    table.text('revoked_cert').notNullable()
    table.string('serial_number', 100).nullable()
    table.string('reason', 100).nullable()
    table.string('revoked_by', 36).nullable().references('id').inTable('users')
    table.timestamp('revoked_at').notNullable().defaultTo(knex.fn.now())
    table.timestamps(true, true)
    table.index(['user_id', 'revoked_at'])
    table.index(['node_id', 'revoked_at'])
  })
}

export async function down(knex: Knex): Promise<void> { await knex.schema.dropTableIfExists('cert_revocations') }

import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('cert_revocations', (table) => {
    table.string('id', 36).primary().notNullable()
    table.string('user_id', 36).notNullable()
    table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE')
    table.string('node_id', 36).notNullable()
    table.foreign('node_id').references('id').inTable('vpn_nodes').onDelete('CASCADE')
    table.text('revoked_cert').notNullable().comment('Revoked certificate (PEM format)')
    table.string('serial_number', 100).nullable().comment('Certificate serial number')
    table.string('reason', 100).nullable().comment('Revocation reason')
    table.string('revoked_by', 36).nullable()
    table.foreign('revoked_by').references('id').inTable('users')
    table.timestamp('revoked_at').notNullable().defaultTo(knex.fn.now())
    table.timestamps(true, true)
    
    table.index(['user_id', 'revoked_at'])
    table.index(['node_id', 'revoked_at'])
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('cert_revocations')
}

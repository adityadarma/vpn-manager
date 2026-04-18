import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('user_node_certificates', (table) => {
    table.string('id', 36).primary().notNullable()
    table.string('user_id', 36).notNullable()
    table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE')
    table.string('node_id', 36).notNullable()
    table.foreign('node_id').references('id').inTable('vpn_nodes').onDelete('CASCADE')
    table.text('client_cert').nullable().comment('Client certificate (PEM format)')
    table.text('client_key').nullable().comment('Client private key (PEM format)')
    table.boolean('password_protected').defaultTo(false).comment('Whether private key is password protected')
    table.timestamp('generated_at').nullable().comment('When certificate was generated')
    table.timestamp('expires_at').nullable().comment('Certificate expiration date (null = unlimited)')
    table.timestamp('last_downloaded_at').nullable().comment('Last time config was downloaded')
    table.integer('download_count').defaultTo(0).comment('Number of times config was downloaded')
    table.boolean('is_revoked').defaultTo(false).comment('Whether certificate is revoked')
    table.timestamp('revoked_at').nullable().comment('When certificate was revoked')
    table.string('revoked_by', 36).nullable().comment('User who revoked the certificate')
    table.foreign('revoked_by').references('id').inTable('users')
    table.string('revoke_reason', 255).nullable().comment('Reason for revocation')
    table.timestamps(true, true)

    table.unique(['user_id', 'node_id'])
    table.index('user_id')
    table.index('node_id')
    table.index('is_revoked')
    table.index('expires_at')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('user_node_certificates')
}
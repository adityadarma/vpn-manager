import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('revoked_tokens', (table) => {
    table.string('token_hash', 64).primary().notNullable()
    table.string('user_id', 36).nullable()
    table.timestamp('expires_at').notNullable()
    table.timestamp('revoked_at').notNullable().defaultTo(knex.fn.now())

    table.index(['expires_at'], 'idx_revoked_tokens_expires_at')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('revoked_tokens')
}

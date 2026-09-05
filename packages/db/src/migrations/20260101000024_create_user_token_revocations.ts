import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('user_token_revocations', (table) => {
    table.string('user_id', 36).primary().notNullable()
    table.timestamp('revoked_at').notNullable().defaultTo(knex.fn.now())
    table.timestamp('expires_at').notNullable()

    table.index(['expires_at'], 'idx_user_token_revocations_expires_at')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('user_token_revocations')
}

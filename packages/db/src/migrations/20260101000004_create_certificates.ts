import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('certificates', (table) => {
    table.string('id', 36).primary().notNullable()
    table.string('user_id', 36).notNullable()
    table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE')
    table.string('cert_path', 512).notNullable()
    table.string('serial_number', 255).nullable()
    table.boolean('revoked').notNullable().defaultTo(false)
    table.timestamp('expires_at').nullable()
    table.timestamps(true, true)
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('certificates')
}

import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('users', (table) => {
    table.string('id', 36).primary().notNullable()
    table.string('username', 64).notNullable().unique()
    table.string('email', 255).nullable()
    table.string('password', 255).nullable()
    table.enu('role', ['admin', 'user']).notNullable().defaultTo('user')
    table.boolean('is_active').notNullable().defaultTo(true)
    table.timestamp('valid_from').nullable()
    table.timestamp('valid_to').nullable()
    table.timestamp('last_login').nullable()
    table.timestamps(true, true)
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('users')
}

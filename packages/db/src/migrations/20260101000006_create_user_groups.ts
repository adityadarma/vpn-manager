import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('user_groups', (table) => {
    table.string('user_id', 36).notNullable().references('id').inTable('users').onDelete('CASCADE')
    table.string('group_id', 36).notNullable().references('id').inTable('groups').onDelete('CASCADE')
    table.primary(['user_id', 'group_id'])
    table.timestamps(true, true)
  })
}

export async function down(knex: Knex): Promise<void> { await knex.schema.dropTableIfExists('user_groups') }

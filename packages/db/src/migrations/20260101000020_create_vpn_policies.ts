import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('vpn_policies', (table) => {
    table.string('id', 36).primary().notNullable()
    table.string('user_id', 36).nullable()
    table.string('group_id', 36).nullable()
    table.string('node_id', 36).nullable()

    table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE')
    table.foreign('group_id').references('id').inTable('groups').onDelete('CASCADE')
    table.foreign('node_id').references('id').inTable('vpn_nodes').onDelete('CASCADE')

    table.string('target_network', 50).notNullable()
    table.string('protocol', 10).notNullable().defaultTo('all')
    table.string('target_port', 50).nullable().defaultTo(null)
    
    table.enu('action', ['allow', 'deny']).notNullable().defaultTo('allow')
    table.integer('priority').notNullable().defaultTo(100)
    table.text('description').nullable()
    table.timestamps(true, true)
    
    // Constraint: Can't have both user and group target. (But both can be null for Global policy)
    table.check('(user_id IS NULL OR group_id IS NULL)', [], 'chk_policy_target')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('vpn_policies')
}

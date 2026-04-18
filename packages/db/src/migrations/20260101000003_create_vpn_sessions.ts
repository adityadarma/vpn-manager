import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('vpn_sessions', (table) => {
    table.string('id', 36).primary().notNullable()
    table.string('user_id', 36).notNullable()
    table.foreign('user_id').references('id').inTable('users').onDelete('CASCADE')
    table.string('node_id', 36).notNullable()
    table.foreign('node_id').references('id').inTable('vpn_nodes').onDelete('CASCADE')
    table.string('vpn_ip', 45).notNullable()
    table.string('real_ip', 45).nullable()
    table.bigInteger('bytes_sent').notNullable().defaultTo(0)
    table.bigInteger('bytes_received').notNullable().defaultTo(0)
    table.timestamp('connected_at').notNullable().defaultTo(knex.fn.now())
    table.timestamp('disconnected_at').nullable()
    table.timestamp('last_activity_at').nullable()
    table.string('disconnect_reason', 50).nullable().comment('normal, timeout, error, admin_kick, cert_revoked, reconnect')
    table.string('client_version', 100).nullable()
    table.string('device_name', 255).nullable()
    table.string('geo_country', 2).nullable().comment('ISO country code')
    table.string('geo_city', 100).nullable()
    table.integer('connection_duration_seconds').nullable().comment('Calculated on disconnect')
    table.timestamps(true, true)
    
    table.index(['user_id', 'connected_at'])
    table.index(['node_id', 'connected_at'])
    table.index(['disconnected_at'])
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('vpn_sessions')
}

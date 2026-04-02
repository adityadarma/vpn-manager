import type { Knex } from 'knex'
import bcrypt from 'bcryptjs'
import { v7 as uuidv7 } from 'uuid'

export async function seed(knex: Knex): Promise<void> {
  // Check if admin user already exists
  const existingAdmin = await knex('users')
    .where({ username: 'admin' })
    .first()

  if (!existingAdmin) {
    // Create default admin user
    const passwordHash = await bcrypt.hash('Admin@1234!', 10)
    await knex('users').insert({
      id: uuidv7(),
      username: 'admin',
      email: 'admin@vpn.local',
      password: passwordHash,
      role: 'admin',
      is_active: true,
    })
    console.log('✅ Admin user created (username: admin, password: Admin@1234!)')
    console.log('⚠️  Change the admin password immediately after first login!')
  }
}

import type { Knex } from 'knex'
import bcrypt from 'bcryptjs'
import { v7 as uuidv7 } from 'uuid'
import { randomBytes } from 'node:crypto'

/**
 * Generate a strong random password (no ambiguous chars).
 * Used when ADMIN_PASSWORD is not provided via environment.
 */
function generatePassword(length = 20): string {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*'
  const bytes = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) {
    out += charset[bytes[i] % charset.length]
  }
  return out
}

export async function seed(knex: Knex): Promise<void> {
  // Check if admin user already exists
  const existingAdmin = await knex('users')
    .where({ username: 'admin' })
    .first()

  if (!existingAdmin) {
    // Resolve admin password: prefer ADMIN_PASSWORD env, otherwise generate a
    // strong random one. Never ship a fixed, publicly-known default credential.
    const envPassword = process.env.ADMIN_PASSWORD?.trim()
    const generated = !envPassword
    const adminPassword = envPassword || generatePassword()

    const passwordHash = await bcrypt.hash(adminPassword, 10)
    await knex('users').insert({
      id: uuidv7(),
      username: 'admin',
      email: 'admin@vpn.local',
      password: passwordHash,
      role: 'admin',
      is_active: true,
    })

    console.log('✅ Admin user created (username: admin)')
    if (generated) {
      console.log('============================================================')
      console.log('  GENERATED ADMIN PASSWORD (shown once — save it now):')
      console.log(`  ${adminPassword}`)
      console.log('============================================================')
    } else {
      console.log('   Admin password set from ADMIN_PASSWORD environment variable.')
    }
    console.log('⚠️  Change the admin password immediately after first login!')
  }
}

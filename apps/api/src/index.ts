import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

// Load .env from monorepo root (walk up from apps/api/src/)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../../.env'), quiet: true })

import { buildApp } from './app'
import { loadEnv } from './config/env'
import { applyPendingDatabaseRestore } from '@vpn/db'

async function main() {
  const env = loadEnv()
  const restored = applyPendingDatabaseRestore()
  if (restored) console.log('Applied pending database restore')

  console.log('🚀 VPN API starting...')
  console.log(`   Port: ${env.PORT}`)
  console.log(`   Host: ${env.HOST}`)
  console.log(`   Environment: ${env.NODE_ENV}`)

  const app = await buildApp(env)
  if (restored) {
    await app.db.migrate.latest()
    console.log('Migrated restored database to the current schema')
  }

  try {
    await app.listen({ port: env.PORT, host: env.HOST })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

main()

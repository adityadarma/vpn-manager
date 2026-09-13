import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

// Load .env from monorepo root (walk up from apps/api/src/)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../../.env'), quiet: true })

import { buildApp } from './app'
import { loadEnv } from './config/env'

async function main() {
  const env = loadEnv()

  console.log('🚀 VPN API starting...')
  console.log(`   Port: ${env.PORT}`)
  console.log(`   Host: ${env.HOST}`)
  console.log(`   Environment: ${env.NODE_ENV}`)

  const app = await buildApp(env)

  try {
    await app.listen({ port: env.PORT, host: env.HOST })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

main()

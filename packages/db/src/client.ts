import knex, { type Knex } from 'knex'
import path from 'path'
import { fileURLToPath } from 'node:url'
import fs from 'fs'

export interface DbConfig {
  inMemory?: boolean
}

// Resolve the monorepo root/data directory regardless of CWD
// packages/db/src/client.ts  →  go up 3 levels to reach monorepo root
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MONOREPO_ROOT = path.resolve(__dirname, '../../..') // packages/db/src → root
const DEFAULT_SQLITE_PATH = path.join(MONOREPO_ROOT, 'data', 'vpn.sqlite')

let _db: Knex | null = null

export function createDb(config: DbConfig): Knex {
  if (_db) return _db

  const TS_EXTENSIONS = {
    directory: path.join(__dirname, 'migrations'),
    extension: 'ts',
    loadExtensions: ['.ts'],
  }

  const TS_SEEDS = {
    directory: path.join(__dirname, 'seeds'),
    extension: 'ts',
    loadExtensions: ['.ts'],
  }

  // Production mounts /data; local development keeps the database in the repo.
  // Tests use an isolated in-memory database without an environment override.
  const sqlitePath = config.inMemory ? ':memory:' : (fs.existsSync('/data') ? '/data/vpn.sqlite' : DEFAULT_SQLITE_PATH)
  if (!config.inMemory) fs.mkdirSync(path.dirname(sqlitePath), { recursive: true })
  const knexConfig: Knex.Config = {
    client: 'better-sqlite3',
    connection: { filename: sqlitePath },
    useNullAsDefault: true,
    migrations: TS_EXTENSIONS,
    seeds: TS_SEEDS,
  }

  _db = knex(knexConfig)
  return _db
}

export function getDb(): Knex {
  if (!_db) {
    throw new Error('Database not initialized. Call createDb() first.')
  }
  return _db
}

export async function closeDb(): Promise<void> {
  if (_db) {
    await _db.destroy()
    _db = null
  }
}

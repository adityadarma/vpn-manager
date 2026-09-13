import type { Knex } from 'knex'
import { fileURLToPath } from 'node:url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const MONOREPO_ROOT = path.resolve(__dirname, '../../..')

const SQLITE_FILE = path.join(MONOREPO_ROOT, 'data', 'vpn.sqlite')

const MIGRATIONS_DIR = path.join(__dirname, 'migrations')
const SEEDS_DIR = path.join(__dirname, 'seeds')

const TS_EXTENSIONS: Knex.MigratorConfig = {
  directory: MIGRATIONS_DIR,
  extension: 'ts',
  loadExtensions: ['.ts'],
}

const TS_SEEDS: Knex.SeederConfig = {
  directory: SEEDS_DIR,
  extension: 'ts',
  loadExtensions: ['.ts'],
}

const config: { [key: string]: Knex.Config } = {
  development: {
    client: 'better-sqlite3',
    connection: { filename: SQLITE_FILE },
    useNullAsDefault: true,
    migrations: TS_EXTENSIONS,
    seeds: TS_SEEDS,
  },

  test: {
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    migrations: TS_EXTENSIONS,
  },

  production: {
    client: 'better-sqlite3',
    connection: { filename: SQLITE_FILE },
    useNullAsDefault: true,
    migrations: TS_EXTENSIONS,
    seeds: TS_SEEDS,
  },

}

export default config

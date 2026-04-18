import type { Knex } from 'knex'
import { fileURLToPath } from 'url'
import path from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// packages/db/src/ → go up 3 levels to reach monorepo root
const MONOREPO_ROOT = path.resolve(__dirname, '../../..')

const DATA_DIR = process.env['DATABASE_SQLITE_PATH']
  ? path.dirname(process.env['DATABASE_SQLITE_PATH'])
  : path.join(MONOREPO_ROOT, 'data')

const SQLITE_FILE = process.env['DATABASE_SQLITE_PATH'] ?? path.join(MONOREPO_ROOT, 'data', 'vpn.sqlite')

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

  production: (() => {
    const dbType = process.env['DATABASE_TYPE'] ?? 'sqlite'
    if (dbType === 'postgres') {
      return {
        client: 'pg',
        connection: process.env['DATABASE_URL'],
        pool: { min: 2, max: 10 },
        migrations: TS_EXTENSIONS,
        seeds: TS_SEEDS,
      }
    } else if (dbType === 'mysql') {
      return {
        client: 'mysql2',
        connection: process.env['DATABASE_URL'],
        pool: { min: 2, max: 10 },
        migrations: TS_EXTENSIONS,
        seeds: TS_SEEDS,
      }
    } else {
      return {
        client: 'better-sqlite3',
        connection: { filename: SQLITE_FILE },
        useNullAsDefault: true,
        migrations: TS_EXTENSIONS,
        seeds: TS_SEEDS,
      }
    }
  })(),

}

export default config

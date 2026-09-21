import Database from 'better-sqlite3'
import type { Knex } from 'knex'
import fs from 'node:fs'
import path from 'node:path'
import { getDbPath } from './client'

const REQUIRED_TABLES = ['users', 'vpn_nodes', 'tasks', 'vpn_sessions', 'knex_migrations']

export function getBackupDirectory(): string {
  return path.join(path.dirname(getDbPath()), 'backups')
}

export async function createDatabaseBackup(db: Knex, destination: string): Promise<void> {
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 })
  const connection = (await db.client.acquireConnection()) as Database.Database
  try {
    await connection.backup(destination)
    fs.chmodSync(destination, 0o600)
  } finally {
    await db.client.releaseConnection(connection)
  }
}

export function validateDatabaseFile(filename: string): {
  migrations: number
  latestMigration: string | null
} {
  const stat = fs.statSync(filename)
  if (!stat.isFile() || stat.size < 100) throw new Error('Backup is empty or invalid')
  const db = new Database(filename, { readonly: true, fileMustExist: true })
  try {
    const integrity = db.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity}`)
    const tables = new Set(
      (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
          name: string
        }>
      ).map((row) => row.name),
    )
    const missing = REQUIRED_TABLES.filter((table) => !tables.has(table))
    if (missing.length) throw new Error(`Backup is missing required tables: ${missing.join(', ')}`)
    const migrations = Number(
      (db.prepare('SELECT COUNT(*) AS count FROM knex_migrations').get() as { count: number })
        .count,
    )
    const latestMigration =
      (
        db.prepare('SELECT name FROM knex_migrations ORDER BY id DESC LIMIT 1').get() as
          { name: string } | undefined
      )?.name ?? null
    return { migrations, latestMigration }
  } finally {
    db.close()
  }
}

export function applyPendingDatabaseRestore(): boolean {
  const dbPath = getDbPath()
  const marker = path.join(path.dirname(dbPath), '.restore-pending.json')
  if (!fs.existsSync(marker)) return false
  const pending = JSON.parse(fs.readFileSync(marker, 'utf8')) as { stagedPath: string }
  validateDatabaseFile(pending.stagedPath)
  const replaced = `${dbPath}.pre-restore-${Date.now()}`
  if (fs.existsSync(dbPath)) fs.renameSync(dbPath, replaced)
  try {
    fs.renameSync(pending.stagedPath, dbPath)
    fs.chmodSync(dbPath, 0o600)
    fs.rmSync(marker, { force: true })
    return true
  } catch (error) {
    if (!fs.existsSync(dbPath) && fs.existsSync(replaced)) fs.renameSync(replaced, dbPath)
    throw error
  }
}

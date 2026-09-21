import { createDatabaseBackup, getBackupDirectory, getDbPath, validateDatabaseFile } from '@vpn/db'
import type { Knex } from 'knex'
import fs from 'node:fs'
import path from 'node:path'

const BACKUP_PATTERN = /^vpn-manager-\d{8}-\d{6}\.sqlite$/

function backupName(date = new Date()): string {
  const stamp = date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  return `vpn-manager-${stamp}.sqlite`
}

export function listDatabaseBackups(): Array<{ name: string; size: number; createdAt: string }> {
  const directory = getBackupDirectory()
  if (!fs.existsSync(directory)) return []
  return fs
    .readdirSync(directory)
    .filter((name) => BACKUP_PATTERN.test(name))
    .map((name) => {
      const stat = fs.statSync(path.join(directory, name))
      return { name, size: stat.size, createdAt: stat.mtime.toISOString() }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function resolveBackup(name: string): string {
  if (!BACKUP_PATTERN.test(name)) throw new Error('Invalid backup name')
  const filename = path.join(getBackupDirectory(), name)
  if (!fs.existsSync(filename)) throw new Error('Backup not found')
  return filename
}

export function deleteBackup(name: string): void {
  fs.rmSync(resolveBackup(name))
}

export async function createBackup(
  db: Knex,
): Promise<{ name: string; size: number; createdAt: string }> {
  const name = backupName()
  const filename = path.join(getBackupDirectory(), name)
  await createDatabaseBackup(db, filename)
  validateDatabaseFile(filename)
  const stat = fs.statSync(filename)
  return { name, size: stat.size, createdAt: stat.mtime.toISOString() }
}

export async function stageRestore(db: Knex, body: Buffer): Promise<{ safetyBackup: string }> {
  if (body.length < 100) throw new Error('Uploaded backup is empty or invalid')
  const dbDirectory = path.dirname(getDbPath())
  fs.mkdirSync(dbDirectory, { recursive: true, mode: 0o700 })
  const stagedPath = path.join(dbDirectory, `.restore-staged-${Date.now()}.sqlite`)
  fs.writeFileSync(stagedPath, body, { mode: 0o600 })
  try {
    const uploaded = validateDatabaseFile(stagedPath)
    const current = await db('knex_migrations').orderBy('id', 'desc').select('name').first()
    if (uploaded.latestMigration && current?.name && uploaded.latestMigration > current.name) {
      throw new Error('Backup was created by a newer VPN Manager version')
    }
    const safetyBackup = await createBackup(db)
    const marker = path.join(dbDirectory, '.restore-pending.json')
    fs.writeFileSync(
      marker,
      JSON.stringify({ stagedPath, requestedAt: new Date().toISOString() }),
      {
        mode: 0o600,
      },
    )
    return { safetyBackup: safetyBackup.name }
  } catch (error) {
    fs.rmSync(stagedPath, { force: true })
    throw error
  }
}

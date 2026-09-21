import fs from 'node:fs'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import {
  createBackup,
  deleteBackup,
  listDatabaseBackups,
  resolveBackup,
  stageRestore,
} from '../../services/database-backup'
import { DataRetentionWorker } from '../../services/data-retention'
import { getClientIp, logAudit } from '../../utils/audit'

const RetentionSchema = z.object({
  session_retention_days: z.number().int().min(7).max(3650).nullable(),
  task_retention_days: z.number().int().min(7).max(3650).nullable(),
  audit_retention_days: z.number().int().min(30).max(3650).nullable(),
  alert_retention_days: z.number().int().min(7).max(3650).nullable(),
  delivery_retention_days: z.number().int().min(7).max(3650).nullable(),
  dns_revision_retention_days: z.number().int().min(7).max(3650).nullable(),
})

const settingsRoutes: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser(
    'application/vnd.sqlite3',
    { parseAs: 'buffer', bodyLimit: 100 * 1024 * 1024 },
    (_request, body, done) => done(null, body),
  )

  app.get('/settings', { onRequest: [app.authenticateAdmin] }, async () => {
    const settings = await app.db('system_settings').where({ id: 'system' }).first()
    return { settings }
  })

  app.patch('/settings/retention', { onRequest: [app.authenticateAdmin] }, async (request) => {
    const input = RetentionSchema.parse(request.body)
    const user = request.user as { id: string; name?: string; email?: string }
    await app
      .db('system_settings')
      .where({ id: 'system' })
      .update({ ...input, updated_by: user.id, updated_at: new Date() })
    await logAudit(app, {
      userId: user.id,
      username: user.name ?? user.email ?? 'admin',
      action: 'update_data_retention',
      resourceType: 'settings',
      resourceId: 'system',
      ipAddress: getClientIp(request),
      metadata: input,
    })
    return { ok: true }
  })

  app.get('/settings/retention/preview', { onRequest: [app.authenticateAdmin] }, async () => ({
    preview: await new DataRetentionWorker(app.db).preview(),
  }))

  app.post(
    '/settings/retention/cleanup',
    { onRequest: [app.authenticateAdmin] },
    async (request) => {
      const result = await new DataRetentionWorker(app.db).runOnce()
      const user = request.user as { id: string; name?: string; email?: string }
      await logAudit(app, {
        userId: user.id,
        username: user.name ?? user.email ?? 'admin',
        action: 'run_data_retention',
        resourceType: 'settings',
        resourceId: 'system',
        ipAddress: getClientIp(request),
        metadata: result,
      })
      return { result }
    },
  )

  app.get('/settings/backups', { onRequest: [app.authenticateAdmin] }, async () => ({
    backups: listDatabaseBackups(),
  }))

  app.post('/settings/backups', { onRequest: [app.authenticateAdmin] }, async (request, reply) => {
    const backup = await createBackup(app.db)
    const user = request.user as { id: string; name?: string; email?: string }
    await logAudit(app, {
      userId: user.id,
      username: user.name ?? user.email ?? 'admin',
      action: 'create_database_backup',
      resourceType: 'settings',
      resourceId: backup.name,
      ipAddress: getClientIp(request),
    })
    return reply.status(201).send({ backup })
  })

  app.get<{ Params: { name: string } }>(
    '/settings/backups/:name/download',
    { onRequest: [app.authenticateAdmin] },
    async (request, reply) => {
      try {
        const filename = resolveBackup(request.params.name)
        const user = request.user as { id: string; name?: string; email?: string }
        await logAudit(app, {
          userId: user.id,
          username: user.name ?? user.email ?? 'admin',
          action: 'download_database_backup',
          resourceType: 'settings',
          resourceId: request.params.name,
          ipAddress: getClientIp(request),
        })
        return reply
          .header('Cache-Control', 'no-store')
          .header('Content-Disposition', `attachment; filename="${request.params.name}"`)
          .type('application/vnd.sqlite3')
          .send(fs.createReadStream(filename))
      } catch (error) {
        return reply.status(404).send({ error: 'Not Found', message: (error as Error).message })
      }
    },
  )

  app.delete<{ Params: { name: string } }>(
    '/settings/backups/:name',
    { onRequest: [app.authenticateAdmin] },
    async (request, reply) => {
      try {
        deleteBackup(request.params.name)
        const user = request.user as { id: string; name?: string; email?: string }
        await logAudit(app, {
          userId: user.id,
          username: user.name ?? user.email ?? 'admin',
          action: 'delete_database_backup',
          resourceType: 'settings',
          resourceId: request.params.name,
          ipAddress: getClientIp(request),
        })
        return reply.status(204).send()
      } catch (error) {
        return reply.status(404).send({ error: 'Not Found', message: (error as Error).message })
      }
    },
  )

  app.post('/settings/restore', { onRequest: [app.authenticateAdmin] }, async (request, reply) => {
    if (!Buffer.isBuffer(request.body))
      return reply.status(415).send({
        error: 'Unsupported Media Type',
        message: 'Upload a SQLite backup as application/vnd.sqlite3',
      })
    try {
      const staged = await stageRestore(app.db, request.body)
      const user = request.user as { id: string; name?: string; email?: string }
      await logAudit(app, {
        userId: user.id,
        username: user.name ?? user.email ?? 'admin',
        action: 'stage_database_restore',
        resourceType: 'settings',
        resourceId: 'system',
        ipAddress: getClientIp(request),
        metadata: { safety_backup: staged.safetyBackup },
      })
      return reply
        .status(202)
        .send({ status: 'pending_restart', safety_backup: staged.safetyBackup })
    } catch (error) {
      return reply.status(400).send({ error: 'Invalid Backup', message: (error as Error).message })
    }
  })
}

export default settingsRoutes

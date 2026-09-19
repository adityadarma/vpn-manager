import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEnv } from '../src/config/env'
import {
  flushSpooledResults,
  reportTaskResult,
  startResultFlusher,
} from '../src/core/task-result-reporter'

/**
 * Reporting used to be fire-and-forget: one fetch, and any failure was logged
 * and dropped. The work was already done, so a lost report left the task
 * 'running' on the manager until the stale-task reaper timed it out.
 */
describe('task result reporter', () => {
  let spoolDir: string
  /** Redirects the spool away from the real /var/lib path. */
  let opts: { spoolDir: string }
  let env: AgentEnv
  let fetchMock: ReturnType<typeof vi.fn>

  /** Matches MAX_ATTEMPTS in the reporter. */
  const MAX_ATTEMPTS = 4

  const spooledFiles = () => fs.readdir(spoolDir).catch(() => [] as string[])

  const readSpooled = async (taskId: string) =>
    JSON.parse(await fs.readFile(path.join(spoolDir, `${taskId}.json`), 'utf8'))

  beforeEach(async () => {
    spoolDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vpn-agent-spool-'))
    opts = { spoolDir }
    env = {
      AGENT_MANAGER_URL: 'https://manager.example.test',
      AGENT_SECRET_TOKEN: 'agent-secret',
    } as AgentEnv

    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // Retry backoff would otherwise make these tests sleep for seconds.
    vi.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void) => {
      cb()
      return 0 as unknown as NodeJS.Timeout
    }) as typeof setTimeout)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await fs.rm(spoolDir, { recursive: true, force: true })
  })

  describe('delivery', () => {
    it('posts the result to the manager and reports success', async () => {
      fetchMock.mockResolvedValue({ ok: true })

      await expect(
        reportTaskResult(env, 'task-1', { status: 'success', result: { count: 2 } }, opts),
      ).resolves.toBe(true)

      expect(fetchMock).toHaveBeenCalledOnce()
      const [url, init] = fetchMock.mock.calls[0]!
      expect(url).toBe('https://manager.example.test/api/v1/tasks/task-1/result')
      expect(init.method).toBe('POST')
      expect(init.headers.Authorization).toBe('Bearer agent-secret')
      expect(JSON.parse(init.body)).toEqual({ status: 'success', result: { count: 2 } })
      expect(await spooledFiles()).toEqual([])
    })

    it('applies a timeout so a half-open connection cannot block forever', async () => {
      fetchMock.mockResolvedValue({ ok: true })

      await reportTaskResult(env, 'task-timeout', { status: 'success', result: {} }, opts)

      expect(fetchMock.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal)
    })

    it('retries a transient network failure and succeeds', async () => {
      fetchMock
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce({ ok: true })

      await expect(
        reportTaskResult(env, 'task-retry', { status: 'success', result: {} }, opts),
      ).resolves.toBe(true)

      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(await spooledFiles()).toEqual([])
    })

    it('retries a 5xx from the manager', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'restarting' })
        .mockResolvedValueOnce({ ok: true })

      await expect(
        reportTaskResult(env, 'task-503', { status: 'success', result: {} }, opts),
      ).resolves.toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('stops after the fixed number of attempts', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

      await reportTaskResult(env, 'task-exhausted', { status: 'success', result: {} }, opts)

      expect(fetchMock).toHaveBeenCalledTimes(MAX_ATTEMPTS)
    })

    it('never throws, even if the manager call blows up unexpectedly', async () => {
      // A reporting fault must not propagate into the poll loop.
      fetchMock.mockImplementation(() => {
        throw new Error('unexpected')
      })

      await expect(
        reportTaskResult(env, 'task-throw', { status: 'success', result: {} }, opts),
      ).resolves.toBe(false)
    })
  })

  describe('terminal rejections are not retried', () => {
    it.each([
      [409, 'already finalised by the reaper'],
      [404, 'task deleted'],
      [403, 'task belongs to another node'],
    ])('gives up immediately on HTTP %i', async (status) => {
      fetchMock.mockResolvedValue({ ok: false, status, text: async () => 'nope' })

      await expect(
        reportTaskResult(env, 'task-terminal', { status: 'success', result: {} }, opts),
      ).resolves.toBe(false)

      // Re-sending can never succeed, so one attempt and no spool entry.
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(await spooledFiles()).toEqual([])
    })

    it.each([408, 429])('still retries HTTP %i, which is transient', async (status) => {
      fetchMock
        .mockResolvedValueOnce({ ok: false, status, text: async () => 'slow down' })
        .mockResolvedValueOnce({ ok: true })

      await expect(
        reportTaskResult(env, 'task-transient', { status: 'success', result: {} }, opts),
      ).resolves.toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('spooling', () => {
    it('writes the result to disk after every attempt fails', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

      await expect(
        reportTaskResult(env, 'task-spool', {
          status: 'failed',
          result: { count: 0 },
          errorMessage: 'iptables command failed',
        }, opts),
      ).resolves.toBe(false)

      expect(await readSpooled('task-spool')).toMatchObject({
        taskId: 'task-spool',
        status: 'failed',
        result: { count: 0 },
        errorMessage: 'iptables command failed',
      })
    })

    it('refuses a task id that could escape the spool directory', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

      await reportTaskResult(env, '../../etc/passwd', { status: 'success', result: {} }, opts)

      expect(await spooledFiles()).toEqual([])
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('malformed task id'),
      )
    })

    it('leaves no temporary file behind', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

      await reportTaskResult(env, 'task-atomic', { status: 'success', result: {} }, opts)

      expect(await spooledFiles()).toEqual(['task-atomic.json'])
    })
  })

  describe('flushing spooled results', () => {
    const spool = async (taskId: string, body: Record<string, unknown> = {}) => {
      await fs.mkdir(spoolDir, { recursive: true })
      await fs.writeFile(
        path.join(spoolDir, `${taskId}.json`),
        JSON.stringify({
          taskId,
          spooledAt: new Date().toISOString(),
          status: 'success',
          result: {},
          ...body,
        }),
      )
    }

    it('delivers a spooled result and removes it', async () => {
      await spool('task-old', { result: { count: 7 } })
      fetchMock.mockResolvedValue({ ok: true })

      await expect(flushSpooledResults(env, opts)).resolves.toBe(1)

      expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({
        status: 'success',
        result: { count: 7 },
      })
      expect(await spooledFiles()).toEqual([])
    })

    it('returns zero when nothing is spooled', async () => {
      await expect(flushSpooledResults(env, opts)).resolves.toBe(0)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('keeps a result spooled while the manager is still unreachable', async () => {
      await spool('task-still-down')
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

      await expect(flushSpooledResults(env, opts)).resolves.toBe(0)
      expect(await spooledFiles()).toEqual(['task-still-down.json'])
    })

    it('stops after the first unreachable entry instead of hammering the manager', async () => {
      await spool('task-a')
      await spool('task-b')
      await spool('task-c')
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

      await flushSpooledResults(env, opts)

      expect(fetchMock).toHaveBeenCalledOnce()
      expect((await spooledFiles()).length).toBe(3)
    })

    it('drops a result the manager rejects permanently', async () => {
      // 409 usually means the reaper already finalised the task.
      await spool('task-stale')
      fetchMock.mockResolvedValue({ ok: false, status: 409, text: async () => 'finalised' })

      await expect(flushSpooledResults(env, opts)).resolves.toBe(0)
      expect(await spooledFiles()).toEqual([])
    })

    it('discards a corrupt spool entry rather than retrying it forever', async () => {
      await fs.mkdir(spoolDir, { recursive: true })
      await fs.writeFile(path.join(spoolDir, 'task-corrupt.json'), '{ not json')

      await expect(flushSpooledResults(env, opts)).resolves.toBe(0)

      expect(fetchMock).not.toHaveBeenCalled()
      expect(await spooledFiles()).toEqual([])
    })

    it('flushes on startup and can be stopped', async () => {
      await spool('task-startup')
      fetchMock.mockResolvedValue({ ok: true })

      const flusher = startResultFlusher(env, opts)
      // startResultFlusher kicks off the first flush without awaiting it.
      await vi.waitFor(async () => expect(await spooledFiles()).toEqual([]))
      flusher.stop()
    })
  })
})

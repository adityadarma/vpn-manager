import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEnv } from '../src/config/env'
import type { VpnDriver } from '../src/drivers'

const { handleCreateUser } = vi.hoisted(() => ({
  handleCreateUser: vi.fn(),
}))

vi.mock('../src/handlers/create-user', () => ({ handleCreateUser }))

import { executeTask } from '../src/core/executor'

const env = {
  AGENT_MANAGER_URL: 'https://manager.example.test',
  AGENT_SECRET_TOKEN: 'agent-secret',
  FIREWALL_ENGINE: 'nftables',
  VPN_TYPE: 'wireguard',
} as AgentEnv

const driver = {} as VpnDriver

function reportedBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit
  return JSON.parse(init.body as string) as Record<string, unknown>
}

describe('executeTask', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    handleCreateUser.mockReset()
    fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reports a successful handler result with the enriched payload', async () => {
    handleCreateUser.mockResolvedValue({ created: true })

    await executeTask(env, {
      id: 'task-success',
      action: 'create_vpn_user',
      payload: { username: 'alice', vpn_type: 'openvpn' },
    }, driver)

    expect(handleCreateUser).toHaveBeenCalledWith({
      username: 'alice',
      firewall_engine: 'nftables',
      vpn_type: 'wireguard',
    }, driver)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://manager.example.test/api/v1/tasks/task-success/result',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer agent-secret',
          'Content-Type': 'application/json',
        },
      }),
    )
    expect(reportedBody(fetchMock)).toEqual({ status: 'success', result: { created: true } })
  })

  it.each([
    [{ success: false, reason: 'missing_public_key' }, 'missing_public_key'],
    [{ kicked: false, error: 'management command failed' }, 'management command failed'],
    [{ unkicked: false }, 'Handler reported unkicked=false'],
  ])('reports a failure-shaped result as failed: %j', async (result, errorMessage) => {
    handleCreateUser.mockResolvedValue(result)

    await executeTask(env, {
      id: 'task-handler-failure',
      action: 'create_vpn_user',
      payload: { username: 'alice' },
    }, driver)

    expect(reportedBody(fetchMock)).toEqual({ status: 'failed', result, errorMessage })
  })

  it('reports a thrown handler error as failed', async () => {
    handleCreateUser.mockRejectedValue(new Error('certificate generation failed'))

    await executeTask(env, {
      id: 'task-thrown-error',
      action: 'create_vpn_user',
      payload: { username: 'alice' },
    }, driver)

    expect(reportedBody(fetchMock)).toEqual({
      status: 'failed',
      result: {},
      errorMessage: 'certificate generation failed',
    })
  })

  it('reports an unknown action without invoking a handler', async () => {
    await executeTask(env, {
      id: 'task-unknown',
      action: 'does_not_exist',
      payload: {},
    }, driver)

    expect(handleCreateUser).not.toHaveBeenCalled()
    expect(reportedBody(fetchMock)).toEqual({
      status: 'failed',
      result: {},
      errorMessage: expect.stringContaining('Unknown action "does_not_exist"'),
    })
  })

  it('does not reject when the manager rejects the report', async () => {
    const text = vi.fn().mockResolvedValue('manager unavailable')
    fetchMock.mockResolvedValue({ ok: false, status: 503, text })
    handleCreateUser.mockResolvedValue({ created: true })

    await expect(executeTask(env, {
      id: 'task-report-failure',
      action: 'create_vpn_user',
      payload: { username: 'alice' },
    }, driver)).resolves.toBeUndefined()

    expect(text).toHaveBeenCalledOnce()
    expect(console.error).toHaveBeenCalledWith(
      '[executor] Failed to report result: HTTP 503 - manager unavailable',
    )
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEnv } from '../src/config/env'
import type { VpnDriver } from '../src/drivers'

const { handleCreateUser, reportTaskResult } = vi.hoisted(() => ({
  handleCreateUser: vi.fn(),
  reportTaskResult: vi.fn(),
}))

vi.mock('../src/handlers/create-user', () => ({ handleCreateUser }))

vi.mock('../src/core/task-result-reporter', () => ({ reportTaskResult }))

import { executeTask } from '../src/core/executor'

const env = {
  AGENT_MANAGER_URL: 'https://manager.example.test',
  AGENT_SECRET_TOKEN: 'agent-secret',
  FIREWALL_ENGINE: 'nftables',
  VPN_TYPE: 'wireguard',
} as AgentEnv

const driver = {} as VpnDriver

/** The result the executor asked the reporter to deliver. */
function reported(): Record<string, unknown> {
  return reportTaskResult.mock.calls[0]![2] as Record<string, unknown>
}

describe('executeTask', () => {
  beforeEach(() => {
    handleCreateUser.mockReset()
    reportTaskResult.mockReset().mockResolvedValue(true)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
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
    expect(reportTaskResult).toHaveBeenCalledWith(env, 'task-success', {
      status: 'success',
      result: { created: true },
      errorMessage: undefined,
    })
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

    expect(reported()).toEqual({ status: 'failed', result, errorMessage })
  })

  it('reports a thrown handler error as failed', async () => {
    handleCreateUser.mockRejectedValue(new Error('certificate generation failed'))

    await executeTask(env, {
      id: 'task-thrown-error',
      action: 'create_vpn_user',
      payload: { username: 'alice' },
    }, driver)

    expect(reported()).toEqual({
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
    expect(reported()).toMatchObject({
      status: 'failed',
      result: {},
      errorMessage: expect.stringContaining('Unknown action "does_not_exist"'),
    })
  })

  it('still reports an outcome the reporter could not deliver', async () => {
    reportTaskResult.mockResolvedValue(false)
    handleCreateUser.mockResolvedValue({ created: true })

    await expect(executeTask(env, {
      id: 'task-undelivered',
      action: 'create_vpn_user',
      payload: { username: 'alice' },
    }, driver)).resolves.toBeUndefined()

    expect(reportTaskResult).toHaveBeenCalledOnce()
  })
})

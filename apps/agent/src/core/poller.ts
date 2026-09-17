import type { AgentEnv } from '../config/env'
import type { VpnDriver } from '../drivers'
import { executeTask } from './executor'

export function startPoller(env: AgentEnv, driver: VpnDriver): void {
  console.log(`🔄 Task poller started (long-poll wait: ${env.AGENT_TASK_LONG_POLL_WAIT_SECONDS}s)`)

  const poll = async (): Promise<boolean> => {
    try {
      const res = await fetch(
        `${env.AGENT_MANAGER_URL}/api/v1/nodes/${env.AGENT_NODE_ID}/tasks?wait=${env.AGENT_TASK_LONG_POLL_WAIT_SECONDS}`,
        {
          headers: {
            Authorization: `Bearer ${env.AGENT_SECRET_TOKEN}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout((env.AGENT_TASK_LONG_POLL_WAIT_SECONDS + 10) * 1_000),
        },
      )

      if (!res.ok) {
        console.error(`[poller] HTTP ${res.status}: ${await res.text()}`)
        return false
      }

      const data = (await res.json()) as {
        tasks: Array<{ id: string; action: string; payload: Record<string, unknown> }>
      }

      for (const task of data.tasks) {
        console.log(`[poller] Executing task: ${task.action} (${task.id})`)
        await executeTask(env, task, driver)
      }
      return true
    } catch (err) {
      console.error('[poller] Error:', (err as Error).message)
      return false
    }
  }

  // A successful long poll returns as soon as work exists, so the next request
  // is issued immediately. Only failures back off, using the legacy poll
  // interval as the retry delay.
  const run = async () => {
    while (true) {
      if (!(await poll())) {
        await new Promise((resolve) => setTimeout(resolve, env.AGENT_POLL_INTERVAL_MS))
      }
    }
  }
  void run()
}

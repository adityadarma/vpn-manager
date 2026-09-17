import { describe, expect, it } from 'vitest'
import { RealtimeEvents } from '../src/services/realtime'

describe('RealtimeEvents', () => {
  it('publishes metadata-only events and removes disconnected subscribers', () => {
    const events = new RealtimeEvents()
    const received: Array<{ type: string; entityId?: string }> = []
    const unsubscribe = events.subscribe((event) => received.push(event))

    events.publish('vpn_session.updated', 'session-1')
    unsubscribe()
    events.publish('node.updated', 'node-1')

    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ type: 'vpn_session.updated', entityId: 'session-1' })
    expect(received[0]).not.toHaveProperty('payload')
  })
})

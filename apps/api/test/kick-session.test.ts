import { describe, it, expect } from 'vitest'

describe('Kick Session Handler', () => {
  it('should correctly coerce permanent param from various types', async () => {
    const { handleKickSession } = await import('../../agent/src/handlers/kick-session')

    let receivedOptions: any = null
    const mockDriver = {
      kickSession: async (_commonName: string, options: any) => {
        receivedOptions = options
        return { kicked: true, common_name: _commonName, permanent: !!options?.permanent, kill_method: null, kill_response: null }
      },
      on: () => mockDriver,
      emit: () => true,
      addListener: () => mockDriver,
      removeListener: () => mockDriver,
    } as any

    await handleKickSession({ common_name: 'user1', permanent: true }, mockDriver)
    expect(receivedOptions.permanent).toBe(true)

    await handleKickSession({ common_name: 'user2', permanent: 'true' }, mockDriver)
    expect(receivedOptions.permanent).toBe(true)

    await handleKickSession({ common_name: 'user3', permanent: 'false' }, mockDriver)
    expect(receivedOptions.permanent).toBe(false)

    await handleKickSession({ common_name: 'user4', permanent: 1 }, mockDriver)
    expect(receivedOptions.permanent).toBe(false)

    await handleKickSession({ common_name: 'user5' }, mockDriver)
    expect(receivedOptions.permanent).toBeUndefined()
  })
})

import { describe, expect, test, vi } from 'vitest'
import type { Session } from '../types'
import { closeSessionWithSuccessor } from './closeSessionWithSuccessor'

const openSession = (id: string): Session =>
  ({
    id,
    panes: [{ id: `${id}-p`, kind: 'shell', status: 'running', active: true }],
  }) as unknown as Session

describe('closeSessionWithSuccessor', () => {
  test('activates the visible successor after removing the active session', () => {
    const activateSession = vi.fn()
    const removeSession = vi.fn().mockReturnValue(undefined)
    closeSessionWithSuccessor('A', {
      sessions: [openSession('A'), openSession('B')],
      activeSessionId: 'A',
      removeSession,
      activateSession,
    })

    expect(removeSession).toHaveBeenCalledWith('A')
    expect(activateSession).toHaveBeenCalledWith('B')
  })

  test('guard cancellation (false) stops successor activation', () => {
    const activateSession = vi.fn()
    closeSessionWithSuccessor('A', {
      sessions: [openSession('A'), openSession('B')],
      activeSessionId: 'A',
      removeSession: vi.fn().mockReturnValue(false),
      activateSession,
    })

    expect(activateSession).not.toHaveBeenCalled()
  })

  test('closing a non-active session never reactivates', () => {
    const activateSession = vi.fn()
    closeSessionWithSuccessor('B', {
      sessions: [openSession('A'), openSession('B')],
      activeSessionId: 'A',
      removeSession: vi.fn().mockReturnValue(undefined),
      activateSession,
    })

    expect(activateSession).not.toHaveBeenCalled()
  })

  test('last session: removal proceeds with no successor', () => {
    const activateSession = vi.fn()
    const removeSession = vi.fn().mockReturnValue(undefined)
    closeSessionWithSuccessor('A', {
      sessions: [openSession('A')],
      activeSessionId: 'A',
      removeSession,
      activateSession,
    })

    expect(removeSession).toHaveBeenCalledWith('A')
    expect(activateSession).not.toHaveBeenCalled()
  })

  test('focusSuccessor receives the successor id', () => {
    const focusSuccessor = vi.fn()
    closeSessionWithSuccessor('A', {
      sessions: [openSession('A'), openSession('B')],
      activeSessionId: 'A',
      removeSession: vi.fn().mockReturnValue(undefined),
      activateSession: vi.fn(),
      focusSuccessor,
    })

    expect(focusSuccessor).toHaveBeenCalledWith('B')
  })
})

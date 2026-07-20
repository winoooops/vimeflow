import { act, renderHook } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { Session } from '../types'
import { useSessionMru } from './useSessionMru'

const openSession = (id: string): Session =>
  ({
    id,
    panes: [{ id: `${id}-p`, kind: 'shell', status: 'running', active: true }],
  }) as unknown as Session

describe('useSessionMru', () => {
  test('seeds visible order with the active session first', () => {
    const { result } = renderHook(() =>
      useSessionMru({
        sessions: [openSession('A'), openSession('B'), openSession('C')],
        activeSessionId: 'B',
      })
    )

    expect(result.current.mruSessionIds).toEqual(['B', 'A', 'C'])
  })

  test('committed activation moves the id to the front', () => {
    const { result } = renderHook(() =>
      useSessionMru({
        sessions: [openSession('A'), openSession('B'), openSession('C')],
        activeSessionId: 'A',
      })
    )

    act(() => result.current.recordActivationCommitted('C'))
    expect(result.current.mruSessionIds).toEqual(['C', 'A', 'B'])
  })

  test('prunes removed sessions and appends never-seen ones at the back', () => {
    const { result, rerender } = renderHook(
      ({ sessions }: { sessions: Session[] }) =>
        useSessionMru({ sessions, activeSessionId: 'A' }),
      { initialProps: { sessions: [openSession('A'), openSession('B')] } }
    )

    rerender({ sessions: [openSession('A'), openSession('D')] })
    expect(result.current.mruSessionIds).toEqual(['A', 'D'])
  })

  test('committed notification for an unknown id is ignored', () => {
    const { result } = renderHook(() =>
      useSessionMru({
        sessions: [openSession('A')],
        activeSessionId: 'A',
      })
    )

    act(() => result.current.recordActivationCommitted('ghost'))
    expect(result.current.mruSessionIds).toEqual(['A'])
  })
})

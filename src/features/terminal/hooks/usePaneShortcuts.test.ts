// cspell:ignore vsplit hsplit
import { renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { emptyActivity } from '../../sessions/constants'
import type { LayoutId, Session } from '../../sessions/types'
import { usePaneShortcuts } from './usePaneShortcuts'

const makeSession = (
  id: string,
  layout: LayoutId,
  paneIds: string[],
  activeIndex = 0
): Session => ({
  id,
  projectId: 'p-1',
  name: id,
  status: 'running',
  workingDirectory: '/tmp',
  agentType: 'generic',
  layout,
  panes: paneIds.map((paneId, index) => ({
    id: paneId,
    ptyId: `pty-${paneId}`,
    cwd: '/tmp',
    agentType: 'generic',
    status: 'running',
    active: index === activeIndex,
  })),
  createdAt: '2026-05-12T00:00:00Z',
  lastActivityAt: '2026-05-12T00:00:00Z',
  activity: { ...emptyActivity },
})

const fire = (
  key: string,
  modifiers: Partial<KeyboardEventInit> = {}
): KeyboardEvent & { preventDefaultSpy: ReturnType<typeof vi.spyOn> } => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  })
  const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
  document.dispatchEvent(event)

  return Object.assign(event, { preventDefaultSpy })
}

describe('usePaneShortcuts', () => {
  test('Cmd+\\ from single cycles to vsplit and prevents default', () => {
    const setSessionLayout = vi.fn()
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'single', ['p0'])],
        activeSessionId: 's1',
        setSessionActivePane: vi.fn(),
        setSessionLayout,
      })
    )

    const event = fire('\\', { metaKey: true })

    expect(setSessionLayout).toHaveBeenCalledOnce()
    expect(setSessionLayout).toHaveBeenCalledWith('s1', 'vsplit')
    expect(event.preventDefaultSpy).toHaveBeenCalled()
  })

  test('Cmd+\\ from quad wraps to single', () => {
    const setSessionLayout = vi.fn()
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'quad', ['p0'])],
        activeSessionId: 's1',
        setSessionActivePane: vi.fn(),
        setSessionLayout,
      })
    )

    fire('\\', { ctrlKey: true })

    expect(setSessionLayout).toHaveBeenCalledOnce()
    expect(setSessionLayout).toHaveBeenCalledWith('s1', 'single')
  })

  test('Cmd+2 with only one pane is a no-op but still prevents default', () => {
    const setSessionActivePane = vi.fn()
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'single', ['p0'])],
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
      })
    )

    const event = fire('2', { metaKey: true })

    expect(setSessionActivePane).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).toHaveBeenCalled()
  })

  test('Ctrl+Alt+1 is rejected and does not prevent default', () => {
    const setSessionActivePane = vi.fn()
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'])],
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
      })
    )

    const event = fire('1', { ctrlKey: true, altKey: true })

    expect(setSessionActivePane).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })

  test('no modifier is a no-op and does not prevent default', () => {
    const setSessionActivePane = vi.fn()
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'])],
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
      })
    )

    const event = fire('2')

    expect(setSessionActivePane).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })

  test('activeSessionId=null is a no-op', () => {
    const setSessionLayout = vi.fn()
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'single', ['p0'])],
        activeSessionId: null,
        setSessionActivePane: vi.fn(),
        setSessionLayout,
      })
    )

    fire('\\', { metaKey: true })

    expect(setSessionLayout).not.toHaveBeenCalled()
  })

  test('unmount removes the listener', () => {
    const setSessionLayout = vi.fn()

    const { unmount } = renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'single', ['p0'])],
        activeSessionId: 's1',
        setSessionActivePane: vi.fn(),
        setSessionLayout,
      })
    )

    unmount()
    fire('\\', { metaKey: true })

    expect(setSessionLayout).not.toHaveBeenCalled()
  })

  test('Cmd+2 with active p0 and two panes focuses p1', () => {
    const setSessionActivePane = vi.fn()
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'])],
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
      })
    )

    fire('2', { metaKey: true })

    expect(setSessionActivePane).toHaveBeenCalledOnce()
    expect(setSessionActivePane).toHaveBeenCalledWith('s1', 'p1')
  })

  test('Cmd+1 with already-active p0 is a no-op but still prevents default', () => {
    const setSessionActivePane = vi.fn()
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'])],
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
      })
    )

    const event = fire('1', { metaKey: true })

    expect(setSessionActivePane).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).toHaveBeenCalled()
  })
})

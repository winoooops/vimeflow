// cspell:ignore vsplit hsplit
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { emptyActivity } from '../../sessions/constants'
import type { LayoutId, Session } from '../../sessions/types'
import * as chordRegistry from '../chordRegistry'
import { useVimLeaderChords } from './useVimLeaderChords'

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
  activityPanelCollapsed: false,
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

const dispatch = (key: string): boolean =>
  chordRegistry.dispatch(new KeyboardEvent('keydown', { key }))

describe('useVimLeaderChords', () => {
  beforeEach(() => {
    chordRegistry._resetForTest()
  })

  test('non-vim preset registers no chords', () => {
    const setSessionActivePane = vi.fn()
    const closeActivePane = vi.fn()
    const setActiveSessionLayout = vi.fn()

    renderHook(() =>
      useVimLeaderChords({
        keymapPreset: 'vimeflow',
        activeSession: makeSession('s1', 'vsplit', ['p0', 'p1'], 1),
        setSessionActivePane,
        closeActivePane,
        setActiveSessionLayout,
      })
    )

    expect(dispatch('h')).toBe(false)
    expect(setSessionActivePane).not.toHaveBeenCalled()
    expect(closeActivePane).not.toHaveBeenCalled()
    expect(setActiveSessionLayout).not.toHaveBeenCalled()
  })

  test('vim h moves focus left in vsplit from p1 to p0', () => {
    const setSessionActivePane = vi.fn()

    renderHook(() =>
      useVimLeaderChords({
        keymapPreset: 'vim',
        activeSession: makeSession('s1', 'vsplit', ['p0', 'p1'], 1),
        setSessionActivePane,
        closeActivePane: vi.fn(),
        setActiveSessionLayout: vi.fn(),
      })
    )

    expect(dispatch('h')).toBe(true)
    expect(setSessionActivePane).toHaveBeenCalledOnce()
    expect(setSessionActivePane).toHaveBeenCalledWith('s1', 'p0')
  })

  test('vim j moves focus down in hsplit from p0 to p1', () => {
    const setSessionActivePane = vi.fn()

    renderHook(() =>
      useVimLeaderChords({
        keymapPreset: 'vim',
        activeSession: makeSession('s1', 'hsplit', ['p0', 'p1']),
        setSessionActivePane,
        closeActivePane: vi.fn(),
        setActiveSessionLayout: vi.fn(),
      })
    )

    expect(dispatch('j')).toBe(true)
    expect(setSessionActivePane).toHaveBeenCalledOnce()
    expect(setSessionActivePane).toHaveBeenCalledWith('s1', 'p1')
  })

  test('vim w cycles to the next pane', () => {
    const setSessionActivePane = vi.fn()

    renderHook(() =>
      useVimLeaderChords({
        keymapPreset: 'vim',
        activeSession: makeSession('s1', 'vsplit', ['p0', 'p1']),
        setSessionActivePane,
        closeActivePane: vi.fn(),
        setActiveSessionLayout: vi.fn(),
      })
    )

    expect(dispatch('w')).toBe(true)
    expect(setSessionActivePane).toHaveBeenCalledOnce()
    expect(setSessionActivePane).toHaveBeenCalledWith('s1', 'p1')
  })

  test('vim c closes the active pane', () => {
    const closeActivePane = vi.fn()

    renderHook(() =>
      useVimLeaderChords({
        keymapPreset: 'vim',
        activeSession: makeSession('s1', 'vsplit', ['p0', 'p1']),
        setSessionActivePane: vi.fn(),
        closeActivePane,
        setActiveSessionLayout: vi.fn(),
      })
    )

    expect(dispatch('c')).toBe(true)
    expect(closeActivePane).toHaveBeenCalledOnce()
  })

  test('vim s/v/o set horizontal/vertical/single layout', () => {
    const setActiveSessionLayout = vi.fn()

    renderHook(() =>
      useVimLeaderChords({
        keymapPreset: 'vim',
        activeSession: makeSession('s1', 'single', ['p0']),
        setSessionActivePane: vi.fn(),
        closeActivePane: vi.fn(),
        setActiveSessionLayout,
      })
    )

    expect(dispatch('s')).toBe(true)
    expect(setActiveSessionLayout).toHaveBeenCalledWith('hsplit')

    setActiveSessionLayout.mockClear()

    expect(dispatch('v')).toBe(true)
    expect(setActiveSessionLayout).toHaveBeenCalledWith('vsplit')

    setActiveSessionLayout.mockClear()

    expect(dispatch('o')).toBe(true)
    expect(setActiveSessionLayout).toHaveBeenCalledWith('single')
  })

  test('rerender to non-vim unregisters chords', () => {
    const setSessionActivePane = vi.fn()

    const { rerender } = renderHook(
      ({ preset }: { preset: string }) =>
        useVimLeaderChords({
          keymapPreset: preset,
          activeSession: makeSession('s1', 'vsplit', ['p0', 'p1'], 1),
          setSessionActivePane,
          closeActivePane: vi.fn(),
          setActiveSessionLayout: vi.fn(),
        }),
      { initialProps: { preset: 'vim' } }
    )

    expect(dispatch('h')).toBe(true)
    expect(setSessionActivePane).toHaveBeenCalledTimes(1)

    rerender({ preset: 'vimeflow' })
    setSessionActivePane.mockClear()

    expect(dispatch('h')).toBe(false)
    expect(setSessionActivePane).not.toHaveBeenCalled()
  })

  test('directional chord claims the key even when there is no neighbor', () => {
    const setSessionActivePane = vi.fn()

    renderHook(() =>
      useVimLeaderChords({
        keymapPreset: 'vim',
        activeSession: makeSession('s1', 'single', ['p0']),
        setSessionActivePane,
        closeActivePane: vi.fn(),
        setActiveSessionLayout: vi.fn(),
      })
    )

    expect(dispatch('l')).toBe(true)
    expect(setSessionActivePane).not.toHaveBeenCalled()
  })
})

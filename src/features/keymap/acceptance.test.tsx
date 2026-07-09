import { expect, test, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { SettingsContext } from '../settings/SettingsProvider'
import { DEFAULT_SETTINGS } from '../settings/store/settingsDefaults'
import type { AppSettings } from '../../bindings/AppSettings'
import { emptyActivity } from '../sessions/constants'
import type { Session } from '../sessions/types'
import { useKeybindings } from './useKeybindings'
import { usePaneShortcuts } from '../terminal/hooks/usePaneShortcuts'

const sessions: Session[] = [
  {
    id: 's1',
    projectId: 'p-1',
    name: 's1',
    status: 'running',
    workingDirectory: '/tmp',
    agentType: 'generic',
    layout: 'vsplit',
    activityPanelCollapsed: false,
    panes: [
      {
        id: 'p0',
        ptyId: 'pty-p0',
        cwd: '/tmp',
        agentType: 'generic',
        status: 'running',
        active: true,
      },
      {
        id: 'p1',
        ptyId: 'pty-p1',
        cwd: '/tmp',
        agentType: 'generic',
        status: 'running',
        active: false,
      },
    ],
    createdAt: '2026-05-12T00:00:00Z',
    lastActivityAt: '2026-05-12T00:00:00Z',
    activity: { ...emptyActivity },
  },
]

// End-to-end: a persisted override flows settings → useKeybindings → the migrated
// hook, so it dispatches on the new combo and not the old default. jsdom is
// non-mac, so useKeybindings resolves `Mod` to `ctrl`.
test('persisted override changes the live shortcut (focus-pane-2 -> Mod+KeyK)', () => {
  const setSessionActivePane = vi.fn()

  const settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    customKeybindings: { 'focus-pane-2': 'Mod+KeyK' },
  }

  const wrapper = ({ children }: { children: ReactNode }): ReactNode =>
    createElement(
      SettingsContext.Provider,
      { value: { settings, saveError: null, update: vi.fn() } },
      children
    )

  renderHook(
    () => {
      const { matches } = useKeybindings()
      usePaneShortcuts({
        sessions,
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
        matches,
        isTerminalContainerActive: true,
      })
    },
    { wrapper }
  )

  document.dispatchEvent(
    new KeyboardEvent('keydown', { code: 'KeyK', ctrlKey: true })
  )
  expect(setSessionActivePane).toHaveBeenCalledWith('s1', 'p1') // rebound combo focuses pane 2

  setSessionActivePane.mockClear()
  document.dispatchEvent(
    new KeyboardEvent('keydown', { code: 'Digit2', ctrlKey: true })
  )
  expect(setSessionActivePane).not.toHaveBeenCalled() // old default no longer bound
})

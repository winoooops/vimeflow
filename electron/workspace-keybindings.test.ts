import type { BrowserWindow } from 'electron'
import { describe, expect, test } from 'vitest'
import { CATALOG } from '../src/features/keymap/catalog'
import { createWorkspaceKeybindingSnapshot } from '../src/features/keymap/snapshot'
import {
  DEFAULT_WORKSPACE_KEYBINDING_SNAPSHOT,
  getWorkspaceKeybindingSnapshot,
  isWorkspaceKeybindingOverrides,
  setWorkspaceKeybindingSnapshot,
  updateWorkspaceKeybindingsFromSettings,
} from './workspace-keybindings'

const fakeWindow = (): BrowserWindow => ({}) as BrowserWindow

describe('workspace keybinding snapshots by window', () => {
  test('falls back to the current-platform default snapshot', () => {
    expect(getWorkspaceKeybindingSnapshot(fakeWindow())).toBe(
      DEFAULT_WORKSPACE_KEYBINDING_SNAPSHOT
    )

    expect(DEFAULT_WORKSPACE_KEYBINDING_SNAPSHOT.bindings).toHaveLength(
      CATALOG.length
    )
  })

  test('stores snapshots independently per window', () => {
    const first = fakeWindow()
    const second = fakeWindow()

    const snapshot = createWorkspaceKeybindingSnapshot(
      { 'activity-panel-toggle': 'Mod+KeyK' },
      'darwin'
    )

    setWorkspaceKeybindingSnapshot(first, snapshot)

    expect(getWorkspaceKeybindingSnapshot(first)).toBe(snapshot)
    expect(getWorkspaceKeybindingSnapshot(second)).toBe(
      DEFAULT_WORKSPACE_KEYBINDING_SNAPSHOT
    )
  })

  test('updates a window directly from settings overrides', () => {
    const win = fakeWindow()

    const snapshot = updateWorkspaceKeybindingsFromSettings(
      win,
      { 'activity-panel-toggle': 'Mod+Alt+KeyK' },
      'darwin'
    )

    expect(getWorkspaceKeybindingSnapshot(win)).toBe(snapshot)
    expect(
      snapshot.bindings.find((entry) => entry.id === 'activity-panel-toggle')
    ).toEqual(
      expect.objectContaining({
        code: 'KeyK',
        meta: true,
        alt: true,
      })
    )
  })
})

describe('workspace keybinding override validation', () => {
  test('accepts the backend entry and character limits', () => {
    const bindings = Object.fromEntries(
      Array.from({ length: 256 }, (_, index) => [
        `command-${String(index)}`,
        'x'.repeat(128),
      ])
    )

    expect(isWorkspaceKeybindingOverrides(bindings)).toBe(true)
    expect(
      isWorkspaceKeybindingOverrides({
        ['😀'.repeat(128)]: '😀'.repeat(128),
      })
    ).toBe(true)
  })

  test.each([
    [
      'too many entries',
      Object.fromEntries(
        Array.from({ length: 257 }, (_, index) => [
          `command-${String(index)}`,
          'Mod+KeyK',
        ])
      ),
    ],
    ['an oversized command', { ['x'.repeat(129)]: 'Mod+KeyK' }],
    ['an oversized binding', { command: 'x'.repeat(129) }],
  ])('rejects %s', (_label, bindings) => {
    expect(isWorkspaceKeybindingOverrides(bindings)).toBe(false)
  })
})

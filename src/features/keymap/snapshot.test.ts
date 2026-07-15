import { describe, expect, test } from 'vitest'
import { CATALOG } from './catalog'
import {
  createWorkspaceKeybindingSnapshot,
  matchingWorkspaceKeybindings,
} from './snapshot'

const input = (
  code: string,
  modifiers: Partial<{
    control: boolean
    meta: boolean
    alt: boolean
    shift: boolean
  }> = {}
): {
  code: string
  control: boolean
  meta: boolean
  alt: boolean
  shift: boolean
} => ({
  code,
  control: modifiers.control ?? false,
  meta: modifiers.meta ?? false,
  alt: modifiers.alt ?? false,
  shift: modifiers.shift ?? false,
})

describe('createWorkspaceKeybindingSnapshot', () => {
  test('includes the full catalog in source order', () => {
    const snapshot = createWorkspaceKeybindingSnapshot({}, 'darwin')

    expect(snapshot.version).toBe(1)
    expect(snapshot.bindings.map((entry) => entry.id)).toEqual(
      CATALOG.map((command) => command.id)
    )
  })

  test('expands Mod for the target platform and preserves literal Ctrl', () => {
    const mac = createWorkspaceKeybindingSnapshot({}, 'darwin')
    const linux = createWorkspaceKeybindingSnapshot({}, 'linux')

    expect(
      mac.bindings.find((entry) => entry.id === 'activity-panel-toggle')
    ).toEqual(
      expect.objectContaining({
        token: 'Mod+KeyR',
        control: false,
        meta: true,
        alt: false,
        shift: false,
      })
    )

    expect(
      linux.bindings.find((entry) => entry.id === 'activity-panel-toggle')
    ).toEqual(
      expect.objectContaining({
        token: 'Mod+Shift+KeyR',
        control: true,
        meta: false,
        shift: true,
      })
    )

    expect(
      mac.bindings.find((entry) => entry.id === 'diff-scroll-page-down')
    ).toEqual(expect.objectContaining({ control: true, meta: false }))
  })

  test('uses resolved custom bindings', () => {
    const snapshot = createWorkspaceKeybindingSnapshot(
      { 'activity-panel-toggle': 'Mod+Shift+KeyK' },
      'darwin'
    )

    expect(
      snapshot.bindings.find((entry) => entry.id === 'activity-panel-toggle')
    ).toEqual(
      expect.objectContaining({
        code: 'KeyK',
        token: 'Mod+Shift+KeyK',
        meta: true,
        shift: true,
      })
    )
  })
})

describe('matchingWorkspaceKeybindings', () => {
  const snapshot = createWorkspaceKeybindingSnapshot({}, 'darwin')

  test('matches exact bindings and rejects unlisted secondary modifiers', () => {
    expect(
      matchingWorkspaceKeybindings(snapshot, input('KeyR', { meta: true })).map(
        (entry) => entry.id
      )
    ).toContain('activity-panel-toggle')

    expect(
      matchingWorkspaceKeybindings(
        snapshot,
        input('KeyR', { meta: true, shift: true })
      ).map((entry) => entry.id)
    ).not.toContain('activity-panel-toggle')
  })

  test('allows unlisted secondary modifiers for tolerant bindings', () => {
    expect(
      matchingWorkspaceKeybindings(
        snapshot,
        input('Digit1', { meta: true, alt: true, shift: true })
      ).map((entry) => entry.id)
    ).toContain('focus-pane-1')
  })

  test('filters matches to requested contexts', () => {
    const bareJ = input('KeyJ')

    expect(
      matchingWorkspaceKeybindings(snapshot, bareJ, ['diff']).map(
        (entry) => entry.id
      )
    ).toContain('diff-line-next')

    expect(matchingWorkspaceKeybindings(snapshot, bareJ, ['global'])).toEqual(
      []
    )
  })
})

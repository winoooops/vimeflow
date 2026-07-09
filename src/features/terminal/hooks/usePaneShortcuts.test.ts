// cspell:ignore vsplit hsplit
import { renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { emptyActivity } from '../../sessions/constants'
import type { LayoutId, Session } from '../../sessions/types'
import { SINGLE_PANE_FOCUS_LAYOUT_ID } from '../layout-registry'
import {
  usePaneShortcuts,
  type UsePaneShortcutsOptions,
} from './usePaneShortcuts'
import { eventMatchesChord, type PlatformSuper } from '../../keymap/match'
import { resolveBinding } from '../../keymap/resolve'
import { getCommand, type CommandId } from '../../keymap/catalog'
import { KEYMAP_CAPTURE_TARGET_ATTRIBUTE } from '../../keymap/capture'

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

// Derive `event.code` (physical key position) from the printable `key`.
// Production code matches by `event.code` so non-US layouts (AZERTY,
// QWERTZ) work too; tests synthesize both fields the way a real
// keypress would.
const codeFor = (key: string): string | undefined => {
  if (key >= '1' && key <= '4') {
    return `Digit${key}`
  }
  if (key === '\\') {
    return 'Backslash'
  }
  if (key.toLowerCase() === 'z') {
    return 'KeyZ'
  }

  return undefined
}

const fire = (
  key: string,
  modifiers: Partial<KeyboardEventInit> = {}
): KeyboardEvent & { preventDefaultSpy: ReturnType<typeof vi.spyOn> } => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
    // Spread `modifiers` first so a test can override `code` explicitly
    // (e.g. simulating a layout where the key/code pairing differs).
    code: modifiers.code ?? codeFor(key) ?? '',
  })
  const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
  document.dispatchEvent(event)

  return Object.assign(event, { preventDefaultSpy })
}

// Inject a registry matcher built from the real engine so the existing
// event-driven assertions still hold: each command resolves to its catalog
// default (no overrides) and is matched per platform. The migration replaced
// usePaneShortcuts' hardcoded super gate with this `matches` (VIM-136 SP1).
const realMatches =
  (superKey: PlatformSuper, isMac: boolean) =>
  (event: KeyboardEvent, id: CommandId): boolean =>
    eventMatchesChord(
      event,
      resolveBinding(id, {}, isMac, superKey),
      superKey,
      getCommand(id).matchPolicy
    )
const ctrlMatches = realMatches('ctrl', false)
const metaMatches = realMatches('meta', true)

const renderPane = (
  options: Omit<UsePaneShortcutsOptions, 'matches'> & {
    matches?: UsePaneShortcutsOptions['matches']
  }
): ReturnType<typeof renderHook> =>
  renderHook(() => usePaneShortcuts({ matches: ctrlMatches, ...options }))

const modZPlatforms: readonly {
  readonly label: string
  readonly matches: UsePaneShortcutsOptions['matches']
  readonly shortcutModifiers: Partial<KeyboardEventInit>
  readonly oppositeModifiers: Partial<KeyboardEventInit>
}[] = [
  {
    label: 'Linux',
    matches: ctrlMatches,
    shortcutModifiers: { ctrlKey: true },
    oppositeModifiers: { metaKey: true },
  },
  {
    label: 'macOS',
    matches: metaMatches,
    shortcutModifiers: { metaKey: true },
    oppositeModifiers: { ctrlKey: true },
  },
]

const shortcutModifiersFor = (
  preferModifier: PlatformSuper
): Partial<KeyboardEventInit> =>
  preferModifier === 'meta' ? { metaKey: true } : { ctrlKey: true }

describe('usePaneShortcuts', () => {
  test('Ctrl+\\ from single cycles to vsplit and prevents default (default modifier)', () => {
    const setSessionLayout = vi.fn()
    renderPane({
      sessions: [makeSession('s1', 'single', ['p0'])],
      activeSessionId: 's1',
      setSessionActivePane: vi.fn(),
      setSessionLayout,
    })

    const event = fire('\\', { ctrlKey: true })

    expect(setSessionLayout).toHaveBeenCalledOnce()
    expect(setSessionLayout).toHaveBeenCalledWith('s1', 'vsplit')
    expect(event.preventDefaultSpy).toHaveBeenCalled()
  })

  test('Ctrl+\\ from the keymap recorder does not cycle layout', () => {
    const setSessionLayout = vi.fn()
    renderPane({
      sessions: [makeSession('s1', 'single', ['p0'])],
      activeSessionId: 's1',
      setSessionActivePane: vi.fn(),
      setSessionLayout,
    })

    const recorder = document.createElement('button')
    recorder.setAttribute(KEYMAP_CAPTURE_TARGET_ATTRIBUTE, 'true')
    document.body.append(recorder)

    try {
      const event = new KeyboardEvent('keydown', {
        key: '\\',
        code: 'Backslash',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
      recorder.dispatchEvent(event)

      expect(setSessionLayout).not.toHaveBeenCalled()
      expect(preventDefaultSpy).not.toHaveBeenCalled()
    } finally {
      recorder.remove()
    }
  })

  test('Ctrl+\\ from quad advances to grid3x2 (default modifier)', () => {
    const setSessionLayout = vi.fn()
    renderPane({
      sessions: [makeSession('s1', 'quad', ['p0'])],
      activeSessionId: 's1',
      setSessionActivePane: vi.fn(),
      setSessionLayout,
    })

    fire('\\', { ctrlKey: true })

    expect(setSessionLayout).toHaveBeenCalledOnce()
    expect(setSessionLayout).toHaveBeenCalledWith('s1', 'grid3x2')
  })

  modZPlatforms.forEach(
    ({ label, matches, shortcutModifiers, oppositeModifiers }) => {
      test(`${label}: Mod+Z toggles a multi-pane layout to single and back`, () => {
        const setSessionLayout = vi.fn()

        const { rerender } = renderHook(
          ({ session }) =>
            usePaneShortcuts({
              sessions: [session],
              activeSessionId: 's1',
              setSessionActivePane: vi.fn(),
              setSessionLayout,
              matches,
            }),
          {
            initialProps: {
              session: makeSession('s1', 'grid3x2', ['p0', 'p1', 'p2'], 2),
            },
          }
        )

        const oppositeEvent = fire('z', oppositeModifiers)
        expect(setSessionLayout).not.toHaveBeenCalled()
        expect(oppositeEvent.preventDefaultSpy).not.toHaveBeenCalled()

        const event = fire('z', shortcutModifiers)

        expect(setSessionLayout).toHaveBeenCalledOnce()
        expect(setSessionLayout).toHaveBeenCalledWith(
          's1',
          SINGLE_PANE_FOCUS_LAYOUT_ID
        )
        expect(event.preventDefaultSpy).toHaveBeenCalled()

        setSessionLayout.mockClear()
        rerender({
          session: makeSession(
            's1',
            SINGLE_PANE_FOCUS_LAYOUT_ID,
            ['p0', 'p1', 'p2'],
            2
          ),
        })

        const restoreEvent = fire('z', shortcutModifiers)

        expect(setSessionLayout).toHaveBeenCalledOnce()
        expect(setSessionLayout).toHaveBeenCalledWith('s1', 'grid3x2')
        expect(restoreEvent.preventDefaultSpy).toHaveBeenCalled()
      })
    }
  )

  test('Mod+Z keeps separate restore layouts for each session', () => {
    const setSessionLayout = vi.fn()

    const { rerender } = renderHook(
      ({ sessions, activeSessionId }) =>
        usePaneShortcuts({
          sessions,
          activeSessionId,
          setSessionActivePane: vi.fn(),
          setSessionLayout,
          matches: ctrlMatches,
        }),
      {
        initialProps: {
          sessions: [
            makeSession('s1', 'grid3x2', ['s1-p0', 's1-p1', 's1-p2'], 1),
            makeSession('s2', 'vsplit', ['s2-p0', 's2-p1'], 0),
          ],
          activeSessionId: 's1',
        },
      }
    )

    fire('z', shortcutModifiersFor('ctrl'))
    expect(setSessionLayout).toHaveBeenLastCalledWith(
      's1',
      SINGLE_PANE_FOCUS_LAYOUT_ID
    )

    rerender({
      sessions: [
        makeSession(
          's1',
          SINGLE_PANE_FOCUS_LAYOUT_ID,
          ['s1-p0', 's1-p1', 's1-p2'],
          1
        ),
        makeSession('s2', 'vsplit', ['s2-p0', 's2-p1'], 0),
      ],
      activeSessionId: 's2',
    })

    fire('z', shortcutModifiersFor('ctrl'))
    expect(setSessionLayout).toHaveBeenLastCalledWith(
      's2',
      SINGLE_PANE_FOCUS_LAYOUT_ID
    )

    rerender({
      sessions: [
        makeSession(
          's1',
          SINGLE_PANE_FOCUS_LAYOUT_ID,
          ['s1-p0', 's1-p1', 's1-p2'],
          1
        ),
        makeSession('s2', SINGLE_PANE_FOCUS_LAYOUT_ID, ['s2-p0', 's2-p1'], 0),
      ],
      activeSessionId: 's1',
    })

    const restoreEvent = fire('z', shortcutModifiersFor('ctrl'))

    expect(setSessionLayout).toHaveBeenLastCalledWith('s1', 'grid3x2')
    expect(restoreEvent.preventDefaultSpy).toHaveBeenCalled()
  })

  test('Mod+Z restore falls through when the previous layout no longer fits', () => {
    const setSessionLayout = vi.fn()

    const { rerender } = renderHook(
      ({ session }) =>
        usePaneShortcuts({
          sessions: [session],
          activeSessionId: 's1',
          setSessionActivePane: vi.fn(),
          setSessionLayout,
          matches: ctrlMatches,
        }),
      {
        initialProps: {
          session: makeSession('s1', 'vsplit', ['p0', 'p1'], 1),
        },
      }
    )

    fire('z', shortcutModifiersFor('ctrl'))
    expect(setSessionLayout).toHaveBeenCalledWith(
      's1',
      SINGLE_PANE_FOCUS_LAYOUT_ID
    )

    setSessionLayout.mockClear()
    rerender({
      session: makeSession(
        's1',
        SINGLE_PANE_FOCUS_LAYOUT_ID,
        ['p0', 'p1', 'p2'],
        2
      ),
    })

    const event = fire('z', shortcutModifiersFor('ctrl'))

    expect(setSessionLayout).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })

  test('Mod+Z on single layout is a no-op and lets the event propagate', () => {
    const setSessionLayout = vi.fn()
    renderHook(() =>
      usePaneShortcuts({
        sessions: [
          makeSession('s1', SINGLE_PANE_FOCUS_LAYOUT_ID, ['p0', 'p1'], 1),
        ],
        activeSessionId: 's1',
        setSessionActivePane: vi.fn(),
        setSessionLayout,
        matches: ctrlMatches,
      })
    )

    const event = fire('z', shortcutModifiersFor('ctrl'))

    expect(setSessionLayout).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })

  test('Mod+\\ clears pending Mod+Z restore state for the active session', () => {
    const setSessionLayout = vi.fn()

    const { rerender } = renderHook(
      ({ session }) =>
        usePaneShortcuts({
          sessions: [session],
          activeSessionId: 's1',
          setSessionActivePane: vi.fn(),
          setSessionLayout,
          matches: ctrlMatches,
        }),
      {
        initialProps: {
          session: makeSession('s1', 'grid3x2', ['p0', 'p1', 'p2'], 2),
        },
      }
    )

    fire('z', shortcutModifiersFor('ctrl'))
    expect(setSessionLayout).toHaveBeenCalledWith(
      's1',
      SINGLE_PANE_FOCUS_LAYOUT_ID
    )

    rerender({
      session: makeSession(
        's1',
        SINGLE_PANE_FOCUS_LAYOUT_ID,
        ['p0', 'p1', 'p2'],
        2
      ),
    })
    fire('\\', shortcutModifiersFor('ctrl'))
    expect(setSessionLayout).toHaveBeenLastCalledWith('s1', 'vsplit')

    setSessionLayout.mockClear()
    rerender({
      session: makeSession(
        's1',
        SINGLE_PANE_FOCUS_LAYOUT_ID,
        ['p0', 'p1', 'p2'],
        2
      ),
    })

    const event = fire('z', shortcutModifiersFor('ctrl'))

    expect(setSessionLayout).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })

  test('Shift+Mod+Z does not switch layout', () => {
    const setSessionLayout = vi.fn()
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'grid3x2', ['p0', 'p1'])],
        activeSessionId: 's1',
        setSessionActivePane: vi.fn(),
        setSessionLayout,
        matches: ctrlMatches,
      })
    )

    const event = fire('z', { ...shortcutModifiersFor('ctrl'), shiftKey: true })

    expect(setSessionLayout).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })

  test('Ctrl+2 with only one pane is a no-op AND lets the event propagate', () => {
    // Out-of-range pane index: we deliberately do NOT preventDefault so
    // that terminal apps (vim buffers, tmux windows) can claim Cmd+N
    // when there's no pane to focus. The toolbar advertises "⌘+1-4
    // focus pane" — claiming a slot we can't fill would silently
    // swallow user input with no visible action.
    const setSessionActivePane = vi.fn()
    renderPane({
      sessions: [makeSession('s1', 'single', ['p0'])],
      activeSessionId: 's1',
      setSessionActivePane,
      setSessionLayout: vi.fn(),
    })

    const event = fire('2', { ctrlKey: true })

    expect(setSessionActivePane).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })

  test('Ctrl+Alt+1 still claims the slot — Alt is not rejected (non-US-layout accommodation)', () => {
    // Codex P2 (cycle 3): non-US layouts deliver Backslash as
    // Ctrl+AltGr+key (browsers usually surface AltGr as altKey). We
    // can't reject alt/shift without breaking those users — so Ctrl+
    // Alt+1 also fires our shortcut when there's a focus change to
    // perform. Fixture has p1 active so Cmd+1 targets the INACTIVE
    // p0 — the cycle-6 already-active escape-hatch (let key
    // propagate when no focus change) doesn't apply here.
    const setSessionActivePane = vi.fn()
    renderPane({
      sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'], 1)],
      activeSessionId: 's1',
      setSessionActivePane,
      setSessionLayout: vi.fn(),
    })

    const event = fire('1', { ctrlKey: true, altKey: true })

    expect(setSessionActivePane).toHaveBeenCalledOnce()
    expect(setSessionActivePane).toHaveBeenCalledWith('s1', 'p0')
    expect(event.preventDefaultSpy).toHaveBeenCalled()
  })

  test('Ctrl+Shift+\\ on a US layout cycles layout (non-US layouts depend on this)', () => {
    // QWERTZ users press Shift to access `\`; we must accept the
    // shift modifier or the shortcut is unreachable for them.
    const setSessionLayout = vi.fn()
    renderPane({
      sessions: [makeSession('s1', 'single', ['p0'])],
      activeSessionId: 's1',
      setSessionActivePane: vi.fn(),
      setSessionLayout,
    })

    const event = fire('\\', { ctrlKey: true, shiftKey: true })

    expect(setSessionLayout).toHaveBeenCalledOnce()
    expect(setSessionLayout).toHaveBeenCalledWith('s1', 'vsplit')
    expect(event.preventDefaultSpy).toHaveBeenCalled()
  })

  test('no modifier is a no-op and does not prevent default', () => {
    const setSessionActivePane = vi.fn()
    renderPane({
      sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'])],
      activeSessionId: 's1',
      setSessionActivePane,
      setSessionLayout: vi.fn(),
    })

    const event = fire('2')

    expect(setSessionActivePane).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })

  test('activeSessionId=null is a no-op', () => {
    const setSessionLayout = vi.fn()
    renderPane({
      sessions: [makeSession('s1', 'single', ['p0'])],
      activeSessionId: null,
      setSessionActivePane: vi.fn(),
      setSessionLayout,
    })

    fire('\\', { ctrlKey: true })

    expect(setSessionLayout).not.toHaveBeenCalled()
  })

  test('unmount removes the listener', () => {
    const setSessionLayout = vi.fn()

    const { unmount } = renderPane({
      sessions: [makeSession('s1', 'single', ['p0'])],
      activeSessionId: 's1',
      setSessionActivePane: vi.fn(),
      setSessionLayout,
    })

    unmount()
    fire('\\', { ctrlKey: true })

    expect(setSessionLayout).not.toHaveBeenCalled()
  })

  test('Ctrl+2 with active p0 and two panes focuses p1', () => {
    const setSessionActivePane = vi.fn()
    renderPane({
      sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'])],
      activeSessionId: 's1',
      setSessionActivePane,
      setSessionLayout: vi.fn(),
    })

    fire('2', { ctrlKey: true })

    expect(setSessionActivePane).toHaveBeenCalledOnce()
    expect(setSessionActivePane).toHaveBeenCalledWith('s1', 'p1')
  })

  test('Ctrl+1 with already-active p0 lets the event propagate (no preventDefault)', () => {
    // The shortcut's job is to MOVE focus. When the target is already
    // active (the common single-pane case where Cmd+1 always targets
    // pane 0), intercepting would permanently swallow Ctrl+1 from
    // every terminal app the user runs inside the pane — REPLs, vim,
    // etc. Ownership of the keystroke belongs to the terminal app
    // when no focus change would occur. Codex / Claude reached the
    // same conclusion in round 6 of /lifeline:upsource-review.
    const setSessionActivePane = vi.fn()
    renderPane({
      sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'])],
      activeSessionId: 's1',
      setSessionActivePane,
      setSessionLayout: vi.fn(),
    })

    const event = fire('1', { ctrlKey: true })

    expect(setSessionActivePane).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })

  test('Mac (preferModifier=meta): Cmd+\\ fires; Ctrl+\\ flows through', () => {
    // Codex P2 (cycle 10): match exactly the modifier the toolbar
    // advertises. On macOS the hint shows ⌘, so Ctrl+\ must NOT
    // claim the slot — otherwise terminal apps that rely on Ctrl-
    // shortcuts (vim, readline) silently lose them.
    const setSessionLayout = vi.fn()
    renderPane({
      sessions: [makeSession('s1', 'single', ['p0'])],
      activeSessionId: 's1',
      setSessionActivePane: vi.fn(),
      setSessionLayout,
      matches: metaMatches,
    })

    // Cmd+\ fires (Mac-displayed modifier matches)
    const cmdEvent = fire('\\', { metaKey: true })
    expect(setSessionLayout).toHaveBeenCalledOnce()
    expect(setSessionLayout).toHaveBeenCalledWith('s1', 'vsplit')
    expect(cmdEvent.preventDefaultSpy).toHaveBeenCalled()

    setSessionLayout.mockClear()

    // Ctrl+\ flows through (NOT the displayed modifier on Mac)
    const ctrlEvent = fire('\\', { ctrlKey: true })
    expect(setSessionLayout).not.toHaveBeenCalled()
    expect(ctrlEvent.preventDefaultSpy).not.toHaveBeenCalled()
  })

  test('Linux default (preferModifier=ctrl): Cmd+\\ flows through', () => {
    // Symmetric to the Mac test. On Linux/Windows the hint shows
    // Ctrl, so Cmd+\ does NOT claim the slot.
    const setSessionLayout = vi.fn()
    renderPane({
      sessions: [makeSession('s1', 'single', ['p0'])],
      activeSessionId: 's1',
      setSessionActivePane: vi.fn(),
      setSessionLayout,
      // preferModifier defaults to 'ctrl'
    })

    const event = fire('\\', { metaKey: true })

    expect(setSessionLayout).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })

  test('Ctrl+\\ with an unknown persisted layout is a no-op (no silent reset)', () => {
    // Persisted sessions can carry a layout id that no longer exists
    // in LAYOUTS (e.g., the id was renamed between app versions). The
    // hook treats indexOf === -1 as a no-op so the user's stale layout
    // stays put and they can recover via the LayoutSwitcher buttons —
    // a naive `(currentIndex + 1) % length` cycle would silently
    // wrap to LAYOUT_CYCLE[0] (= 'single') instead.
    const setSessionLayout = vi.fn()

    const sessionWithBadLayout = {
      ...makeSession('s1', 'single', ['p0']),
      layout: 'invalid-old-layout' as LayoutId,
    }
    renderPane({
      sessions: [sessionWithBadLayout],
      activeSessionId: 's1',
      setSessionActivePane: vi.fn(),
      setSessionLayout,
    })

    const event = fire('\\', { ctrlKey: true })

    expect(setSessionLayout).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })
})

describe('usePaneShortcuts container reclaim extensions', () => {
  const attachFakeDock = (): HTMLElement => {
    const element = document.createElement('div')
    element.setAttribute('data-container-id', 'dock')
    element.setAttribute('tabindex', '-1')
    document.body.appendChild(element)
    element.focus()

    return element
  }

  const removeFakeDock = (element: HTMLElement): void => {
    document.body.removeChild(element)
  }

  const blurActiveElement = (): void => {
    const activeElement = document.activeElement as HTMLElement | null
    activeElement?.blur?.()
  }

  test('Ctrl+1 from focused dock consumes key and calls onTerminalZoneFocus', () => {
    const onTerminalZoneFocus = vi.fn()
    const dockElement = attachFakeDock()

    renderPane({
      sessions: [makeSession('s1', 'single', ['p0'])],
      activeSessionId: 's1',
      setSessionActivePane: vi.fn(),
      setSessionLayout: vi.fn(),
      isTerminalContainerActive: false,
      onTerminalZoneFocus,
    })

    const event = fire('1', { ctrlKey: true })

    expect(onTerminalZoneFocus).toHaveBeenCalledOnce()
    expect(event.preventDefaultSpy).toHaveBeenCalled()

    removeFakeDock(dockElement)
  })

  test('Mod+Z from focused dock passes through to focused controls', () => {
    const setSessionLayout = vi.fn()
    const dockElement = attachFakeDock()

    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'])],
        activeSessionId: 's1',
        setSessionActivePane: vi.fn(),
        setSessionLayout,
        isTerminalContainerActive: false,
        onTerminalZoneFocus: vi.fn(),
        matches: ctrlMatches,
      })
    )

    const event = fire('z', shortcutModifiersFor('ctrl'))

    expect(setSessionLayout).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()

    removeFakeDock(dockElement)
  })

  test('Mod+Z inside xterm helper textarea passes through to terminal input', () => {
    const setSessionLayout = vi.fn()
    const textarea = document.createElement('textarea')
    textarea.className = 'xterm-helper-textarea'
    document.body.appendChild(textarea)
    textarea.focus()

    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'])],
        activeSessionId: 's1',
        setSessionActivePane: vi.fn(),
        setSessionLayout,
        isTerminalContainerActive: true,
        onTerminalZoneFocus: vi.fn(),
        matches: ctrlMatches,
      })
    )

    const event = fire('z', shortcutModifiersFor('ctrl'))

    expect(setSessionLayout).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()

    document.body.removeChild(textarea)
  })

  test('Ctrl+1 from stale dock state outside dock passes through', () => {
    const onTerminalZoneFocus = vi.fn()
    blurActiveElement()

    renderPane({
      sessions: [makeSession('s1', 'single', ['p0'])],
      activeSessionId: 's1',
      setSessionActivePane: vi.fn(),
      setSessionLayout: vi.fn(),
      isTerminalContainerActive: false,
      onTerminalZoneFocus,
    })

    const event = fire('1', { ctrlKey: true })

    expect(onTerminalZoneFocus).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })

  test('Ctrl+1 in a dialog passes through regardless of container state', () => {
    const onTerminalZoneFocus = vi.fn()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const inner = document.createElement('button')
    dialog.appendChild(inner)
    document.body.appendChild(dialog)
    inner.focus()

    renderPane({
      sessions: [makeSession('s1', 'single', ['p0'])],
      activeSessionId: 's1',
      setSessionActivePane: vi.fn(),
      setSessionLayout: vi.fn(),
      isTerminalContainerActive: false,
      onTerminalZoneFocus,
    })

    const event = fire('1', { ctrlKey: true })

    expect(onTerminalZoneFocus).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()

    document.body.removeChild(dialog)
  })

  test('Ctrl+1 on active pane inside xterm helper textarea passes through', () => {
    const onTerminalZoneFocus = vi.fn()
    const textarea = document.createElement('textarea')
    textarea.className = 'xterm-helper-textarea'
    document.body.appendChild(textarea)
    textarea.focus()

    renderPane({
      sessions: [makeSession('s1', 'single', ['p0'])],
      activeSessionId: 's1',
      setSessionActivePane: vi.fn(),
      setSessionLayout: vi.fn(),
      isTerminalContainerActive: true,
      onTerminalZoneFocus,
    })

    const event = fire('1', { ctrlKey: true })

    expect(onTerminalZoneFocus).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()

    document.body.removeChild(textarea)
  })

  test('Ctrl+1 on active pane outside xterm reclaims terminal focus', () => {
    const onTerminalZoneFocus = vi.fn()
    blurActiveElement()

    renderPane({
      sessions: [makeSession('s1', 'single', ['p0'])],
      activeSessionId: 's1',
      setSessionActivePane: vi.fn(),
      setSessionLayout: vi.fn(),
      isTerminalContainerActive: true,
      onTerminalZoneFocus,
    })

    const event = fire('1', { ctrlKey: true })

    expect(onTerminalZoneFocus).toHaveBeenCalledOnce()
    expect(event.preventDefaultSpy).toHaveBeenCalled()
  })

  test('Ctrl+1 from dock with vsplit (pane 1 active): calls onTerminalZoneFocus but does NOT switch pane', () => {
    const onTerminalZoneFocus = vi.fn()
    const setSessionActivePane = vi.fn()
    const dockEl = attachFakeDock()
    dockEl.focus()

    renderPane({
      sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'], 1)], // p1 is active
      activeSessionId: 's1',
      setSessionActivePane,
      setSessionLayout: vi.fn(),
      isTerminalContainerActive: false,
      onTerminalZoneFocus,
    })

    const event = fire('1', { ctrlKey: true })

    // Focus is reclaimed — container callback fired
    expect(onTerminalZoneFocus).toHaveBeenCalledOnce()
    expect(event.preventDefaultSpy).toHaveBeenCalled()

    // But pane should NOT be switched — the return prevents fallthrough
    expect(setSessionActivePane).not.toHaveBeenCalled()

    removeFakeDock(dockEl)
  })

  test('omitted reclaim params preserve already-active pass-through behavior', () => {
    const setSessionActivePane = vi.fn()

    renderPane({
      sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'])],
      activeSessionId: 's1',
      setSessionActivePane,
      setSessionLayout: vi.fn(),
    })

    const event = fire('1', { ctrlKey: true })

    expect(setSessionActivePane).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })
})

describe('directional focus (Ctrl/Cmd+Shift+Arrow)', () => {
  test('vsplit active p0 Ctrl+Shift+Right focuses p1 and prevents default', () => {
    const setSessionActivePane = vi.fn()
    renderPane({
      sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'])],
      activeSessionId: 's1',
      setSessionActivePane,
      setSessionLayout: vi.fn(),
      isTerminalContainerActive: true,
    })

    const event = fire('ArrowRight', {
      ctrlKey: true,
      shiftKey: true,
      code: 'ArrowRight',
    })

    expect(setSessionActivePane).toHaveBeenCalledOnce()
    expect(setSessionActivePane).toHaveBeenCalledWith('s1', 'p1')
    expect(event.preventDefaultSpy).toHaveBeenCalled()
  })

  test('vsplit active p0 plain Ctrl+Right (no Shift) passes through to terminal', () => {
    // Ctrl+Arrow is common terminal input (readline word movement, vim/tmux
    // bindings). The directional pane shortcut requires Shift on Ctrl
    // platforms so terminal programs keep the bare chord.
    const setSessionActivePane = vi.fn()
    renderPane({
      sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'])],
      activeSessionId: 's1',
      setSessionActivePane,
      setSessionLayout: vi.fn(),
      isTerminalContainerActive: true,
    })

    const event = fire('ArrowRight', {
      ctrlKey: true,
      code: 'ArrowRight',
    })

    expect(setSessionActivePane).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })

  test('Mac vsplit active p0 plain Cmd+Right (no Shift) passes through', () => {
    // The Shift requirement applies on macOS too so the advertised chord
    // matches the design doc: ⌘+Shift+Arrow focuses panes; bare ⌘+Arrow is
    // left for editor line/document navigation.
    const setSessionActivePane = vi.fn()
    renderPane({
      sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'])],
      activeSessionId: 's1',
      setSessionActivePane,
      setSessionLayout: vi.fn(),
      isTerminalContainerActive: true,
      matches: metaMatches,
    })

    const event = fire('ArrowRight', {
      metaKey: true,
      code: 'ArrowRight',
    })

    expect(setSessionActivePane).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })

  test('directional focus is suppressed while a dialog is open', () => {
    const setSessionActivePane = vi.fn()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)

    renderPane({
      sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'])],
      activeSessionId: 's1',
      setSessionActivePane,
      setSessionLayout: vi.fn(),
      isTerminalContainerActive: true,
    })

    const event = fire('ArrowRight', {
      ctrlKey: true,
      shiftKey: true,
      code: 'ArrowRight',
    })

    expect(setSessionActivePane).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()

    document.body.removeChild(dialog)
  })

  test('single active p0 Ctrl+Shift+Right at edge claims the shortcut', () => {
    // No neighbor exists, but the chord is recognized as an app-level pane-
    // navigation shortcut after the container/dialog guards pass, so we
    // prevent it from falling through to xterm and reaching the PTY.
    const setSessionActivePane = vi.fn()
    renderPane({
      sessions: [makeSession('s1', 'single', ['p0'])],
      activeSessionId: 's1',
      setSessionActivePane,
      setSessionLayout: vi.fn(),
      isTerminalContainerActive: true,
    })

    const event = fire('ArrowRight', {
      ctrlKey: true,
      shiftKey: true,
      code: 'ArrowRight',
    })

    expect(setSessionActivePane).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).toHaveBeenCalled()
  })

  test('hsplit active p0 Ctrl+Shift+Down focuses p1', () => {
    const setSessionActivePane = vi.fn()
    renderPane({
      sessions: [makeSession('s1', 'hsplit', ['p0', 'p1'])],
      activeSessionId: 's1',
      setSessionActivePane,
      setSessionLayout: vi.fn(),
      isTerminalContainerActive: true,
    })

    fire('ArrowDown', {
      ctrlKey: true,
      shiftKey: true,
      code: 'ArrowDown',
    })

    expect(setSessionActivePane).toHaveBeenCalledOnce()
    expect(setSessionActivePane).toHaveBeenCalledWith('s1', 'p1')
  })

  test('quad active p0 Ctrl+Shift+Down focuses p2', () => {
    const setSessionActivePane = vi.fn()
    renderPane({
      sessions: [makeSession('s1', 'quad', ['p0', 'p1', 'p2', 'p3'])],
      activeSessionId: 's1',
      setSessionActivePane,
      setSessionLayout: vi.fn(),
      isTerminalContainerActive: true,
    })

    fire('ArrowDown', {
      ctrlKey: true,
      shiftKey: true,
      code: 'ArrowDown',
    })

    expect(setSessionActivePane).toHaveBeenCalledOnce()
    expect(setSessionActivePane).toHaveBeenCalledWith('s1', 'p2')
  })

  test('quad active p0 Ctrl+Shift+Right focuses p1', () => {
    const setSessionActivePane = vi.fn()
    renderPane({
      sessions: [makeSession('s1', 'quad', ['p0', 'p1', 'p2', 'p3'])],
      activeSessionId: 's1',
      setSessionActivePane,
      setSessionLayout: vi.fn(),
      isTerminalContainerActive: true,
    })

    fire('ArrowRight', {
      ctrlKey: true,
      shiftKey: true,
      code: 'ArrowRight',
    })

    expect(setSessionActivePane).toHaveBeenCalledOnce()
    expect(setSessionActivePane).toHaveBeenCalledWith('s1', 'p1')
  })

  test('vsplit over-capacity: active pane beyond prefix resolves against visible slots', () => {
    // 3 panes in a 2-slot vsplit, active at index 2. SplitView renders
    // [p0, p2] in slots p0/p1. The active pane is at visible slot 1, so
    // ArrowLeft should move to visible slot 0 (pane p0) — not fail because
    // p3 isn't in the grid.
    const setSessionActivePane = vi.fn()
    renderPane({
      sessions: [makeSession('s1', 'vsplit', ['p0', 'p1', 'p2'], 2)],
      activeSessionId: 's1',
      setSessionActivePane,
      setSessionLayout: vi.fn(),
      isTerminalContainerActive: true,
    })

    fire('ArrowLeft', {
      ctrlKey: true,
      shiftKey: true,
      code: 'ArrowLeft',
    })

    expect(setSessionActivePane).toHaveBeenCalledOnce()
    expect(setSessionActivePane).toHaveBeenCalledWith('s1', 'p0')
  })

  test('Ctrl+Shift+Arrow passes through when terminal container is not active', () => {
    const setSessionActivePane = vi.fn()
    const dockElement = document.createElement('div')
    dockElement.setAttribute('data-container-id', 'dock')
    dockElement.setAttribute('tabindex', '-1')
    document.body.appendChild(dockElement)
    dockElement.focus()

    renderPane({
      sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'])],
      activeSessionId: 's1',
      setSessionActivePane,
      setSessionLayout: vi.fn(),
      isTerminalContainerActive: false,
    })

    const event = fire('ArrowRight', {
      ctrlKey: true,
      shiftKey: true,
      code: 'ArrowRight',
    })

    expect(setSessionActivePane).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()

    document.body.removeChild(dockElement)
  })

  test('Ctrl+Shift+Arrow passes through when container-active guard is omitted', () => {
    // The directional handler defaults to safe: if no caller vouches that the
    // terminal container owns focus, the shortcut must not claim the key.
    const setSessionActivePane = vi.fn()
    renderPane({
      sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'])],
      activeSessionId: 's1',
      setSessionActivePane,
      setSessionLayout: vi.fn(),
    })

    const event = fire('ArrowRight', {
      ctrlKey: true,
      shiftKey: true,
      code: 'ArrowRight',
    })

    expect(setSessionActivePane).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })
})

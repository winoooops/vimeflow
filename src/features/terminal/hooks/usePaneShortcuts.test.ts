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

describe('usePaneShortcuts', () => {
  test('Ctrl+\\ from single cycles to vsplit and prevents default (default modifier)', () => {
    const setSessionLayout = vi.fn()
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'single', ['p0'])],
        activeSessionId: 's1',
        setSessionActivePane: vi.fn(),
        setSessionLayout,
      })
    )

    const event = fire('\\', { ctrlKey: true })

    expect(setSessionLayout).toHaveBeenCalledOnce()
    expect(setSessionLayout).toHaveBeenCalledWith('s1', 'vsplit')
    expect(event.preventDefaultSpy).toHaveBeenCalled()
  })

  test('Ctrl+\\ from quad wraps to single (default modifier)', () => {
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

  test('Ctrl+2 with only one pane is a no-op AND lets the event propagate', () => {
    // Out-of-range pane index: we deliberately do NOT preventDefault so
    // that terminal apps (vim buffers, tmux windows) can claim Cmd+N
    // when there's no pane to focus. The toolbar advertises "⌘+1-4
    // focus pane" — claiming a slot we can't fill would silently
    // swallow user input with no visible action.
    const setSessionActivePane = vi.fn()
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'single', ['p0'])],
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
      })
    )

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
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'], 1)],
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
      })
    )

    const event = fire('1', { ctrlKey: true, altKey: true })

    expect(setSessionActivePane).toHaveBeenCalledOnce()
    expect(setSessionActivePane).toHaveBeenCalledWith('s1', 'p0')
    expect(event.preventDefaultSpy).toHaveBeenCalled()
  })

  test('Ctrl+Shift+\\ on a US layout cycles layout (non-US layouts depend on this)', () => {
    // QWERTZ users press Shift to access `\`; we must accept the
    // shift modifier or the shortcut is unreachable for them.
    const setSessionLayout = vi.fn()
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'single', ['p0'])],
        activeSessionId: 's1',
        setSessionActivePane: vi.fn(),
        setSessionLayout,
      })
    )

    const event = fire('\\', { ctrlKey: true, shiftKey: true })

    expect(setSessionLayout).toHaveBeenCalledOnce()
    expect(setSessionLayout).toHaveBeenCalledWith('s1', 'vsplit')
    expect(event.preventDefaultSpy).toHaveBeenCalled()
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

    fire('\\', { ctrlKey: true })

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
    fire('\\', { ctrlKey: true })

    expect(setSessionLayout).not.toHaveBeenCalled()
  })

  test('Ctrl+2 with active p0 and two panes focuses p1', () => {
    const setSessionActivePane = vi.fn()
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'])],
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
      })
    )

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
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'])],
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
      })
    )

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
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'single', ['p0'])],
        activeSessionId: 's1',
        setSessionActivePane: vi.fn(),
        setSessionLayout,
        preferModifier: 'meta',
      })
    )

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
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'single', ['p0'])],
        activeSessionId: 's1',
        setSessionActivePane: vi.fn(),
        setSessionLayout,
        // preferModifier defaults to 'ctrl'
      })
    )

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
    renderHook(() =>
      usePaneShortcuts({
        sessions: [sessionWithBadLayout],
        activeSessionId: 's1',
        setSessionActivePane: vi.fn(),
        setSessionLayout,
      })
    )

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

    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'single', ['p0'])],
        activeSessionId: 's1',
        setSessionActivePane: vi.fn(),
        setSessionLayout: vi.fn(),
        isTerminalContainerActive: false,
        onTerminalZoneFocus,
      })
    )

    const event = fire('1', { ctrlKey: true })

    expect(onTerminalZoneFocus).toHaveBeenCalledOnce()
    expect(event.preventDefaultSpy).toHaveBeenCalled()

    removeFakeDock(dockElement)
  })

  test('Ctrl+1 from stale dock state outside dock passes through', () => {
    const onTerminalZoneFocus = vi.fn()
    blurActiveElement()

    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'single', ['p0'])],
        activeSessionId: 's1',
        setSessionActivePane: vi.fn(),
        setSessionLayout: vi.fn(),
        isTerminalContainerActive: false,
        onTerminalZoneFocus,
      })
    )

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

    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'single', ['p0'])],
        activeSessionId: 's1',
        setSessionActivePane: vi.fn(),
        setSessionLayout: vi.fn(),
        isTerminalContainerActive: false,
        onTerminalZoneFocus,
      })
    )

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

    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'single', ['p0'])],
        activeSessionId: 's1',
        setSessionActivePane: vi.fn(),
        setSessionLayout: vi.fn(),
        isTerminalContainerActive: true,
        onTerminalZoneFocus,
      })
    )

    const event = fire('1', { ctrlKey: true })

    expect(onTerminalZoneFocus).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()

    document.body.removeChild(textarea)
  })

  test('Ctrl+1 on active pane outside xterm reclaims terminal focus', () => {
    const onTerminalZoneFocus = vi.fn()
    blurActiveElement()

    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'single', ['p0'])],
        activeSessionId: 's1',
        setSessionActivePane: vi.fn(),
        setSessionLayout: vi.fn(),
        isTerminalContainerActive: true,
        onTerminalZoneFocus,
      })
    )

    const event = fire('1', { ctrlKey: true })

    expect(onTerminalZoneFocus).toHaveBeenCalledOnce()
    expect(event.preventDefaultSpy).toHaveBeenCalled()
  })

  test('Ctrl+1 from dock with vsplit (pane 1 active): calls onTerminalZoneFocus but does NOT switch pane', () => {
    const onTerminalZoneFocus = vi.fn()
    const setSessionActivePane = vi.fn()
    const dockEl = attachFakeDock()
    dockEl.focus()

    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'], 1)], // p1 is active
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
        isTerminalContainerActive: false,
        onTerminalZoneFocus,
      })
    )

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

    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'])],
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
      })
    )

    const event = fire('1', { ctrlKey: true })

    expect(setSessionActivePane).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })
})

describe('directional focus (Ctrl/Cmd+Arrow)', () => {
  test('vsplit active p0 Ctrl+Shift+Right focuses p1 and prevents default', () => {
    const setSessionActivePane = vi.fn()
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'])],
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
        isTerminalContainerActive: true,
      })
    )

    const event = fire('ArrowRight', {
      ctrlKey: true,
      shiftKey: true,
      code: 'ArrowRight',
    })

    expect(setSessionActivePane).toHaveBeenCalledOnce()
    expect(setSessionActivePane).toHaveBeenCalledWith('s1', 'p1')
    expect(event.preventDefaultSpy).toHaveBeenCalled()
  })

  test('vsplit active p0 plain Cmd/Ctrl+Right (no Shift) focuses p1', () => {
    // VIM-104 follow-up: directional nav is now shift-agnostic — plain
    // ⌘/Ctrl+Arrow navigates (Shift no longer required), since the chord has
    // no terminal meaning and the editor/dock is guarded out below.
    const setSessionActivePane = vi.fn()
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'])],
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
        isTerminalContainerActive: true,
      })
    )

    const event = fire('ArrowRight', {
      ctrlKey: true,
      code: 'ArrowRight',
    })

    expect(setSessionActivePane).toHaveBeenCalledOnce()
    expect(setSessionActivePane).toHaveBeenCalledWith('s1', 'p1')
    expect(event.preventDefaultSpy).toHaveBeenCalled()
  })

  test('directional focus is suppressed while a dialog is open', () => {
    const setSessionActivePane = vi.fn()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.appendChild(dialog)

    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'])],
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
        isTerminalContainerActive: true,
      })
    )

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
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'single', ['p0'])],
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
        isTerminalContainerActive: true,
      })
    )

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
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'hsplit', ['p0', 'p1'])],
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
        isTerminalContainerActive: true,
      })
    )

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
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'quad', ['p0', 'p1', 'p2', 'p3'])],
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
        isTerminalContainerActive: true,
      })
    )

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
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'quad', ['p0', 'p1', 'p2', 'p3'])],
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
        isTerminalContainerActive: true,
      })
    )

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
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'vsplit', ['p0', 'p1', 'p2'], 2)],
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
        isTerminalContainerActive: true,
      })
    )

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

    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'])],
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
        isTerminalContainerActive: false,
      })
    )

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
    renderHook(() =>
      usePaneShortcuts({
        sessions: [makeSession('s1', 'vsplit', ['p0', 'p1'])],
        activeSessionId: 's1',
        setSessionActivePane,
        setSessionLayout: vi.fn(),
      })
    )

    const event = fire('ArrowRight', {
      ctrlKey: true,
      shiftKey: true,
      code: 'ArrowRight',
    })

    expect(setSessionActivePane).not.toHaveBeenCalled()
    expect(event.preventDefaultSpy).not.toHaveBeenCalled()
  })
})

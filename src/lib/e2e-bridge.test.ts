// cspell:ignore vsplit
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  dispatchCommandPaletteShortcutForE2e,
  readPaneBuffer,
  registerCommandPaletteShortcutOpenerForE2e,
} from './e2e-bridge'
import { terminalCache } from '../features/terminal/components/TerminalPane/Body'
import type { BackendApi } from './backend'

type CacheEntry = ReturnType<typeof terminalCache.get>

interface MockLine {
  translateToString: (trimRight: boolean) => string
}

interface MockBuffer {
  viewportY: number
  getLine: (i: number) => MockLine | undefined
}

interface MockTerminal {
  rows: number
  buffer: { active: MockBuffer }
}

const makeMockEntry = (rows: readonly string[], viewportY = 0): CacheEntry => {
  const terminal: MockTerminal = {
    rows: rows.length,
    buffer: {
      active: {
        viewportY,
        getLine: (i: number) => {
          const text = rows[i - viewportY]
          if (text === undefined) {
            return undefined
          }

          return {
            translateToString: (trimRight: boolean): string =>
              trimRight ? text.replace(/\s+$/, '') : text,
          }
        },
      },
    },
  }

  return { terminal, fitAddon: {} } as unknown as CacheEntry
}

/**
 * Build a session-level wrapper containing N split-view-slots, each with
 * an inner terminal-pane-wrapper (one carrying `data-pane-active="true"` when
 * `activeIndex` matches) and a `.xterm-rows` child with the provided
 * text content. Mirrors the post-5b DOM shape produced by SplitView →
 * TerminalPane → Body.
 */
const buildSessionWrapper = (
  paneTexts: readonly string[],
  activeIndex: number
): HTMLElement => {
  const sessionWrapper = document.createElement('div')
  sessionWrapper.setAttribute('data-testid', 'terminal-pane')
  sessionWrapper.setAttribute('data-session-id', 'sess-fix')

  const splitView = document.createElement('div')
  splitView.setAttribute('data-testid', 'split-view')
  sessionWrapper.appendChild(splitView)

  paneTexts.forEach((text, i) => {
    const slot = document.createElement('div')
    slot.setAttribute('data-testid', 'split-view-slot')
    slot.setAttribute('data-pane-id', `p${i}`)
    slot.setAttribute('data-pty-id', `pty-${i}`)

    const paneWrapper = document.createElement('div')
    paneWrapper.setAttribute('data-testid', 'terminal-pane-wrapper')
    if (i === activeIndex) {
      paneWrapper.setAttribute('data-pane-active', 'true')
    }

    // Body's inner container — carries data-pty-id (terminalCache key), mirroring production DOM.
    const bodyContainer = document.createElement('div')
    bodyContainer.setAttribute('data-testid', 'terminal-pane')
    bodyContainer.setAttribute('data-pty-id', `pty-${i}`)

    const rows = document.createElement('div')
    rows.className = 'xterm-rows'
    rows.textContent = text

    bodyContainer.appendChild(rows)
    paneWrapper.appendChild(bodyContainer)
    slot.appendChild(paneWrapper)
    splitView.appendChild(slot)
  })

  return sessionWrapper
}

describe('readPaneBuffer', () => {
  beforeEach(() => {
    terminalCache.clear()
  })

  afterEach(() => {
    delete window.vimeflow
    vi.unstubAllEnvs()
  })

  test('dispatches command palette shortcut through Electron before renderer fallback', async () => {
    vi.stubEnv('VITE_E2E', '1')

    const rendererOpener = vi.fn()

    const electronDispatch = vi.fn<() => Promise<boolean>>(() =>
      Promise.resolve(true)
    )

    const unregister =
      registerCommandPaletteShortcutOpenerForE2e(rendererOpener)

    window.vimeflow = {
      e2e: {
        dispatchCommandPaletteShortcut: electronDispatch,
      },
    } as unknown as BackendApi

    try {
      await expect(dispatchCommandPaletteShortcutForE2e()).resolves.toBe(true)

      expect(electronDispatch).toHaveBeenCalledOnce()
      expect(rendererOpener).not.toHaveBeenCalled()
    } finally {
      unregister()
    }
  })

  test('falls back to renderer opener when Electron shortcut dispatch is unavailable', async () => {
    vi.stubEnv('VITE_E2E', '1')

    const rendererOpener = vi.fn()

    const unregister =
      registerCommandPaletteShortcutOpenerForE2e(rendererOpener)

    try {
      await expect(dispatchCommandPaletteShortcutForE2e()).resolves.toBe(true)

      expect(rendererOpener).toHaveBeenCalledOnce()
    } finally {
      unregister()
    }
  })

  test('falls back to renderer opener when Electron reports the shortcut unhandled', async () => {
    vi.stubEnv('VITE_E2E', '1')

    const rendererOpener = vi.fn()

    const electronDispatch = vi.fn<() => Promise<boolean>>(() =>
      Promise.resolve(false)
    )

    const unregister =
      registerCommandPaletteShortcutOpenerForE2e(rendererOpener)

    window.vimeflow = {
      e2e: {
        dispatchCommandPaletteShortcut: electronDispatch,
      },
    } as unknown as BackendApi

    try {
      await expect(dispatchCommandPaletteShortcutForE2e()).resolves.toBe(true)

      expect(electronDispatch).toHaveBeenCalledOnce()
      expect(rendererOpener).toHaveBeenCalledOnce()
    } finally {
      unregister()
    }
  })

  test('returns the focused pane buffer in multi-pane DOM', () => {
    // Three panes; active = index 1. Bug class this catches: a naive
    // `pane.querySelector('.xterm-rows')` would return panes[0]'s buffer.
    const wrapper = buildSessionWrapper(
      ['pane-zero-buf', 'pane-one-buf', 'pane-two-buf'],
      1
    )

    expect(readPaneBuffer(wrapper)).toBe('pane-one-buf')
  })

  test('returns the only pane buffer for a single-pane wrapper', () => {
    const wrapper = buildSessionWrapper(['solo-buf'], 0)

    expect(readPaneBuffer(wrapper)).toBe('solo-buf')
  })

  test('falls back to first .xterm-rows when no pane carries data-pane-active', () => {
    // Defensive case — invariant violation (5a guarantees exactly-one
    // active per session). The function must still return SOMETHING
    // (not throw) so e2e specs don't fail cryptically. Returns the
    // first match in DOM order per legacy semantics.
    const wrapper = buildSessionWrapper(['first-buf', 'second-buf'], -1)

    expect(readPaneBuffer(wrapper)).toBe('first-buf')
  })

  test('returns empty string when no .xterm-rows is present', () => {
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-testid', 'terminal-pane')
    // No inner content — no slot, no xterm-rows.

    expect(readPaneBuffer(wrapper)).toBe('')
  })

  test('reads xterm-rows directly when passed a split-view-slot (pty-id lookup path)', () => {
    // `readTerminalBufferForSession`'s pty-id fallback path resolves to
    // a `split-view-slot`, not the session wrapper. The function must
    // descend into the slot's inner terminal-pane-wrapper just the
    // same.
    const wrapper = buildSessionWrapper(['slot-buf'], 0)

    const slot = wrapper.querySelector<HTMLElement>(
      '[data-testid="split-view-slot"]'
    )

    expect(slot).not.toBeNull()
    expect(readPaneBuffer(slot!)).toBe('slot-buf')
  })

  test('falls back to xterm buffer API when .xterm-rows is empty (canvas renderer path)', () => {
    // Canvas/WebGL renderer leaves .xterm-rows empty. The fallback must reach into terminalCache by PTY id.
    const wrapper = buildSessionWrapper([''], 0)
    terminalCache.set('pty-0', makeMockEntry(['$ echo hi', 'hi', '$ '])!)

    expect(readPaneBuffer(wrapper)).toBe('$ echo hi\nhi\n$')
  })

  test('uses data-pty-id from Body container, not data-session-id from TerminalZone', () => {
    // Production bug class: cache is keyed by pane.ptyId but TerminalZone exposes data-session-id={session.id}.
    const wrapper = buildSessionWrapper([''], 0)
    terminalCache.set('sess-fix', makeMockEntry(['WRONG — session-id key'])!)
    terminalCache.set('pty-0', makeMockEntry(['right — pty-id key'])!)

    expect(readPaneBuffer(wrapper)).toBe('right — pty-id key')
  })

  test('falls-back via descendant search when given an inner terminal-pane-wrapper', () => {
    // resolveCacheKey must descend into the pane-wrapper to find Body's data-pty-id.
    const wrapper = buildSessionWrapper([''], 0)
    terminalCache.set('pty-0', makeMockEntry(['inner-pane-buf'])!)

    const inner = wrapper.querySelector<HTMLElement>(
      '[data-testid="terminal-pane-wrapper"]'
    )

    expect(inner).not.toBeNull()
    expect(readPaneBuffer(inner!)).toBe('inner-pane-buf')
  })

  test('respects viewportY so the fallback returns only the visible viewport, not scrollback', () => {
    // viewportY=5, rows=2 → must return lines 5-6 only (round-1 F1 root cause).
    const wrapper = buildSessionWrapper([''], 0)
    const allRows = Array.from({ length: 7 }, (_, i) => `row-${i}`)
    terminalCache.set('pty-0', makeMockEntry(allRows.slice(5, 7), 5)!)

    expect(readPaneBuffer(wrapper)).toBe('row-5\nrow-6')
  })

  test('returns empty string when .xterm-rows is empty and the cache has no entry', () => {
    // No DOM text AND no cached terminal — the legacy fallback path.
    const wrapper = buildSessionWrapper([''], 0)

    expect(readPaneBuffer(wrapper)).toBe('')
  })
})

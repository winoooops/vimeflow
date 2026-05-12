// cspell:ignore vsplit
import { describe, test, expect } from 'vitest'
import { readPaneBuffer } from './e2e-bridge'

/**
 * Build a session-level wrapper containing N split-view-slots, each with
 * an inner terminal-pane-wrapper (one carrying `data-focused="true"` when
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
      paneWrapper.setAttribute('data-focused', 'true')
    }

    const rows = document.createElement('div')
    rows.className = 'xterm-rows'
    rows.textContent = text

    paneWrapper.appendChild(rows)
    slot.appendChild(paneWrapper)
    splitView.appendChild(slot)
  })

  return sessionWrapper
}

describe('readPaneBuffer', () => {
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

  test('falls back to first .xterm-rows when no pane carries data-focused', () => {
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
})

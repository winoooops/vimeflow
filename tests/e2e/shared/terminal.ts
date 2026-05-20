/**
 * Terminal interaction helpers for the WDIO suite.
 *
 * xterm.js listens for keystrokes on a hidden `.xterm-helper-textarea`.
 * Focus the textarea through the DOM, then drive input with a per-char
 * down → up → pause action chain so xterm receives chars in the order
 * they were authored (see `typeInActiveTerminal` for the reorder
 * incident that motivated the per-char dispatch).
 */

type FocusFailure = 'no_pane' | 'no_textarea' | 'focus_failed'

const focusActiveTerminalTextarea = async (): Promise<void> => {
  const status = await browser.execute<'ok' | FocusFailure, []>(() => {
    const visible = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="terminal-pane"]')
    ).find((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })
    if (!visible) return 'no_pane'
    const textarea = visible.querySelector<HTMLTextAreaElement>(
      '.xterm-helper-textarea'
    )
    if (!textarea) return 'no_textarea'
    textarea.focus()
    return document.activeElement === textarea ? 'ok' : 'focus_failed'
  })
  if (status === 'ok') return
  switch (status) {
    case 'no_pane':
      throw new Error('focusActiveTerminalTextarea: no visible terminal pane')
    case 'no_textarea':
      throw new Error(
        'focusActiveTerminalTextarea: visible pane has no .xterm-helper-textarea'
      )
    case 'focus_failed':
      // textarea exists but focus did not stick — focus was stolen or blocked
      // (e.g. another window stealing focus on a multi-display dev machine).
      throw new Error(
        'focusActiveTerminalTextarea: textarea.focus() did not stick (focus stolen or blocked)'
      )
    default: {
      // TypeScript exhaustiveness check + runtime guard: browser.execute's
      // return type is `any` at runtime, so a future ChromeDriver version
      // or transport change could yield something outside FocusFailure.
      // Without this default, the unexpected value would slip past the
      // switch and silently leave focus unestablished, causing the key
      // action chain in `typeInActiveTerminal` to type into the wrong
      // element.
      const _exhaustive: never = status
      throw new Error(
        `focusActiveTerminalTextarea: unexpected status: ${String(_exhaustive)}`
      )
    }
  }
}

const KEY_PAUSE_MS = 8
const ECHO_VERIFY_TIMEOUT_MS = 5_000

// Check whether the visible terminal buffer contains `text` (bash echo).
// Collapses whitespace before comparison so xterm line-wrapping (prompt +
// long path can exceed the col width and split the echoed string across
// rows) doesn't mask a clean type.
const bufferEchoes = (buffer: string, text: string): boolean => {
  const collapse = (s: string): string => s.replace(/\s+/g, '')
  return collapse(buffer).includes(collapse(text))
}

export const typeInActiveTerminal = async (text: string): Promise<void> => {
  await focusActiveTerminalTextarea()

  // Send each char as a discrete keyDown then keyUp then short pause. The
  // WebdriverIO default `browser.keys(text)` packs every keyDown before
  // every keyUp into a single action; that batched-down delivery has been
  // observed to reorder chars under CI load (run 26017368985, 2026-05-18:
  // the test typed `echo` and bash echoed `ehco`), which silently corrupts
  // paths and commands and surfaces as opaque downstream timeouts. Per-char
  // dispatch with a short pause forces ordered delivery to xterm's keydown
  // handler.
  let chain = browser.action('key')
  for (const char of text) {
    chain = chain.down(char).up(char).pause(KEY_PAUSE_MS)
  }
  await chain.perform()

  // Verify bash echoed the chars back before the caller advances. Catches
  // any remaining reorder/drop with a precise diagnostic instead of letting
  // a misspelled command surface 30s later as a generic waitForDisplayed
  // timeout.
  await browser.waitUntil(
    async () => {
      const buf = await browser.execute(
        () => window.__VIMEFLOW_E2E__?.getTerminalBuffer() ?? ''
      )
      return bufferEchoes(buf, text)
    },
    {
      timeout: ECHO_VERIFY_TIMEOUT_MS,
      timeoutMsg: `typeInActiveTerminal: shell did not echo ${JSON.stringify(text)} within ${ECHO_VERIFY_TIMEOUT_MS}ms`,
    }
  )
}

export const pressEnterInActiveTerminal = async (): Promise<void> => {
  await focusActiveTerminalTextarea()
  // Enter is a single keystroke, no batching hazard. `\uE007` is the W3C
  // WebDriver code point for Enter; ChromeDriver maps it to VK_RETURN.
  await browser.action('key').down('\uE007').up('\uE007').perform()
}

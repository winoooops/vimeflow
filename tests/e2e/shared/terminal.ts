/**
 * Terminal interaction helpers for the WDIO suite.
 *
 * xterm.js listens for keystrokes on a hidden `.xterm-helper-textarea`.
 * Focus the textarea through the DOM, then let WebDriver send ordered
 * key input to the active element.
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
  }
}

export const typeInActiveTerminal = async (text: string): Promise<void> => {
  await focusActiveTerminalTextarea()
  await browser.keys(text)
}

export const pressEnterInActiveTerminal = async (): Promise<void> => {
  await focusActiveTerminalTextarea()
  await browser.keys('\uE007')
}

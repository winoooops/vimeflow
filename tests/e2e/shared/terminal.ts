/**
 * Terminal interaction helpers for the WDIO suite.
 *
 * xterm.js listens for keystrokes on a hidden `.xterm-helper-textarea`.
 * Focus the textarea through the DOM, then let WebDriver send ordered
 * key input to the active element.
 */

const focusActiveTerminalTextarea = async (): Promise<void> => {
  const ok = await browser.execute(() => {
    const visible = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="terminal-pane"]')
    ).find((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0
    })
    if (!visible) return false
    const textarea = visible.querySelector<HTMLTextAreaElement>(
      '.xterm-helper-textarea'
    )
    if (!textarea) return false
    textarea.focus()
    return document.activeElement === textarea
  })
  if (!ok) {
    throw new Error('focusActiveTerminalTextarea: no visible terminal textarea')
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

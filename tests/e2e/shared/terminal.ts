/**
 * Terminal interaction helpers for the WDIO suite.
 *
 * xterm.js listens for keystrokes on a hidden `.xterm-helper-textarea`.
 * WebKitGTK WebDriver's element/click is not implemented, so these helpers
 * manipulate the DOM + dispatch synthetic InputEvents via browser.execute.
 */

export const typeInActiveTerminal = async (text: string): Promise<void> => {
  const ok = await browser.execute((payload: string) => {
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
    // xterm wires its onInput handler to the textarea, so dispatching a
    // trusted-ish InputEvent feeds characters straight into the PTY writer.
    for (const ch of payload) {
      textarea.value = ch
      textarea.dispatchEvent(
        new InputEvent('input', { data: ch, inputType: 'insertText' })
      )
    }
    return true
  }, text)
  if (!ok) {
    throw new Error('typeInActiveTerminal: no visible terminal textarea')
  }
}

export const pressEnterInActiveTerminal = async (): Promise<void> => {
  // xterm treats the Enter key as '\r' on keydown; synthesize that specifically.
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
    const down = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    })
    textarea.dispatchEvent(down)
    return true
  })
  if (!ok) {
    throw new Error('pressEnterInActiveTerminal: no visible terminal textarea')
  }
}

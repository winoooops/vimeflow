export const TERMINAL_FOCUS_SCOPE_ATTRIBUTE = 'data-terminal-focus-scope'

export const TERMINAL_FOCUS_SCOPE_VALUE = 'true'

export const TERMINAL_FOCUS_SCOPE_SELECTOR = `[${TERMINAL_FOCUS_SCOPE_ATTRIBUTE}="${TERMINAL_FOCUS_SCOPE_VALUE}"]`

export const isElementInTerminalFocusScope = (
  element: Element | null
): boolean => Boolean(element?.closest(TERMINAL_FOCUS_SCOPE_SELECTOR))

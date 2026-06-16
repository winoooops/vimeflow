import { describe, expect, test } from 'vitest'
import {
  isElementInTerminalFocusScope,
  TERMINAL_FOCUS_SCOPE_ATTRIBUTE,
  TERMINAL_FOCUS_SCOPE_SELECTOR,
  TERMINAL_FOCUS_SCOPE_VALUE,
} from './terminalFocusScope'

describe('terminalFocusScope', () => {
  test('matches descendants inside a terminal focus scope', () => {
    const scope = document.createElement('div')
    scope.setAttribute(
      TERMINAL_FOCUS_SCOPE_ATTRIBUTE,
      TERMINAL_FOCUS_SCOPE_VALUE
    )
    const child = document.createElement('textarea')
    scope.appendChild(child)
    document.body.appendChild(scope)

    expect(scope.matches(TERMINAL_FOCUS_SCOPE_SELECTOR)).toBe(true)
    expect(isElementInTerminalFocusScope(child)).toBe(true)

    document.body.removeChild(scope)
  })

  test('rejects elements outside a terminal focus scope', () => {
    const element = document.createElement('textarea')
    document.body.appendChild(element)

    expect(isElementInTerminalFocusScope(element)).toBe(false)
    expect(isElementInTerminalFocusScope(null)).toBe(false)

    document.body.removeChild(element)
  })
})

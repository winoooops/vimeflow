import { test, expect } from 'vitest'
import { AGENTS } from '../../agents/registry'
import { BROWSER_IDENTITY } from './browserIdentity'

test('BROWSER_IDENTITY uses the reserved cyan WEB accent', () => {
  expect(BROWSER_IDENTITY.accent).toBe('var(--color-agent-browser-accent)')
  expect(BROWSER_IDENTITY.short).toBe('WEB')
})

test('BROWSER_IDENTITY carries exactly the PaneIdentity fields', () => {
  expect(Object.keys(BROWSER_IDENTITY).sort()).toEqual(
    [
      'accent',
      'accentDim',
      'accentSoft',
      'glyph',
      'name',
      'onAccent',
      'short',
    ].sort()
  )
})

test('the web identity is decoupled from the agent registry', () => {
  expect('web' in AGENTS).toBe(false)
})

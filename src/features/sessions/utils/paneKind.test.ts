import { test, expect } from 'vitest'
import { isShellPane, isBrowserPane } from './paneKind'
import type { Pane } from '../types'

test('isShellPane returns true for shell kind', () => {
  const pane = { kind: 'shell' } as Pane
  expect(isShellPane(pane)).toBe(true)
})

test('isShellPane returns false for browser kind', () => {
  const pane = { kind: 'browser' } as Pane
  expect(isShellPane(pane)).toBe(false)
})

test('isShellPane returns true for undefined kind', () => {
  const pane = {} as Pane
  expect(isShellPane(pane)).toBe(true)
})

test('isBrowserPane returns true for browser kind', () => {
  const pane = { kind: 'browser' } as Pane
  expect(isBrowserPane(pane)).toBe(true)
})

test('isBrowserPane returns false for shell kind', () => {
  const pane = { kind: 'shell' } as Pane
  expect(isBrowserPane(pane)).toBe(false)
})

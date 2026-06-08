import { test, expect } from 'vitest'
import {
  deriveSessionStatus,
  isTerminalStatus,
  isLiveStatus,
} from './sessionStatus'
import type { Pane } from '../types'

const pane = (status: Pane['status']): Pane =>
  ({
    kind: 'shell',
    id: 'p',
    ptyId: 'x',
    cwd: '/',
    agentType: 'generic',
    status,
    active: true,
  }) as Pane

test('precedence: errored beats every other state', () => {
  expect(
    deriveSessionStatus([pane('errored'), pane('idle'), pane('running')])
  ).toBe('errored')
})

test('precedence: awaiting beats running/idle/completed', () => {
  expect(
    deriveSessionStatus([pane('awaiting'), pane('running'), pane('idle')])
  ).toBe('awaiting')
})

test('precedence: running beats idle/completed', () => {
  expect(
    deriveSessionStatus([pane('running'), pane('idle'), pane('completed')])
  ).toBe('running')
})

test('precedence: idle beats completed', () => {
  expect(deriveSessionStatus([pane('idle'), pane('completed')])).toBe('idle')
})

test('all completed folds to completed', () => {
  expect(deriveSessionStatus([pane('completed'), pane('completed')])).toBe(
    'completed'
  )
})

test('empty panes is errored (invariant guard)', () => {
  expect(deriveSessionStatus([])).toBe('errored')
})

test('isTerminalStatus / isLiveStatus partition the union', () => {
  expect(isTerminalStatus('completed')).toBe(true)
  expect(isTerminalStatus('errored')).toBe(true)
  expect(isLiveStatus('running')).toBe(true)
  expect(isLiveStatus('awaiting')).toBe(true)
  expect(isLiveStatus('idle')).toBe(true)
})

import { describe, expect, test } from 'vitest'
import type { Pane } from '../types'
import { deriveSessionStatus } from './sessionStatus'

const pane = (status: Pane['status']): Pane => ({
  id: 'p0',
  ptyId: 'pty-x',
  cwd: '/x',
  agentType: 'generic',
  status,
  active: true,
})

describe('deriveSessionStatus', () => {
  test('any running pane -> running', () => {
    expect(deriveSessionStatus([pane('running'), pane('completed')])).toBe(
      'running'
    )
  })

  test('no running but any errored -> errored', () => {
    expect(deriveSessionStatus([pane('errored'), pane('completed')])).toBe(
      'errored'
    )
  })

  test('all completed -> completed', () => {
    expect(deriveSessionStatus([pane('completed'), pane('completed')])).toBe(
      'completed'
    )
  })

  test('mix of paused and completed without errored -> paused', () => {
    expect(deriveSessionStatus([pane('paused'), pane('completed')])).toBe(
      'paused'
    )
  })

  test('single pane proxies its status', () => {
    expect(deriveSessionStatus([pane('running')])).toBe('running')
  })

  test('empty panes -> errored (5a invariant violation surface)', () => {
    // Sessions must carry >=1 pane per the model. An empty panes[] is a
    // hard bug; surface it as 'errored' rather than vacuously 'completed'
    // (Array.every of an empty array is true).
    expect(deriveSessionStatus([])).toBe('errored')
  })
})

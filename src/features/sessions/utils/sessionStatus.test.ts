import { describe, expect, test } from 'vitest'
import type { Pane } from '../types'
import { deriveSessionStatus, deriveShellSessionStatus } from './sessionStatus'

const pane = (status: Pane['status']): Pane => ({
  id: 'p0',
  ptyId: 'pty-x',
  cwd: '/x',
  agentType: 'generic',
  status,
  active: true,
})

const browserPane = (status: Pane['status']): Pane => ({
  ...pane(status),
  kind: 'browser',
  id: 'p-browser',
  ptyId: 'browser:x',
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

  test('a live browser keeps a mixed session running despite placeholder shells', () => {
    // The shell came back as a completed placeholder (graceful-quit restore)
    // but the browser pane is live — the session is 'running', not 'completed'
    // (spec §5 "Restored session status").
    expect(
      deriveShellSessionStatus([pane('completed'), browserPane('running')])
    ).toBe('running')
  })

  test('shell-only placeholders with no browser -> completed', () => {
    // No browser pane and every shell is a completed placeholder: the session
    // is 'completed' so its panes show the Restart affordance.
    expect(
      deriveShellSessionStatus([pane('completed'), pane('completed')])
    ).toBe('completed')
  })

  test('a running shell keeps the session running alongside a browser', () => {
    expect(
      deriveShellSessionStatus([pane('running'), browserPane('running')])
    ).toBe('running')
  })

  test('browser-only liveness derives from browser panes (running, not errored)', () => {
    // All shells closed but a browser pane is live: the session is 'running',
    // not the empty-slice 'errored' guard (which would show a stale Restart
    // affordance for a session whose browser pane is still running).
    expect(deriveShellSessionStatus([browserPane('running')])).toBe('running')
  })
})

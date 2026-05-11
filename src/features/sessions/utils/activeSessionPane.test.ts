import { describe, expect, test } from 'vitest'
import type { Session } from '../types'
import { getActivePane } from './activeSessionPane'

const session = (panes: { id: string; active: boolean }[]): Session =>
  ({
    id: 'sess-1',
    panes,
  }) as unknown as Session

describe('getActivePane', () => {
  test('returns the single active pane', () => {
    const s = session([
      { id: 'p0', active: true },
      { id: 'p1', active: false },
    ])
    expect(getActivePane(s).id).toBe('p0')
  })

  test('throws when zero panes are active', () => {
    const s = session([
      { id: 'p0', active: false },
      { id: 'p1', active: false },
    ])
    expect(() => getActivePane(s)).toThrow(/exactly one active pane/)
  })

  test('throws when more than one pane is active', () => {
    const s = session([
      { id: 'p0', active: true },
      { id: 'p1', active: true },
    ])
    expect(() => getActivePane(s)).toThrow(/exactly one active pane/)
  })

  test('throws when panes is empty', () => {
    const s = session([])
    expect(() => getActivePane(s)).toThrow(/at least one pane/)
  })
})

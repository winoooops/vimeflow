import { describe, expect, test } from 'vitest'
import { commandToPane } from './commandToPane'

describe('commandToPane', () => {
  test('browser maps to a browser pane', () => {
    expect(commandToPane('browser')).toEqual({ kind: 'browser' })
  })

  test('shell maps to a plain shell pane (no label)', () => {
    expect(commandToPane('shell')).toEqual({ kind: 'shell' })
  })

  test('agent commands map to a labeled shell pane', () => {
    expect(commandToPane('claude')).toEqual({ kind: 'shell', userLabel: 'Claude Code' })
    expect(commandToPane('codex')).toEqual({ kind: 'shell', userLabel: 'Codex CLI' })
  })
})

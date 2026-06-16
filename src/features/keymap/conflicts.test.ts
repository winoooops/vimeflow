import { describe, expect, test } from 'vitest'
import { chordsOverlap, contextsOverlap, detectConflicts } from './conflicts'
import type { Chord } from './chord'
import type { CommandId } from './catalog'

const c = (
  code: string,
  ...mods: ('Mod' | 'Ctrl' | 'Shift' | 'Alt')[]
): Chord => ({ code, mods: new Set(mods) })

describe('chordsOverlap', () => {
  test('two tolerant commands on the same key+super always overlap', () => {
    expect(
      chordsOverlap(
        c('Digit1', 'Mod'),
        'tolerant',
        c('Digit1', 'Mod', 'Shift'),
        'tolerant',
        'meta'
      )
    ).toBe(true)
  })

  test('two exact commands differing only by Shift do not overlap', () => {
    expect(
      chordsOverlap(
        c('KeyN', 'Mod'),
        'exact',
        c('KeyN', 'Mod', 'Shift'),
        'exact',
        'meta'
      )
    ).toBe(false)
  })

  test('Mod vs literal Ctrl collide on Linux (ctrl) but not macOS (meta vs ctrl)', () => {
    expect(
      chordsOverlap(
        c('KeyB', 'Mod'),
        'exact',
        c('KeyB', 'Ctrl'),
        'exact',
        'ctrl'
      )
    ).toBe(true)

    expect(
      chordsOverlap(
        c('KeyB', 'Mod'),
        'exact',
        c('KeyB', 'Ctrl'),
        'exact',
        'meta'
      )
    ).toBe(false)
  })
})

describe('contextsOverlap', () => {
  test('global overlaps everything; surfaces are mutually exclusive', () => {
    expect(contextsOverlap('global', 'terminal')).toBe(true)
    expect(contextsOverlap('global', 'browser')).toBe(true)
    expect(contextsOverlap('terminal', 'dock')).toBe(false)
    expect(contextsOverlap('browser', 'terminal')).toBe(false)
    expect(contextsOverlap('diff', 'diff')).toBe(true)
  })
})

describe('detectConflicts', () => {
  test('reports two commands sharing a resolved key + overlapping context', () => {
    const resolved = new Map<CommandId, Chord>([
      ['focus-pane-1', c('Digit1', 'Mod')],
      ['dock-toggle', c('Digit1', 'Mod')], // hand-forced collision
    ])
    const conflicts = detectConflicts(resolved, 'meta')
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].commandIds.sort()).toEqual([
      'dock-toggle',
      'focus-pane-1',
    ])
  })

  test('no conflict when keys differ', () => {
    const resolved = new Map<CommandId, Chord>([
      ['focus-pane-1', c('Digit1', 'Mod')],
      ['focus-pane-2', c('Digit2', 'Mod')],
    ])
    expect(detectConflicts(resolved, 'meta')).toHaveLength(0)
  })

  test('does not report intentionally overlapping fixed reservations', () => {
    const resolved = new Map<CommandId, Chord>([
      ['settings', c('Comma', 'Mod')],
      ['settings-control', c('Comma', 'Ctrl')],
    ])

    expect(detectConflicts(resolved, 'ctrl')).toHaveLength(0)
  })

  test('reports accidental fixed command overlaps outside reserved shadows', () => {
    const resolved = new Map<CommandId, Chord>([
      ['palette', c('KeyN', 'Mod')],
      ['new-session', c('KeyN', 'Mod')],
    ])
    const conflicts = detectConflicts(resolved, 'meta')

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].commandIds.sort()).toEqual(['new-session', 'palette'])
  })
})

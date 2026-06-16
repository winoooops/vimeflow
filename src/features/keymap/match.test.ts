import { describe, expect, test } from 'vitest'
import { eventMatchesChord, type PlatformSuper } from './match'
import { parseChord } from './chord'

const ev = (
  code: string,
  m: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {}
): KeyboardEvent =>
  ({
    code,
    metaKey: !!m.meta,
    ctrlKey: !!m.ctrl,
    shiftKey: !!m.shift,
    altKey: !!m.alt,
  }) as KeyboardEvent

const matches = (
  token: string,
  event: KeyboardEvent,
  superKey: PlatformSuper,
  policy: 'exact' | 'tolerant' = 'exact'
): boolean => eventMatchesChord(event, parseChord(token)!, superKey, policy)

describe('eventMatchesChord — super', () => {
  test('Mod maps to the platform super and forbids the opposite', () => {
    expect(matches('Mod+KeyC', ev('KeyC', { meta: true }), 'meta')).toBe(true)
    expect(
      matches('Mod+KeyC', ev('KeyC', { meta: true, ctrl: true }), 'meta')
    ).toBe(false)
    expect(matches('Mod+KeyC', ev('KeyC', { ctrl: true }), 'ctrl')).toBe(true)
    expect(matches('Mod+KeyC', ev('KeyC', { meta: true }), 'ctrl')).toBe(false)
  })

  test('literal Ctrl requires ctrl and forbids meta on every platform', () => {
    expect(
      matches('Ctrl+Backquote', ev('Backquote', { ctrl: true }), 'meta')
    ).toBe(true)

    expect(
      matches(
        'Ctrl+Backquote',
        ev('Backquote', { ctrl: true, meta: true }),
        'meta'
      )
    ).toBe(false)
  })

  test('wrong code never matches', () => {
    expect(matches('Mod+KeyC', ev('KeyX', { meta: true }), 'meta')).toBe(false)
  })
})

describe('eventMatchesChord — Shift/Alt by policy', () => {
  test('listed Shift is required under both policies', () => {
    expect(
      matches(
        'Mod+Shift+ArrowLeft',
        ev('ArrowLeft', { meta: true, shift: true }),
        'meta'
      )
    ).toBe(true)

    expect(
      matches('Mod+Shift+ArrowLeft', ev('ArrowLeft', { meta: true }), 'meta')
    ).toBe(false)
  })

  test('exact (default): an unlisted Shift/Alt that is down forbids the match', () => {
    expect(
      matches('Mod+KeyN', ev('KeyN', { meta: true, shift: true }), 'meta')
    ).toBe(false)

    expect(
      matches('Mod+KeyN', ev('KeyN', { meta: true, alt: true }), 'meta')
    ).toBe(false)
    expect(matches('Mod+KeyN', ev('KeyN', { meta: true }), 'meta')).toBe(true)
  })

  test('tolerant: an unlisted Shift/Alt is ignored (AZERTY/QWERTZ digits)', () => {
    expect(
      matches(
        'Mod+Digit1',
        ev('Digit1', { meta: true, shift: true }),
        'meta',
        'tolerant'
      )
    ).toBe(true)

    expect(
      matches(
        'Mod+Digit1',
        ev('Digit1', { meta: true, alt: true }),
        'meta',
        'tolerant'
      )
    ).toBe(true)
  })

  test('matches by event.code, not logical event.key (non-Latin layouts)', () => {
    expect(matches('Mod+KeyB', ev('KeyB', { meta: true }), 'meta')).toBe(true)
  })
})

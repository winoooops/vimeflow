import { describe, expect, test } from 'vitest'
import {
  eventToChord,
  isKeymapCaptureTarget,
  KEYMAP_CAPTURE_TARGET_ATTRIBUTE,
} from './capture'

const keydown = (
  code: string,
  init: {
    metaKey?: boolean
    ctrlKey?: boolean
    altKey?: boolean
    shiftKey?: boolean
  } = {}
): KeyboardEvent => new KeyboardEvent('keydown', { code, ...init })

describe('eventToChord', () => {
  test('maps macOS Command to Mod and Control to literal Ctrl', () => {
    expect(
      eventToChord(keydown('KeyK', { metaKey: true, shiftKey: true }), true)
    ).toEqual({
      code: 'KeyK',
      mods: new Set(['Mod', 'Shift']),
    })

    expect(eventToChord(keydown('KeyC', { ctrlKey: true }), true)).toEqual({
      code: 'KeyC',
      mods: new Set(['Ctrl']),
    })
  })

  test('maps non-mac Control to Mod', () => {
    expect(
      eventToChord(keydown('KeyK', { ctrlKey: true, altKey: true }), false)
    ).toEqual({
      code: 'KeyK',
      mods: new Set(['Mod', 'Alt']),
    })
  })

  test('ignores non-mac meta because the runtime matcher uses Control for Mod', () => {
    expect(eventToChord(keydown('KeyK', { metaKey: true }), false)).toEqual({
      code: 'KeyK',
      mods: new Set(),
    })
  })

  test('returns null when the browser event does not expose a physical code', () => {
    expect(eventToChord(keydown(''), false)).toBeNull()
  })

  test('ignores bare modifier and lock key codes', () => {
    for (const code of [
      'ShiftLeft',
      'ShiftRight',
      'ControlLeft',
      'ControlRight',
      'AltLeft',
      'AltRight',
      'MetaLeft',
      'MetaRight',
      'CapsLock',
      'NumLock',
      'ScrollLock',
    ]) {
      expect(eventToChord(keydown(code), false)).toBeNull()
    }
  })
})

describe('isKeymapCaptureTarget', () => {
  test('detects the recorder element and its descendants', () => {
    const recorder = document.createElement('button')
    recorder.setAttribute(KEYMAP_CAPTURE_TARGET_ATTRIBUTE, 'true')
    const child = document.createElement('span')
    recorder.append(child)

    expect(isKeymapCaptureTarget(recorder)).toBe(true)
    expect(isKeymapCaptureTarget(child)).toBe(true)
    expect(isKeymapCaptureTarget(document.createElement('button'))).toBe(false)
    expect(isKeymapCaptureTarget(null)).toBe(false)
  })
})

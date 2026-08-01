// cspell:ignore glsl
import { describe, expect, test } from 'vitest'
import {
  cursorEffectFilename,
  isTerminalCursorEffect,
  TERMINAL_CURSOR_EFFECTS,
} from './cursorEffects'

describe('terminal cursor effects', () => {
  test('allows bundled presets without accepting paths', () => {
    expect(isTerminalCursorEffect('warp')).toBe(true)
    expect(cursorEffectFilename('warp')).toBe('cursor_warp.glsl')
    expect(cursorEffectFilename('off')).toBeUndefined()
    expect(TERMINAL_CURSOR_EFFECTS.map(({ id }) => id)).toEqual([
      'off',
      'warp',
      'sweep',
      'tail',
      'ripple',
      'sonic-boom',
    ])
    expect(isTerminalCursorEffect('../../custom.glsl')).toBe(false)
  })
})

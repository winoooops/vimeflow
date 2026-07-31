// cspell:ignore glsl
export const TERMINAL_CURSOR_EFFECTS = [
  { id: 'off', label: 'Off' },
  { id: 'warp', label: 'Warp' },
  { id: 'sweep', label: 'Sweep' },
  { id: 'tail', label: 'Tail' },
  { id: 'ripple', label: 'Ripple' },
  { id: 'sonic-boom', label: 'Sonic Boom' },
] as const

export type TerminalCursorEffect =
  (typeof TERMINAL_CURSOR_EFFECTS)[number]['id']

const CURSOR_EFFECT_FILENAMES: Partial<Record<TerminalCursorEffect, string>> = {
  warp: 'cursor_warp.glsl',
  sweep: 'cursor_sweep.glsl',
  tail: 'cursor_tail.glsl',
  ripple: 'ripple_cursor.glsl',
  'sonic-boom': 'sonic_boom_cursor.glsl',
}

export const isTerminalCursorEffect = (
  value: unknown
): value is TerminalCursorEffect =>
  TERMINAL_CURSOR_EFFECTS.some((effect) => effect.id === value)

export const cursorEffectFilename = (
  effect: TerminalCursorEffect
): string | undefined => CURSOR_EFFECT_FILENAMES[effect]

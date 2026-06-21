// Shared xterm 256-color resolution. Indices 16-255 (the 6×6×6 color cube and
// the 24-step grayscale ramp) are theme-INDEPENDENT and resolve to fixed RGB.
// Indices 0-15 are theme-dependent and intentionally NOT handled here — each
// renderer resolves them itself (the DOM surface to `var(--terminal-ansi-*)`
// theme tokens, the Electron bridge to the native cell's already-resolved hex).

const XTERM_CUBE_FIRST_INDEX = 16
const XTERM_CUBE_LAST_INDEX = 231
const XTERM_GRAYSCALE_FIRST_INDEX = 232
const XTERM_GRAYSCALE_LAST_INDEX = 255
const XTERM_CUBE_LEVELS = [0, 95, 135, 175, 215, 255] as const
const XTERM_GRAYSCALE_BASE = 8
const XTERM_GRAYSCALE_STEP = 10

export type Rgb = readonly [red: number, green: number, blue: number]

// Resolve an xterm 256-color index in the theme-independent 16-255 range to its
// RGB triple. Returns null for 0-15 (theme-dependent) or out-of-range indices.
export const palette256ToRgb = (index: number): Rgb | null => {
  if (
    !Number.isInteger(index) ||
    index < XTERM_CUBE_FIRST_INDEX ||
    index > XTERM_GRAYSCALE_LAST_INDEX
  ) {
    return null
  }

  if (index <= XTERM_CUBE_LAST_INDEX) {
    const value = index - XTERM_CUBE_FIRST_INDEX

    return [
      XTERM_CUBE_LEVELS[Math.floor(value / 36) % 6],
      XTERM_CUBE_LEVELS[Math.floor(value / 6) % 6],
      XTERM_CUBE_LEVELS[value % 6],
    ]
  }

  const level =
    XTERM_GRAYSCALE_BASE +
    (index - XTERM_GRAYSCALE_FIRST_INDEX) * XTERM_GRAYSCALE_STEP

  return [level, level, level]
}

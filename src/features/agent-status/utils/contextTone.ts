/* eslint-disable vimeflow/no-hardcoded-colors --
   This module is the sanctioned home for computed context-reservoir color —
   the one place colors are derived rather than tokenized. The seafoam -> rose
   fill is a continuous HSL interpolation (no static theme token can express a
   per-percent blend), and the dark/light tank chrome mirrors the reservoir
   handoff's theme-var blocks. See docs/design/context-reservoir-card/. */
// cspell:ignore seafoam lerp

// Single source of truth for the context-reservoir color. Context fill maps to
// ONE continuous seafoam -> gold -> coral -> rose sweep, interpolated in HSL so
// the color blends with the level and never jumps between tiers. Every surface
// that colors context fill (the expanded reservoir card AND the collapsed rail
// meter) reads `ctxTone` so the whole app agrees on the hue at a given percent.
//
// Ported from docs/design/context-reservoir-card/reservoir-cards.jsx — keep the
// stop table and the resolve roles in sync with that handoff.

export type ReservoirTheme = 'dark' | 'light'

export interface ContextTone {
  h: number
  s: number
  l: number
  /** `hsl(...)` body tone at this fill. */
  base: string
  /** Brighter highlight tone (crest / gradient top). */
  hi: string
  /** `r,g,b` triple for `rgb()/rgba()` composition. */
  rgb: string
}

// Role-resolved tone for the card, choosing light- vs dark-mode variants.
export interface ResolvedContextTone {
  rgb: string
  base: string
  hi: string
  /** Darkened, saturated tone for text sitting on the pale water in light mode. */
  deep: string
  fillTop: string
  meniscus: string
  bigNum: string
  label: string
  leftText: string
  pillText: string
}

// Theme-dependent reservoir chrome. The water fill itself stays the translucent
// tone in both themes; only these surfaces flip. Mirrors the `.vf-theme-light`
// CSS-var block in docs/design/context-reservoir-card/Context Reservoir Card.html.
export interface TankChrome {
  /** Recess shade for the empty (dry) part of the tank. */
  dry: string
  rim: string
  pillBg: string
  pillShadow: string
  tick: string
}

interface ToneStop {
  p: number
  h: number
  s: number
  l: number
}

// pct 0 -> 100. Hue is allowed to go negative (-12 ~ 348 deg, a clean rose) so
// coral -> rose decreases through red instead of wrapping back through the
// spectrum.
const TONE_STOPS: readonly ToneStop[] = [
  { p: 0.0, h: 162, s: 50, l: 62 }, // seafoam emerald — calm, plenty of headroom
  { p: 0.5, h: 45, s: 64, l: 66 }, // warm gold — warming
  { p: 0.78, h: 14, s: 76, l: 67 }, // coral — getting tight
  { p: 1.0, h: -12, s: 66, l: 66 }, // rose-red — nearly full
]

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

const pickRgb = (
  hue: number,
  c: number,
  x: number
): [number, number, number] => {
  if (hue < 60) {
    return [c, x, 0]
  }
  if (hue < 120) {
    return [x, c, 0]
  }
  if (hue < 180) {
    return [0, c, x]
  }
  if (hue < 240) {
    return [0, x, c]
  }
  if (hue < 300) {
    return [x, 0, c]
  }

  return [c, 0, x]
}

export const hslToRgb = (h: number, s: number, l: number): string => {
  const hue = ((h % 360) + 360) % 360
  const sat = s / 100
  const lum = l / 100
  const c = (1 - Math.abs(2 * lum - 1)) * sat
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = lum - c / 2
  const [r, g, b] = pickRgb(hue, c, x)

  return [r, g, b].map((v) => Math.round((v + m) * 255)).join(',')
}

const bracket = (p: number): { a: ToneStop; b: ToneStop } => {
  for (let i = 0; i < TONE_STOPS.length - 1; i++) {
    const a = TONE_STOPS[i]
    const b = TONE_STOPS[i + 1]
    if (p >= a.p && p <= b.p) {
      return { a, b }
    }
  }

  return { a: TONE_STOPS[0], b: TONE_STOPS[TONE_STOPS.length - 1] }
}

export const ctxTone = (pct: number): ContextTone => {
  const p = Math.max(0, Math.min(100, pct)) / 100
  const { a, b } = bracket(p)
  const t = b.p === a.p ? 0 : (p - a.p) / (b.p - a.p)
  const h = lerp(a.h, b.h, t)
  const s = lerp(a.s, b.s, t)
  const l = lerp(a.l, b.l, t)

  return {
    h,
    s,
    l,
    base: `hsl(${h.toFixed(1)}, ${s.toFixed(0)}%, ${l.toFixed(0)}%)`,
    hi: `hsl(${h.toFixed(1)}, ${Math.min(100, s + 8).toFixed(0)}%, ${Math.min(94, l + 16).toFixed(0)}%)`,
    rgb: hslToRgb(h, s, l),
  }
}

export const resolveContextTone = (
  pct: number,
  theme: ReservoirTheme
): ResolvedContextTone => {
  const t = ctxTone(pct)
  const light = theme === 'light'
  const deep = `hsl(${t.h.toFixed(1)}, ${Math.min(100, t.s + 12).toFixed(0)}%, ${Math.max(30, t.l - 31).toFixed(0)}%)`

  return {
    rgb: t.rgb,
    base: t.base,
    hi: t.hi,
    deep,
    fillTop: light ? t.base : t.hi, // top stop of the water gradient
    meniscus: light ? deep : t.hi, // the bright crest line
    bigNum: light ? deep : t.base, // header %
    label: light ? deep : t.base, // chip glyph
    leftText: light ? deep : `rgba(${t.rgb}, 0.92)`,
    pillText: light ? deep : t.hi,
  }
}

const DARK_CHROME: TankChrome = {
  dry: 'rgb(5, 5, 12)',
  rim: 'rgba(255, 255, 255, 0.07)',
  pillBg: 'rgba(8, 8, 18, 0.62)',
  pillShadow: 'rgba(0, 0, 0, 0.3)',
  tick: 'rgba(255, 255, 255, 0.32)',
}

const LIGHT_CHROME: TankChrome = {
  dry: 'rgb(184, 183, 196)',
  rim: 'rgba(20, 16, 40, 0.08)',
  pillBg: 'rgba(255, 255, 255, 0.78)',
  pillShadow: 'rgba(40, 34, 70, 0.16)',
  tick: 'rgba(40, 34, 70, 0.34)',
}

export const tankChrome = (theme: ReservoirTheme): TankChrome =>
  theme === 'light' ? LIGHT_CHROME : DARK_CHROME

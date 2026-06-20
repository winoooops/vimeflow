/* eslint-disable vimeflow/no-hardcoded-colors --
   This module is the sanctioned home for the Tool Calls jar's computed tile
   tone — the one place its colors are derived rather than tokenized. The fill
   is a per-tile, usage-driven blend (muted tail -> vivid head) of the active
   theme's accent tokens — a continuous interpolation no static theme token can
   express — and the label color is chosen per tile by relative luminance for
   legible contrast. Mirrors the precedent in contextTone.ts. The blend
   reproduces CSS color-mix(in srgb, ...) exactly (a straight sRGB component
   lerp), so the JS output matches what the equivalent CSS would render. */
// cspell:ignore srgb lerp
import type { ThemeDefinition } from '@/theme/types'

/** The resolved theme tokens the jar tone derives from. */
export interface ToolJarPalette {
  /** Bright accent — the vivid end of the ramp (heavy hitters). */
  primary: string
  /** Neutral surface the muted tail fades toward. */
  surfaceBright: string
  /** Deep accent the gradient darkens toward. */
  primaryDeep: string
}

export interface ToolJarTone {
  /** Perceptual emphasis 0..1 = (count / max) ** 0.42. */
  t: number
  /** Top-of-gradient tile color. */
  base: string
  /** Bottom-of-gradient tile color (darker). */
  bottom: string
  /** `linear-gradient(...)` tile fill. */
  fill: string
  /** Auto-contrast label color for text sitting on the tile. */
  text: string
}

// Locked recipe — demo-validated across Catppuccin / Flexoki / Tokyo Night /
// Dracula. See docs/superpowers/specs/2026-06-19-tool-calls-jar-design.md.
const TONE_EXP = 0.42
const ACCENT_FLOOR = 36
const ACCENT_SPAN = 58
const BASE_DARKEN = 27
const DEEP_MIX = 16
const TEXT_DARK_MIX = 16
const CONTRAST_THRESHOLD = 0.42

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n))

const hexToRgb = (hex: string): [number, number, number] => {
  let h = hex.replace('#', '')
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  }

  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

const rgbToHex = (rgb: readonly [number, number, number]): string =>
  '#' +
  rgb
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')

// color-mix(in srgb, a pa%, b) === a straight sRGB component lerp toward `a`.
const mix = (a: string, b: string, pa: number): string => {
  const ra = hexToRgb(a)
  const rb = hexToRgb(b)
  const t = clamp01(pa / 100)

  return rgbToHex([
    rb[0] + (ra[0] - rb[0]) * t,
    rb[1] + (ra[1] - rb[1]) * t,
    rb[2] + (ra[2] - rb[2]) * t,
  ])
}

const channelLuminance = (channel: number): number => {
  const c = channel / 255

  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

/** WCAG relative luminance (0 = black, 1 = white). */
export const relativeLuminance = (hex: string): number => {
  const [r, g, b] = hexToRgb(hex)

  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  )
}

// White on dark tiles; a near-black, tile-tinted tone on light tiles.
const autoContrastText = (base: string): string =>
  relativeLuminance(base) > CONTRAST_THRESHOLD
    ? mix(base, '#000000', TEXT_DARK_MIX)
    : '#ffffff'

/**
 * Theme-adaptive tile tone. Heavy hitters (t→1) read vivid accent; the tail
 * (t→0) fades toward the neutral surface; both darken toward the deep accent
 * for the gradient. The label color is chosen per tile for contrast.
 */
export const toolJarTone = (
  count: number,
  max: number,
  palette: ToolJarPalette
): ToolJarTone => {
  const t = Math.pow(clamp01(count / Math.max(1, max)), TONE_EXP)
  const accentPct = ACCENT_FLOOR + t * ACCENT_SPAN
  const graded = mix(palette.primary, palette.surfaceBright, accentPct)
  const base = mix(graded, palette.primaryDeep, 100 - BASE_DARKEN)
  const bottom = mix(base, palette.primaryDeep, 100 - DEEP_MIX)

  return {
    t,
    base,
    bottom,
    fill: `linear-gradient(152deg, ${base}, ${bottom})`,
    text: autoContrastText(base),
  }
}

/** Build the jar palette from the active theme definition. */
export const toolJarPalette = (theme: ThemeDefinition): ToolJarPalette => ({
  primary: theme.ui.primary,
  surfaceBright: theme.ui['surface-bright'],
  primaryDeep: theme.ui['primary-deep'],
})

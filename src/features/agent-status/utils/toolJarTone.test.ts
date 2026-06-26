import { describe, expect, test } from 'vitest'
import { obsidianLens } from '@/theme/themes/obsidian-lens'
import { flexoki } from '@/theme/themes/flexoki'
import { relativeLuminance, toolJarPalette, toolJarTone } from './toolJarTone'

// Catppuccin (default) accent tokens, via the real adapter.
const palette = toolJarPalette(obsidianLens)

// Chroma proxy: spread between the brightest and darkest RGB channel.
const chroma = (hex: string): number => {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)

  return Math.max(r, g, b) - Math.min(r, g, b)
}

describe('toolJarTone', () => {
  test('t is the 0.42-compressed usage ratio, clamped to 0..1', () => {
    expect(toolJarTone(100, 100, palette).t).toBeCloseTo(1)
    expect(toolJarTone(0, 100, palette).t).toBe(0)
    expect(toolJarTone(200, 100, palette).t).toBeCloseTo(1)
  })

  test('produces a 152deg gradient of two hex stops', () => {
    const tone = toolJarTone(50, 100, palette)

    expect(tone.fill).toBe(
      `linear-gradient(152deg, ${tone.base}, ${tone.bottom})`
    )
    expect(tone.base).toMatch(/^#[0-9a-f]{6}$/)
    expect(tone.bottom).toMatch(/^#[0-9a-f]{6}$/)
  })

  test('the gradient bottom is darker than the base', () => {
    const tone = toolJarTone(80, 100, palette)

    expect(relativeLuminance(tone.bottom)).toBeLessThan(
      relativeLuminance(tone.base)
    )
  })

  test('muted tail → vivid head: heavy hitters are more saturated', () => {
    const head = toolJarTone(100, 100, palette)
    const tail = toolJarTone(1, 100, palette)

    expect(chroma(head.base)).toBeGreaterThan(chroma(tail.base))
  })

  test('is deterministic', () => {
    expect(toolJarTone(42, 100, palette)).toEqual(toolJarTone(42, 100, palette))
  })

  test('auto-contrast flips text by tile luminance', () => {
    // All-light palette → light base → dark text.
    const lightTile = toolJarTone(100, 100, {
      primary: flexoki.ui.surface,
      surfaceBright: flexoki.ui.surface,
      primaryDeep: flexoki.ui.surface,
    })

    // All-dark palette → dark base → light text.
    const darkTile = toolJarTone(100, 100, {
      primary: obsidianLens.ui['surface-container-lowest'],
      surfaceBright: obsidianLens.ui['surface-container-lowest'],
      primaryDeep: obsidianLens.ui['surface-container-lowest'],
    })

    expect(relativeLuminance(lightTile.text)).toBeLessThan(0.1)
    expect(relativeLuminance(darkTile.text)).toBeGreaterThan(0.9)
  })

  test('Catppuccin jar tiles stay dark enough for legible light text', () => {
    expect(
      relativeLuminance(toolJarTone(542, 542, palette).text)
    ).toBeGreaterThan(0.9)

    expect(
      relativeLuminance(toolJarTone(1, 542, palette).text)
    ).toBeGreaterThan(0.9)
  })
})

describe('toolJarPalette', () => {
  test('reads the accent tokens from a theme definition', () => {
    expect(toolJarPalette(obsidianLens)).toEqual({
      primary: obsidianLens.ui.primary,
      surfaceBright: obsidianLens.ui['surface-bright'],
      primaryDeep: obsidianLens.ui['primary-deep'],
    })
  })
})

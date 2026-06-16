// cspell:ignore seafoam
import { describe, expect, test } from 'vitest'
import {
  ctxTone,
  hslToRgb,
  resolveContextTone,
  tankChrome,
} from './contextTone'

describe('ctxTone', () => {
  test('starts at seafoam emerald when empty', () => {
    expect(ctxTone(0).h).toBeCloseTo(162)
  })

  test('ends at rose-red when full', () => {
    expect(ctxTone(100).h).toBeCloseTo(-12)
  })

  test('hue decreases monotonically as fill rises (seafoam -> rose)', () => {
    const hues = [0, 25, 50, 78, 100].map((p) => ctxTone(p).h)

    for (let i = 1; i < hues.length; i++) {
      expect(hues[i]).toBeLessThan(hues[i - 1])
    }
  })

  test('is continuous — no tier jumps between adjacent percentages', () => {
    // Two nearby percentages differ only slightly; the biggest 1% hue step
    // stays small (a stepped/tiered scale would show a large jump).
    let maxStep = 0
    for (let p = 0; p < 100; p++) {
      maxStep = Math.max(maxStep, Math.abs(ctxTone(p + 1).h - ctxTone(p).h))
    }

    expect(maxStep).toBeLessThan(4)
  })

  test('adjacent percentages produce different but close tones', () => {
    expect(ctxTone(55).base).not.toBe(ctxTone(57).base)
    expect(Math.abs(ctxTone(55).h - ctxTone(57).h)).toBeLessThan(5)
  })

  test('clamps out-of-range input to the endpoints', () => {
    expect(ctxTone(-20)).toEqual(ctxTone(0))
    expect(ctxTone(140)).toEqual(ctxTone(100))
  })

  test('exposes an r,g,b triple for rgba composition', () => {
    expect(ctxTone(56).rgb).toMatch(/^\d{1,3},\d{1,3},\d{1,3}$/)
  })
})

describe('hslToRgb', () => {
  test('converts primary hues', () => {
    expect(hslToRgb(0, 100, 50)).toBe('255,0,0')
    expect(hslToRgb(120, 100, 50)).toBe('0,255,0')
    expect(hslToRgb(240, 100, 50)).toBe('0,0,255')
  })

  test('normalizes negative hue (rose wraps to ~348deg)', () => {
    expect(hslToRgb(-12, 66, 66)).toBe(hslToRgb(348, 66, 66))
  })
})

describe('resolveContextTone', () => {
  test('dark mode keeps the bright/base tones on the water', () => {
    const dark = resolveContextTone(56, 'dark')

    expect(dark.bigNum).toBe(ctxTone(56).base)
    expect(dark.meniscus).toBe(ctxTone(56).hi)
  })

  test('light mode switches on-water text to the darker deep tone', () => {
    const light = resolveContextTone(56, 'light')

    expect(light.bigNum).toBe(light.deep)
    expect(light.meniscus).toBe(light.deep)
    expect(light.pillText).toBe(light.deep)
    expect(light.deep).not.toBe(light.base)
  })
})

describe('tankChrome', () => {
  test('dark and light flip the tank surfaces', () => {
    expect(tankChrome('dark')).not.toEqual(tankChrome('light'))
  })

  test('dark recess is near-black, light pill is near-white', () => {
    expect(tankChrome('dark').dry).toContain('5, 5, 12')
    expect(tankChrome('light').pillBg).toContain('255, 255, 255')
  })
})

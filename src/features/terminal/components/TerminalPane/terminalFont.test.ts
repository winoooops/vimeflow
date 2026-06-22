import { describe, expect, test, vi } from 'vitest'
import {
  DEFAULT_TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  loadTerminalFonts,
  normalizeTerminalFontFamily,
  resolveTerminalFontFamily,
  type TerminalFontLoader,
} from './terminalFont'

describe('terminalFont', () => {
  test('prefers full patched Nerd Font families before the symbol fallback', () => {
    const bundledSymbols = TERMINAL_FONT_FAMILY.indexOf(
      '"Vimeflow Nerd Symbols"'
    )

    const userNerdFont = TERMINAL_FONT_FAMILY.indexOf(
      '"JetBrainsMono Nerd Font"'
    )

    expect(TERMINAL_FONT_FAMILY).toContain('"JetBrains Mono"')
    expect(bundledSymbols).toBeGreaterThan(-1)
    expect(userNerdFont).toBeGreaterThan(-1)
    expect(userNerdFont).toBeLessThan(bundledSymbols)
  })

  test('falls back through platform monospace families', () => {
    expect(TERMINAL_FONT_FAMILY).toContain('Menlo')
    expect(TERMINAL_FONT_FAMILY).toContain('Monaco')
    expect(TERMINAL_FONT_FAMILY).toContain('monospace')
  })

  test('prepends the configured terminal font and preserves fallbacks', () => {
    const family = resolveTerminalFontFamily('Iosevka')

    expect(family.startsWith('"Iosevka",')).toBe(true)
    expect(family).toContain('"JetBrains Mono"')
    expect(family).toContain('"Vimeflow Nerd Symbols"')
    expect(family).toContain('monospace')
  })

  test('deduplicates the configured family against the fallback stack', () => {
    const family = resolveTerminalFontFamily(DEFAULT_TERMINAL_FONT_FAMILY)

    expect(family.match(/"JetBrains Mono"/g)).toHaveLength(1)
  })

  test('normalizes blank terminal font settings to the bundled default', () => {
    expect(normalizeTerminalFontFamily('   ')).toBe(
      DEFAULT_TERMINAL_FONT_FAMILY
    )
  })

  test('loads the text and symbol faces when the Font Loading API is available', async () => {
    const load = vi.fn<FontFaceSet['load']>().mockResolvedValue([])
    const fontLoader: TerminalFontLoader = { load }

    await loadTerminalFonts(fontLoader)

    expect(load).toHaveBeenCalledWith(
      `${TERMINAL_FONT_SIZE}px "JetBrains Mono"`
    )

    expect(load).toHaveBeenCalledWith(
      `${TERMINAL_FONT_SIZE}px "Vimeflow Nerd Symbols"`,
      expect.stringContaining('\ue0b0')
    )

    expect(load).toHaveBeenCalledWith(
      `${TERMINAL_FONT_SIZE}px "Vimeflow Nerd Symbols"`,
      expect.stringContaining(String.fromCodePoint(0xf011b))
    )
  })

  test('skips loading when the Font Loading API is unavailable', () => {
    expect(loadTerminalFonts(null)).toBeNull()
  })
})

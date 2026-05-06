import { describe, test, expect } from 'vitest'
import tailwindConfig from './tailwind.config.js'

describe('Tailwind Config - Obsidian Lens Design Tokens', () => {
  const colors = tailwindConfig.theme.extend.colors

  describe('Primary & Secondary Tokens', () => {
    test('has primary-dim token for subdued icon states', () => {
      expect(colors['primary-dim']).toBe('#d3b9f0')
    })

    test('has secondary-dim token for dimmed accent states', () => {
      expect(colors['secondary-dim']).toBe('#c39eee')
    })

    test('has primary-container token (brand purple)', () => {
      expect(colors['primary-container']).toBe('#cba6f7')
    })
  })

  describe('Semantic & Feedback Tokens', () => {
    test('has success token for agent running status (#50fa7b)', () => {
      expect(colors.success).toBe('#50fa7b')
    })

    test('has success-muted token for diff added lines (#7defa1)', () => {
      expect(colors['success-muted']).toBe('#7defa1')
    })

    test('has tertiary token for warning accents (#ff94a5)', () => {
      expect(colors.tertiary).toBe('#ff94a5')
    })

    test('has tertiary-container token for warning badge backgrounds (#fd7e94)', () => {
      expect(colors['tertiary-container']).toBe('#fd7e94')
    })

    test('has error-dim token for error backgrounds (#d73357)', () => {
      expect(colors['error-dim']).toBe('#d73357')
    })
  })

  describe('Surface Hierarchy Tokens', () => {
    test('has surface-dim token (#121221)', () => {
      expect(colors['surface-dim']).toBe('#121221')
    })

    test('has surface-bright token (#383849)', () => {
      expect(colors['surface-bright']).toBe('#383849')
    })

    test('has surface-container-low token (#1a1a2a)', () => {
      expect(colors['surface-container-low']).toBe('#1a1a2a')
    })

    test('has surface-container token (#1e1e2e)', () => {
      expect(colors['surface-container']).toBe('#1e1e2e')
    })

    test('has surface-container-high token (#292839)', () => {
      expect(colors['surface-container-high']).toBe('#292839')
    })

    test('has surface-container-highest token (#333344)', () => {
      expect(colors['surface-container-highest']).toBe('#333344')
    })
  })

  describe('Typography Tokens', () => {
    test('has headline font family (Manrope)', () => {
      expect(tailwindConfig.theme.extend.fontFamily.headline).toEqual([
        'Manrope',
        'sans-serif',
      ])
    })

    test('has body font family (Inter)', () => {
      expect(tailwindConfig.theme.extend.fontFamily.body).toEqual([
        'Inter',
        'sans-serif',
      ])
    })

    test('has mono font family (JetBrains Mono with ui-monospace fallback)', () => {
      // Updated per handoff §6: adds `ui-monospace` as a fallback before the
      // generic monospace family. No consumer behavior change (browsers fall
      // through unknown family names); aligns with handoff design tokens.
      expect(tailwindConfig.theme.extend.fontFamily.mono).toEqual([
        'JetBrains Mono',
        'ui-monospace',
        'monospace',
      ])
    })
  })

  describe('Border Radius Tokens', () => {
    test('has md radius for buttons/inputs (0.75rem)', () => {
      expect(tailwindConfig.theme.extend.borderRadius.md).toBe('0.75rem')
    })

    test('has lg radius for cards (1rem)', () => {
      expect(tailwindConfig.theme.extend.borderRadius.lg).toBe('1rem')
    })

    test('has xl radius for windows (1.5rem)', () => {
      expect(tailwindConfig.theme.extend.borderRadius.xl).toBe('1.5rem')
    })
  })
})

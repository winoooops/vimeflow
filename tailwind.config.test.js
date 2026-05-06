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

  // Handoff additive tokens — added per
  // docs/superpowers/specs/2026-05-05-ui-handoff-migration-design.md.
  // These tokens are net-new; existing tokens above remain untouched
  // until step 10 cleanup of the migration.
  describe('Handoff Additive Tokens (handoff §6)', () => {
    test('colors expose primary-deep / on-surface-muted / warning', () => {
      expect(colors['primary-deep']).toBe('#57377f')
      expect(colors['on-surface-muted']).toBe('#8a8299')
      expect(colors.warning).toBe('#ff94a5')
    })

    test('colors.syn exposes Catppuccin syntax subset', () => {
      expect(colors.syn).toMatchObject({
        keyword: '#cba6f7',
        string: '#a6e3a1',
        fn: '#89b4fa',
        var: '#f5e0dc',
        comment: '#6c7086',
        type: '#fab387',
        tag: '#f38ba8',
      })
    })

    test('fontFamily.sans / .display match handoff', () => {
      expect(tailwindConfig.theme.extend.fontFamily.sans).toEqual([
        'Inter',
        'ui-sans-serif',
        'system-ui',
      ])

      expect(tailwindConfig.theme.extend.fontFamily.display).toEqual([
        'Instrument Sans',
        'Manrope',
        'system-ui',
      ])
    })

    test('fontSize.vf-* matches handoff scale', () => {
      const fs = tailwindConfig.theme.extend.fontSize
      expect(fs['vf-2xs']).toEqual(['10px', { lineHeight: '14px' }])
      expect(fs['vf-xs']).toEqual(['10.5px', { lineHeight: '15px' }])
      expect(fs['vf-sm']).toEqual(['11.5px', { lineHeight: '16px' }])
      expect(fs['vf-base']).toEqual(['13px', { lineHeight: '19px' }])
      expect(fs['vf-lg']).toEqual(['16px', { lineHeight: '22px' }])
      expect(fs['vf-xl']).toEqual(['20px', { lineHeight: '26px' }])
      expect(fs['vf-2xl']).toEqual(['28px', { lineHeight: '32px' }])
    })

    test('borderRadius exposes handoff named keys (pane/tab/chip/pill/modal)', () => {
      expect(tailwindConfig.theme.extend.borderRadius).toMatchObject({
        pane: '10px',
        tab: '8px 8px 0 0',
        chip: '6px',
        pill: '999px',
        modal: '12px',
      })
    })

    test('boxShadow exposes pane-focus / modal / pip-glow', () => {
      expect(tailwindConfig.theme.extend.boxShadow).toMatchObject({
        'pane-focus':
          '0 0 0 6px rgb(203 166 247 / 0.16), 0 8px 32px rgb(0 0 0 / 0.35)',
        modal: '0 24px 80px rgb(0 0 0 / 0.5)',
        'pip-glow': '0 0 4px currentColor',
      })
    })

    test('transitionTimingFunction.pane exposes handoff cubic-bezier', () => {
      expect(tailwindConfig.theme.extend.transitionTimingFunction.pane).toBe(
        'cubic-bezier(0.32, 0.72, 0, 1)'
      )
    })

    test('existing tokens remain untouched (additive-only invariant)', () => {
      expect(colors.primary).toBe('#e2c7ff')
      expect(colors['surface-container']).toBe('#1e1e2e')
      expect(colors.tertiary).toBe('#ff94a5')
      expect(colors['surface-tint']).toBe('#d9b9ff')
      expect(colors['secondary-container']).toBe('#124988')
    })
  })
})

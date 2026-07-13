import { describe, test, expect } from 'vitest'
import tailwindConfig from './tailwind.config.js'
import { obsidianLens } from './src/theme/index.ts'

describe('Tailwind Config - Obsidian Lens Design Tokens', () => {
  describe('Primary & Secondary Tokens', () => {
    test('has primary-dim token for subdued icon states', () => {
      expect(obsidianLens.ui['primary-dim']).toBe('#d3b9f0')
    })

    test('has secondary-dim token for dimmed accent states', () => {
      expect(obsidianLens.ui['secondary-dim']).toBe('#c39eee')
    })

    test('has primary-container token (brand purple)', () => {
      expect(obsidianLens.ui['primary-container']).toBe('#cba6f7')
    })
  })

  describe('Semantic & Feedback Tokens', () => {
    test('has success token for agent running status (#50fa7b)', () => {
      expect(obsidianLens.ui.success).toBe('#50fa7b')
    })

    test('has success-muted token for diff added lines (#7defa1)', () => {
      expect(obsidianLens.ui['success-muted']).toBe('#7defa1')
    })

    test('has tertiary token for warning accents (#ff94a5)', () => {
      expect(obsidianLens.ui.tertiary).toBe('#ff94a5')
    })

    test('has tertiary-container token for warning badge backgrounds (#fd7e94)', () => {
      expect(obsidianLens.ui['tertiary-container']).toBe('#fd7e94')
    })

    test('has error-dim token for error backgrounds (#d73357)', () => {
      expect(obsidianLens.ui['error-dim']).toBe('#d73357')
    })
  })

  describe('Surface Hierarchy Tokens', () => {
    test('has surface-bright token (#383849)', () => {
      expect(obsidianLens.ui['surface-bright']).toBe('#383849')
    })

    test('has surface-container-low token (#1a1a2a)', () => {
      expect(obsidianLens.ui['surface-container-low']).toBe('#1a1a2a')
    })

    test('has surface-container token (#23233b)', () => {
      expect(obsidianLens.ui['surface-container']).toBe('#23233b')
    })

    test('has surface-container-high token (#292839)', () => {
      expect(obsidianLens.ui['surface-container-high']).toBe('#292839')
    })

    test('has surface-container-highest token (#333344)', () => {
      expect(obsidianLens.ui['surface-container-highest']).toBe('#333344')
    })
  })

  describe('Typography Tokens', () => {
    test('has headline font family (Manrope)', () => {
      expect(tailwindConfig.theme.extend.fontFamily.headline).toEqual([
        'Manrope',
        'sans-serif',
      ])
    })

    test('has hot-swappable body font family', () => {
      expect(tailwindConfig.theme.extend.fontFamily.body).toEqual([
        'var(--font-body)',
      ])
    })

    test('has mono font family (Ioskeley Mono primary, JetBrains Mono fallback)', () => {
      // Ioskeley Mono primary; JetBrains Mono / ui-monospace / monospace fallbacks.
      expect(tailwindConfig.theme.extend.fontFamily.mono).toEqual([
        'Ioskeley Mono',
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

  // Handoff additive tokens — colors now live in obsidianLens theme definition
  describe('Handoff Additive Tokens (handoff §6)', () => {
    test('theme exposes primary-deep / on-surface-muted / warning', () => {
      expect(obsidianLens.ui['primary-deep']).toBe('#57377f')
      expect(obsidianLens.ui['on-surface-muted']).toBe('#8a8299')
      // warning is amber (matches prototype StatusDot awaiting), not pink —
      // pink is `tertiary` / errored in the prototype.
      expect(obsidianLens.ui.warning).toBe('#fab387')
    })

    test('syntax tokens expose Catppuccin syntax subset', () => {
      expect(obsidianLens.syntax).toMatchObject({
        keyword: '#cba6f7',
        string: '#a6e3a1',
        fn: '#89b4fa',
        variable: '#f5e0dc',
        comment: '#6c7086',
        type: '#fab387',
        tag: '#f38ba8',
      })
    })

    test('fontFamily.sans / .display use interface font variables', () => {
      expect(tailwindConfig.theme.extend.fontFamily.sans).toEqual([
        'var(--font-body)',
      ])

      expect(tailwindConfig.theme.extend.fontFamily.display).toEqual([
        'var(--font-display)',
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
        // tab is a single-value (`'8px'`) rather than the handoff's
        // shorthand (`'8px 8px 0 0'`) so directional utilities like
        // `rounded-t-tab` emit valid CSS. Consumers use `rounded-t-tab`
        // for the top-rounded tab shape.
        tab: '8px',
        chip: '6px',
        pill: '999px',
        modal: '12px',
      })
    })

    test('shadows expose pane-focus / modal / pip-glow', () => {
      expect(obsidianLens.shadows).toMatchObject({
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

    test('existing tokens remain in theme definition (additive-only invariant)', () => {
      expect(obsidianLens.ui.primary).toBe('#e2c7ff')
      expect(obsidianLens.ui['surface-container']).toBe('#23233b')
      expect(obsidianLens.ui.tertiary).toBe('#ff94a5')
      expect(obsidianLens.ui['surface-tint']).toBe('#d9b9ff')
      expect(obsidianLens.ui['secondary-container']).toBe('#124988')
    })
  })
})

/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access --
   tailwind.config.js is plain CommonJS-style ESM under bundler resolution.
   tsconfig.json has no `allowJs`, so the default import is typed `any`.
   The test asserts runtime shape via Vitest matchers, which is sufficient
   validation for the additive token contract. Step 10 (token cleanup) may
   migrate the config to .ts; until then, scope the unsafe-* relaxations to
   this single test file. */

import config from '../../tailwind.config.js'

const colors = config.theme.extend.colors as Record<string, unknown>
const fontFamily = config.theme.extend.fontFamily as Record<string, unknown>
const fontSize = config.theme.extend.fontSize as Record<string, unknown>
const borderRadius = config.theme.extend.borderRadius as Record<string, unknown>
const boxShadow = config.theme.extend.boxShadow as Record<string, unknown>

const transitionTimingFunction = config.theme.extend
  .transitionTimingFunction as Record<string, unknown>

test('colors expose handoff additive tokens', () => {
  expect(colors).toMatchObject({
    'primary-deep': '#57377f',
    'on-surface-muted': '#8a8299',
    warning: '#ff94a5',
  })

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

test('fontFamily exposes handoff sans/display/mono', () => {
  expect(fontFamily.sans).toEqual(['Inter', 'ui-sans-serif', 'system-ui'])

  expect(fontFamily.display).toEqual([
    'Instrument Sans',
    'Manrope',
    'system-ui',
  ])

  expect(fontFamily.mono).toEqual([
    'JetBrains Mono',
    'ui-monospace',
    'monospace',
  ])
})

test('fontSize.vf-* matches handoff scale', () => {
  expect(fontSize['vf-2xs']).toEqual(['10px', { lineHeight: '14px' }])
  expect(fontSize['vf-xs']).toEqual(['10.5px', { lineHeight: '15px' }])
  expect(fontSize['vf-sm']).toEqual(['11.5px', { lineHeight: '16px' }])
  expect(fontSize['vf-base']).toEqual(['13px', { lineHeight: '19px' }])
  expect(fontSize['vf-lg']).toEqual(['16px', { lineHeight: '22px' }])
  expect(fontSize['vf-xl']).toEqual(['20px', { lineHeight: '26px' }])
  expect(fontSize['vf-2xl']).toEqual(['28px', { lineHeight: '32px' }])
})

test('borderRadius exposes handoff named keys', () => {
  expect(borderRadius).toMatchObject({
    pane: '10px',
    tab: '8px 8px 0 0',
    chip: '6px',
    pill: '999px',
    modal: '12px',
  })
})

test('boxShadow exposes handoff named keys', () => {
  expect(boxShadow).toMatchObject({
    'pane-focus':
      '0 0 0 6px rgb(203 166 247 / 0.16), 0 8px 32px rgb(0 0 0 / 0.35)',
    modal: '0 24px 80px rgb(0 0 0 / 0.5)',
    'pip-glow': '0 0 4px currentColor',
  })
})

test('transitionTimingFunction.pane exposes handoff cubic-bezier', () => {
  expect(transitionTimingFunction.pane).toBe('cubic-bezier(0.32, 0.72, 0, 1)')
})

test('existing tokens remain untouched', () => {
  expect(colors.primary).toBe('#e2c7ff')
  expect(colors['surface-container']).toBe('#1e1e2e')
  expect(colors.tertiary).toBe('#ff94a5')
  expect(colors['surface-tint']).toBe('#d9b9ff')
  expect(colors['secondary-container']).toBe('#124988')
})

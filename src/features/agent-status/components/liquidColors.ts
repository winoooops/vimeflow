// Single source of truth for liquid-fill colors used by SVG `fill` attributes.
// Each constant is a CSS variable reference — SVG fill resolves var() in DOM
// so the values theme-switch automatically without hex duplication.
// The cross-check test in liquidColors.test.ts asserts the var() strings.

export const LIQUID_COLOR_PRIMARY_CONTAINER = 'var(--color-primary-container)'

export const LIQUID_COLOR_TERTIARY = 'var(--color-tertiary)'

export const LIQUID_COLOR_ERROR = 'var(--color-error)'

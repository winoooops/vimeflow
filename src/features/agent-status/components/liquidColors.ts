// Single source of truth for liquid-fill colors used by SVG `fill` attributes.
// Each constant mirrors a token in src/theme/themes/obsidian-lens.ts — the
// cross-check test in liquidColors.test.ts forces the two to stay in sync.
// SVG fill cannot take a Tailwind class name, hence the hex duplication.

export const LIQUID_COLOR_PRIMARY_CONTAINER = '#cba6f7'

export const LIQUID_COLOR_TERTIARY = '#ff94a5'

export const LIQUID_COLOR_ERROR = '#ffb4ab'

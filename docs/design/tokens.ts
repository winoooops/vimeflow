/*
 * Vimeflow -- Design Tokens (TypeScript export)
 *
 * Mirror of tokens.css. Use this file when you need values in JS/TS
 * (Tailwind config, component props, style-dictionary consumers, tests).
 *
 * Values must stay in sync with tokens.css. When changing either,
 * update both in the same commit.
 */

export const surface = {
  base: '#121221',
  containerLowest: '#0d0d1c',
  containerLow: '#1a1a2a',
  container: '#1e1e2e',
  containerHigh: '#292839',
  containerHighest: '#333344',
  bright: '#383849',
  tint: '#e2c7ff',
} as const

export const primary = {
  base: '#e2c7ff',
  container: '#cba6f7',
  dim: '#d3b9f0',
  on: '#2a1646',
} as const

export const secondary = {
  base: '#a8c8ff',
  container: '#57377f',
  dim: '#c39eee',
} as const

export const semantic = {
  tertiary: '#ff94a5',
  tertiaryContainer: '#fd7e94',
  error: '#ffb4ab',
  errorDim: '#d73357',
  success: '#50fa7b',
  successMuted: '#7defa1',
} as const

export const text = {
  onSurface: '#e3e0f7',
  onSurfaceVariant: '#cdc3d1',
  onSurfaceMuted: '#8a8299',
  outlineVariant: '#4a444f',
} as const

export const syntax = {
  keyword: '#cba6f7',
  string: '#a6e3a1',
  fn: '#89b4fa',
  variable: '#f5e0dc',
  comment: '#6c7086',
  type: '#fab387',
  tag: '#f38ba8',
} as const

export const font = {
  display: "'Instrument Sans', 'Manrope', system-ui, sans-serif",
  body: "'Inter', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
} as const

export const textSize = {
  displayLg: '3.5rem',
  headlineSm: '1.5rem',
  titleMd: '1.125rem',
  bodyMd: '0.875rem',
  labelMd: '0.75rem',
  labelSm: '0.625rem',
} as const

export const radius = {
  xl: '1.5rem',
  lg: '1rem',
  md: '0.75rem',
  sm: '0.5rem',
  full: '9999px',
} as const

export const layout = {
  railW: 48,
  sidebarW: 272,
  sidebarWCompact: 248,
  activityW: 320,
  viewTabsH: 40,
  statusBarH: 24,
} as const

export const motion = {
  ease: 'cubic-bezier(.2, .8, .2, 1)',
  durFast: '160ms',
  durBase: '300ms',
  durEntry: '220ms',
  durSlow: '400ms',
} as const

export const glass = {
  fill: 'rgba(30, 30, 46, 0.88)',
  blur: '20px',
  saturate: '150%',
  shadowAmbient: '0 10px 40px rgba(0, 0, 0, 0.4)',
  shadowGlowPrimary: '0 0 24px rgba(203, 166, 247, 0.35)',
  shadowGlowSuccess: '0 0 10px var(--success)',
  ringPrimary: '0 0 0 3px rgba(203, 166, 247, 0.28)',
} as const

/* ------------------------------------------------------------------
 * Agent session state -> visual tokens
 * Source of truth: UNIFIED.md §4.1.
 * If a new state is added, update UNIFIED.md, this map, and StatusDot
 * -- all three, or none.
 * ------------------------------------------------------------------ */

export type SessionState =
  | 'running'
  | 'awaiting'
  | 'completed'
  | 'errored'
  | 'idle'

export interface StateVisual {
  dot: string
  fill: 'solid' | 'hollow'
  pulse: false | { durationMs: number }
  glow: boolean
  labelTone: 'success' | 'warn' | 'primary' | 'error' | 'neutral'
}

export const stateToken: Record<SessionState, StateVisual> = {
  running: {
    dot: semantic.success,
    fill: 'solid',
    pulse: { durationMs: 2000 },
    glow: true,
    labelTone: 'success',
  },
  awaiting: {
    dot: semantic.tertiary,
    fill: 'solid',
    pulse: { durationMs: 1400 },
    glow: true,
    labelTone: 'warn',
  },
  completed: {
    dot: semantic.successMuted,
    fill: 'hollow',
    pulse: false,
    glow: false,
    labelTone: 'primary',
  },
  errored: {
    dot: semantic.error,
    fill: 'solid',
    pulse: false,
    glow: false,
    labelTone: 'error',
  },
  idle: {
    dot: text.outlineVariant,
    fill: 'hollow',
    pulse: false,
    glow: false,
    labelTone: 'neutral',
  },
}

/* ------------------------------------------------------------------
 * Context smiley (§5.5) -- surfaces remaining-context pressure in the
 * status bar. Input is "percent full" (0-100). Breakpoints mirror the
 * ContextBucket emoji thresholds in src/features/agent-status.
 * ------------------------------------------------------------------ */

export function contextSmiley(pct: number): string {
  if (pct >= 90) return '\u{1F975}' // hot-face: nearly full
  if (pct >= 80) return '\u{1F61F}' // worried
  if (pct >= 60) return '\u{1F610}' // neutral
  return '\u{1F60A}' // happy
}

const tokens = {
  surface,
  primary,
  secondary,
  semantic,
  text,
  syntax,
  font,
  textSize,
  radius,
  layout,
  motion,
  glass,
  stateToken,
  contextSmiley,
}

export default tokens

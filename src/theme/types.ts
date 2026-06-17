import type { TerminalTheme } from '../features/terminal/types'

/* Token name lists are runtime-iterable on purpose: the CSS-variable
 * emitter (cssVars.ts) and the theme.css sync test both walk them.
 * Token diet applied per scripts/audit-colors.mjs census — Material 3
 * leftovers with zero consumers (fixed/inverse variants, surface-dim,
 * surface-variant, on-background, on-primary-container, background)
 * did not migrate.
 *
 * Theme VALUES must be written in prettier's CSS normal form — lowercase
 * hex, no trailing zeros in alphas (0.3, not 0.30) — because theme.css
 * is prettier-formatted and the sync test compares strings. */

export const UI_TOKENS = [
  'surface',
  'surface-container-lowest',
  'surface-container-low',
  'surface-container',
  'surface-container-high',
  'surface-container-highest',
  'surface-bright',
  'surface-tint',
  'browser-bar',
  'browser-tab-active',
  'primary',
  'primary-container',
  'primary-dim',
  'primary-deep',
  'on-primary',
  'secondary',
  'secondary-container',
  'secondary-dim',
  'on-secondary',
  'on-secondary-container',
  'tertiary',
  'tertiary-container',
  'on-tertiary',
  'on-tertiary-container',
  'error',
  'error-container',
  'error-dim',
  'on-error',
  'on-error-container',
  'success',
  'success-muted',
  'warning',
  'on-surface',
  'on-surface-variant',
  'on-surface-muted',
  'outline',
  'outline-variant',
  'editor-fg',
  'editor-fg-dim',
  'vcs-modified',
  'vcs-added',
  'vcs-deleted',
  'vcs-renamed',
  'vcs-untracked',
] as const

export const EFFECT_COLOR_TOKENS = [
  'glass-fill',
  'selection',
  'scrollbar-thumb',
  'scrollbar-thumb-hover',
  'diff-added',
  'diff-removed',
  'diff-highlight-added',
  'diff-highlight-removed',
  'wash-faint',
  'wash-subtle',
  'wash-soft',
  'scrim',
] as const

export const SHADOW_TOKENS = [
  'pane-focus',
  'modal',
  'pip-glow',
  'ambient',
  'glow-primary',
  'ring-primary',
] as const

export const SYN_TOKENS = [
  'keyword',
  'string',
  'fn',
  'variable',
  'comment',
  'type',
  'tag',
  'class',
  'operator',
] as const

export const AGENT_IDS = [
  'claude',
  'codex',
  'shell',
  'browser',
  'kimi',
] as const

export const AGENT_ACCENT_FIELDS = [
  'accent',
  'accentDim',
  'accentSoft',
  'onAccent',
] as const

export type UiToken = (typeof UI_TOKENS)[number]

export type EffectColorToken = (typeof EFFECT_COLOR_TOKENS)[number]

export type ShadowToken = (typeof SHADOW_TOKENS)[number]

export type SynToken = (typeof SYN_TOKENS)[number]

export type ThemeAgentId = (typeof AGENT_IDS)[number]

export type AgentAccentField = (typeof AGENT_ACCENT_FIELDS)[number]

export type AgentAccent = Record<AgentAccentField, string>

export type ThemeId = 'obsidian-lens' | 'flexoki'

export type ThemeKind = 'dark' | 'light'

export interface ThemeDefinition {
  id: ThemeId
  label: string
  kind: ThemeKind
  ui: Record<UiToken, string>
  effects: Record<EffectColorToken, string>
  shadows: Record<ShadowToken, string>
  syntax: Record<SynToken, string>
  terminal: TerminalTheme
  agents: Record<ThemeAgentId, AgentAccent>
}

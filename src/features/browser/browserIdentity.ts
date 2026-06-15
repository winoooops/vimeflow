import type { PaneIdentity } from '../../agents/registry'

// Reserved cyan "WEB" identity — a pane visual identity, deliberately decoupled
// from the agent registry and agent status.
export const BROWSER_IDENTITY: PaneIdentity = {
  name: 'Web',
  short: 'WEB',
  glyph: '⊕',
  accent: 'var(--color-agent-browser-accent)',
  accentDim: 'var(--color-agent-browser-accent-dim)',
  accentSoft: 'var(--color-agent-browser-accent-soft)',
  onAccent: 'var(--color-agent-browser-on-accent)',
}

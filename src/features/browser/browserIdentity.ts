import type { PaneIdentity } from '../../agents/registry'

// Reserved cyan "WEB" identity — a pane visual identity, deliberately decoupled
// from the agent registry and agent status.
export const BROWSER_IDENTITY: PaneIdentity = {
  name: 'Web',
  short: 'WEB',
  glyph: '⊕',
  accent: '#4fc8d6',
  accentDim: 'rgb(79 200 214 / 0.16)',
  accentSoft: 'rgb(79 200 214 / 0.30)',
  onAccent: '#06232a',
}

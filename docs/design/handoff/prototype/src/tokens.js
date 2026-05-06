// Vimeflow — Obsidian Lens design tokens (authoritative; reconciled from DESIGN.md)
// Referenced by tailwind config and inline styles alike.
window.VIMEFLOW_TOKENS = {
  // Surfaces — deepest to brightest; NEVER pure black or pure white
  surface: '#121221',
  'surface-container-lowest': '#0d0d1c',
  'surface-container-low': '#1a1a2a',
  'surface-container': '#1e1e2e',
  'surface-container-high': '#292839',
  'surface-container-highest': '#333344',
  'surface-bright': '#383849',
  'surface-tint': '#e2c7ff',

  // Text
  'on-surface': '#e3e0f7',
  'on-surface-variant': '#cdc3d1',
  'on-surface-muted': '#8a8299',

  // Primary (lavender)
  primary: '#e2c7ff',
  'primary-container': '#cba6f7',
  'primary-dim': '#d3b9f0',
  'on-primary': '#3f1e66',

  // Secondary (azure / info)
  secondary: '#a8c8ff',
  'secondary-container': '#57377f',
  'secondary-dim': '#c39eee',

  // Semantic
  tertiary: '#ff94a5', // warn / awaiting
  'tertiary-container': '#fd7e94',
  error: '#ffb4ab',
  'error-dim': '#d73357',
  success: '#50fa7b', // live / running
  'success-muted': '#7defa1',

  // Outline (used at ≤15% alpha, ever)
  'outline-variant': '#4a444f',

  // Syntax (Catppuccin subset)
  'syn-keyword': '#cba6f7',
  'syn-string': '#a6e3a1',
  'syn-fn': '#89b4fa',
  'syn-var': '#f5e0dc',
  'syn-comment': '#6c7086',
  'syn-type': '#fab387',
  'syn-tag': '#f38ba8',
}

// Aesthetic variants — toggled via Tweaks
window.VIMEFLOW_AESTHETICS = {
  obsidian: {
    label: 'Obsidian Lens',
    blurbg: 'rgba(30,30,50,0.4)',
    blurAmt: '20px',
    displayFont: "'Instrument Sans', 'Manrope', system-ui",
    displayWeight: 600,
    displayTracking: '-0.02em',
    sectionPad: '1.25rem',
    bgNoise: true,
  },
  editorial: {
    label: 'Editorial',
    blurbg: 'rgba(30,30,50,0.55)',
    blurAmt: '28px',
    displayFont: "'Fraunces', 'Instrument Serif', Georgia, serif",
    displayWeight: 500,
    displayTracking: '-0.03em',
    sectionPad: '1.75rem',
    bgNoise: false,
  },
  dense: {
    label: 'Dense',
    blurbg: 'rgba(30,30,50,0.3)',
    blurAmt: '14px',
    displayFont: "'Instrument Sans', 'Manrope', system-ui",
    displayWeight: 600,
    displayTracking: '-0.015em',
    sectionPad: '0.75rem',
    bgNoise: false,
  },
}

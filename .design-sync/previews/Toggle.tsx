import { Toggle } from 'vibm'

// Dark Lens surface wrapper — the preview card chrome is white, so each cell
// re-creates the app surface with token vars (inline styles; unused utility
// classes are purged from the compiled CSS).
const surface = {
  background: 'var(--color-surface)',
  color: 'var(--color-on-surface)',
  padding: 24,
  borderRadius: 12,
  display: 'flex',
  flexWrap: 'wrap' as const,
  alignItems: 'center',
  gap: 16,
}

const caption = {
  color: 'var(--color-on-surface-muted)',
  font: '12px Inter',
}

const noop = () => {}

export const States = () => (
  <div style={surface}>
    <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
      <span style={caption}>off</span>
      <Toggle label="Whitespace" value={false} onChange={noop} />
    </div>
    <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
      <span style={caption}>on</span>
      <Toggle label="Split view" value onChange={noop} />
    </div>
  </div>
)

// Mirrors the diff-toolbar row: chip toggles gating diff rendering options.
export const DiffToolbarGroup = () => (
  <div style={surface}>
    <Toggle label="Split view" value onChange={noop} />
    <Toggle label="Whitespace" value={false} onChange={noop} />
    <Toggle label="Word wrap" value onChange={noop} />
    <Toggle label="Collapse unchanged" value={false} onChange={noop} />
  </div>
)

// Terminal pane session options as boolean chips.
export const SessionOptions = () => (
  <div style={surface}>
    <Toggle label="Auto-scroll" value onChange={noop} />
    <Toggle label="Show timestamps" value={false} onChange={noop} />
    <Toggle label="Follow agent output" value onChange={noop} />
  </div>
)

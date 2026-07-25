import { IconButton } from 'vibm'

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

const cell = {
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  gap: 8,
}

export const Variants = () => (
  <div style={surface}>
    <div style={cell}>
      <IconButton icon="search" label="Search files" variant="ghost" />
      <span style={caption}>ghost</span>
    </div>
    <div style={cell}>
      <IconButton icon="add" label="New session" variant="default" />
      <span style={caption}>default</span>
    </div>
    <div style={cell}>
      <IconButton icon="terminal" label="New terminal pane" variant="toolbar" />
      <span style={caption}>toolbar</span>
    </div>
    <div style={cell}>
      <IconButton icon="play_arrow" label="Resume agent" variant="primary" />
      <span style={caption}>primary</span>
    </div>
    <div style={cell}>
      <IconButton icon="commit" label="Commit staged" variant="flat-primary" />
      <span style={caption}>flat-primary</span>
    </div>
    <div style={cell}>
      <IconButton icon="delete" label="Discard changes" variant="danger" />
      <span style={caption}>danger</span>
    </div>
  </div>
)

export const Sizes = () => (
  <div style={surface}>
    <div style={cell}>
      <IconButton icon="close" label="Close pane" variant="ghost" size="sm" />
      <span style={caption}>sm</span>
    </div>
    <div style={cell}>
      <IconButton icon="close" label="Close pane" variant="ghost" size="md" />
      <span style={caption}>md</span>
    </div>
    <div style={cell}>
      <IconButton icon="close" label="Close pane" variant="ghost" size="lg" />
      <span style={caption}>lg</span>
    </div>
  </div>
)

export const PressedAndDisabled = () => (
  <div style={surface}>
    <div style={cell}>
      <IconButton icon="dock_to_right" label="Dock panel" variant="ghost" />
      <span style={caption}>rest</span>
    </div>
    <div style={cell}>
      <IconButton
        icon="dock_to_right"
        label="Dock panel"
        variant="ghost"
        pressed
      />
      <span style={caption}>pressed</span>
    </div>
    <div style={cell}>
      <IconButton
        icon="dock_to_right"
        label="Dock panel"
        variant="ghost"
        disabled
      />
      <span style={caption}>disabled</span>
    </div>
  </div>
)

// Pane-header cluster as composed in the terminal zone: tight ghost buttons.
export const PaneHeaderCluster = () => (
  <div style={surface}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      <IconButton icon="add" label="New terminal" variant="ghost" size="sm" />
      <IconButton
        icon="splitscreen"
        label="Split pane"
        variant="ghost"
        size="sm"
      />
      <IconButton
        icon="more_horiz"
        label="Pane options"
        variant="ghost"
        size="sm"
      />
      <IconButton icon="close" label="Close pane" variant="ghost" size="sm" />
    </div>
  </div>
)

import { ToolbarButton } from 'vibm'

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
      <ToolbarButton icon="commit" label="Stage all" />
      <span style={caption}>toolbar (default)</span>
    </div>
    <div style={cell}>
      <ToolbarButton icon="history" label="Recent sessions" variant="ghost" />
      <span style={caption}>ghost</span>
    </div>
    <div style={cell}>
      <ToolbarButton
        icon="folder_open"
        label="Open worktree"
        variant="default"
      />
      <span style={caption}>default</span>
    </div>
    <div style={cell}>
      <ToolbarButton icon="delete" label="Discard changes" variant="danger" />
      <span style={caption}>danger</span>
    </div>
  </div>
)

// The DockPanel review switcher: leading glyph + trailing disclosure chevron.
export const WithTrailingIcon = () => (
  <div style={surface}>
    <ToolbarButton
      icon="rate_review"
      label="codex review · locator.rs"
      trailingIcon="expand_more"
    />
    <ToolbarButton
      icon="call_split"
      label="main"
      trailingIcon="expand_more"
      variant="ghost"
    />
  </div>
)

export const PressedAndDisabled = () => (
  <div style={surface}>
    <div style={cell}>
      <ToolbarButton icon="terminal" label="Terminal" />
      <span style={caption}>rest</span>
    </div>
    <div style={cell}>
      <ToolbarButton icon="terminal" label="Terminal" pressed />
      <span style={caption}>pressed</span>
    </div>
    <div style={cell}>
      <ToolbarButton icon="terminal" label="Terminal" disabled />
      <span style={caption}>disabled</span>
    </div>
  </div>
)

export const Sizes = () => (
  <div style={surface}>
    <div style={cell}>
      <ToolbarButton icon="difference" label="Diff" size="sm" />
      <span style={caption}>sm</span>
    </div>
    <div style={cell}>
      <ToolbarButton icon="difference" label="Diff" size="md" />
      <span style={caption}>md</span>
    </div>
    <div style={cell}>
      <ToolbarButton icon="difference" label="Diff" size="lg" />
      <span style={caption}>lg</span>
    </div>
  </div>
)

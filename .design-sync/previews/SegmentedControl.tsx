import { SegmentedControl } from 'vibm'

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

// Default pill variant — diff view mode with material-symbol glyphs, as the
// diff toolbar composes it.
export const Pill = () => (
  <div style={surface}>
    <SegmentedControl
      aria-label="Diff view mode"
      value="split"
      options={[
        { value: 'split', label: 'Split', icon: 'vertical_split' },
        { value: 'unified', label: 'Unified', icon: 'view_headline' },
      ]}
      onChange={noop}
    />
    <span style={caption}>pill · active: Split</span>
  </div>
)

// Dock variant — the markdown Reading ⇄ Source switch, plus a disabled option
// (dimmed, not removed) for a file with no preview.
export const Dock = () => (
  <div style={surface}>
    <SegmentedControl
      aria-label="Markdown view mode"
      variant="dock"
      value="reading"
      options={[
        { value: 'reading', label: 'Reading' },
        { value: 'source', label: 'Source' },
        { value: 'preview', label: 'Preview', disabled: true },
      ]}
      onChange={noop}
    />
    <span style={caption}>dock · Preview disabled</span>
  </div>
)

const DOCK_RECTS: Record<
  string,
  { x: number; y: number; width: number; height: number }
> = {
  top: { x: 2, y: 1.5, width: 10, height: 3 },
  bottom: { x: 2, y: 6.5, width: 10, height: 3 },
  left: { x: 1.6, y: 2, width: 4, height: 7 },
  right: { x: 8.4, y: 2, width: 4, height: 7 },
}

const DockGlyph = ({ position }: { position: string }) => (
  <svg
    width="14"
    height="11"
    viewBox="0 0 14 11"
    fill="none"
    aria-hidden="true"
  >
    <rect
      x="1"
      y="1"
      width="12"
      height="9"
      rx={1.4}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
    />
    <rect
      {...DOCK_RECTS[position]}
      rx={0.6}
      fill="currentColor"
      opacity={0.55}
    />
  </svg>
)

// Framed variant — the DockSwitcher's four dock-position glyph cells.
export const Framed = () => (
  <div style={surface}>
    <SegmentedControl
      aria-label="Dock position"
      variant="framed"
      value="bottom"
      options={[
        { value: 'top', label: 'Dock: Top' },
        { value: 'bottom', label: 'Dock: Bottom' },
        { value: 'left', label: 'Dock: Left' },
        { value: 'right', label: 'Dock: Right' },
      ]}
      onChange={noop}
      renderOption={(option) => <DockGlyph position={String(option.value)} />}
    />
    <span style={caption}>framed · active: Bottom</span>
  </div>
)

// Toolbar variant — compact icon-only cells (terminal layout switcher).
export const Toolbar = () => (
  <div style={surface}>
    <SegmentedControl
      aria-label="Terminal layout"
      variant="toolbar"
      value="columns"
      options={[
        { value: 'single', label: 'Single pane', icon: 'crop_square' },
        { value: 'columns', label: 'Two columns', icon: 'splitscreen' },
        { value: 'grid', label: 'Grid', icon: 'grid_view' },
      ]}
      onChange={noop}
    />
    <span style={caption}>toolbar · active: Two columns</span>
  </div>
)

// Sidebar variant — SidebarTabs composition: fixed 202px track, sliding
// active thumb, filled icon on the active tab.
export const Sidebar = () => (
  <div style={surface}>
    <SegmentedControl
      aria-label="Sidebar tabs"
      variant="sidebar"
      value="files"
      options={[
        { value: 'files', label: 'Files', icon: 'folder' },
        { value: 'git', label: 'Git', icon: 'commit' },
      ]}
      onChange={noop}
      style={{ width: 202 }}
      iconClassName="material-symbols-outlined text-[15px]"
      fillActiveIcon
    />
    <span style={caption}>sidebar · thumb on Files</span>
  </div>
)

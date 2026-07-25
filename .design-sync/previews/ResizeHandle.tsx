import { ResizeHandle } from 'vibm'

// ResizeHandle is a controlled WAI-ARIA separator: the consumer owns
// placement + thickness (style/className) and the drag binding. At rest it
// is transparent (hover/drag paint it primary), so each cell pairs an idle
// split with a mid-drag split to show both states.
const surface = {
  background: 'var(--color-surface)',
  color: 'var(--color-on-surface)',
  padding: 24,
  borderRadius: 12,
  display: 'flex',
  flexWrap: 'wrap' as const,
  alignItems: 'flex-start',
  gap: 24,
}

const noop = () => {}

const paneTitle = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.06em',
  color: 'var(--color-on-surface-variant)',
  borderBottom:
    '1px solid color-mix(in srgb, var(--color-outline-variant) 20%, transparent)',
}

const paneBody = {
  padding: '8px 10px',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  lineHeight: '16px',
  color: 'var(--color-on-surface-muted)',
  overflow: 'hidden',
}

const Pane = ({ title, lines }: { title: string; lines: string[] }) => (
  <div
    style={{
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--color-surface-container)',
      borderRadius: 8,
      overflow: 'hidden',
    }}
  >
    <div style={paneTitle}>{title}</div>
    <div style={paneBody}>
      {lines.map((line) => (
        <div key={line} style={{ whiteSpace: 'nowrap' }}>
          {line}
        </div>
      ))}
    </div>
  </div>
)

const caption = {
  marginTop: 8,
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  letterSpacing: '0.08em',
  color: 'var(--color-on-surface-variant)',
  textAlign: 'center' as const,
}

// aria-orientation="vertical" → col-resize: the handle stands between
// side-by-side terminal panes (the SplitView divider case).
export const VerticalBetweenColumns = () => {
  const split = (dragging: boolean) => (
    <div style={{ display: 'flex', width: 270, height: 150 }}>
      <Pane
        title="∴ claude — main"
        lines={['❯ claude --continue', '✻ reading locator.rs…', '⏺ 14 turns']}
      />
      <ResizeHandle
        orientation="vertical"
        isDragging={dragging}
        ariaValueNow={132}
        ariaValueMin={80}
        ariaValueMax={190}
        ariaLabel="Resize panes"
        onMouseDown={noop}
        onKeyDown={noop}
        style={{ width: 6, alignSelf: 'stretch', flexShrink: 0 }}
      />
      <Pane
        title="◇ codex — review"
        lines={['❯ codex review', '2 findings (P2)', 'transcript.rs:88']}
      />
    </div>
  )
  return (
    <div style={surface}>
      <div>
        {split(false)}
        <div style={caption}>IDLE — TRANSPARENT UNTIL HOVER</div>
      </div>
      <div>
        {split(true)}
        <div style={caption}>DRAGGING — PRIMARY WASH</div>
      </div>
    </div>
  )
}

// aria-orientation="horizontal" → ns-resize: the handle separates stacked
// rows (editor over terminal, the DockPanel edge case).
export const HorizontalBetweenRows = () => {
  const split = (dragging: boolean) => (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 270,
        height: 190,
      }}
    >
      <Pane
        title="editor — kimi/locator.rs"
        lines={[
          'fn resolve_session(&self)',
          '  -> Option<SessionRef> {',
          '  self.newest_by_updated_at()',
        ]}
      />
      <ResizeHandle
        orientation="horizontal"
        isDragging={dragging}
        ariaValueNow={72}
        ariaValueMin={40}
        ariaValueMax={130}
        ariaLabel="Resize terminal"
        onMouseDown={noop}
        onKeyDown={noop}
        style={{ height: 6, width: '100%', flexShrink: 0 }}
      />
      <Pane
        title="$ zsh — vimeflow"
        lines={[
          '❯ cargo test -p vimeflow-backend',
          'test result: ok. 132 passed',
        ]}
      />
    </div>
  )
  return (
    <div style={surface}>
      <div>
        {split(false)}
        <div style={caption}>IDLE</div>
      </div>
      <div>
        {split(true)}
        <div style={caption}>DRAGGING</div>
      </div>
    </div>
  )
}

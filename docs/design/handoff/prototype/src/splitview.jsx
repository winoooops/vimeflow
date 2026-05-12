// Vimeflow — split-view system. Multiple agent terminals running in parallel,
// arranged via canonical layouts. Each pane has identity (agent), state (session),
// and focus. Click/⌘N to focus; ⌘ arrows to move focus.

// Canonical layouts. Each is a CSS-grid template description.
// `cells` describes which pane index occupies each grid track.
window.VIMEFLOW_LAYOUTS = {
  single: {
    id: 'single',
    name: 'Single',
    capacity: 1,
    cols: 'minmax(0, 1fr)',
    rows: 'minmax(0, 1fr)',
    areas: [['p0']],
    icon: 'rectangle',
  },
  vsplit: {
    id: 'vsplit',
    name: 'Vertical split',
    capacity: 2,
    cols: 'minmax(0, 1fr) minmax(0, 1fr)',
    rows: 'minmax(0, 1fr)',
    areas: [['p0', 'p1']],
    icon: 'splitscreen_vertical',
  },
  hsplit: {
    id: 'hsplit',
    name: 'Horizontal split',
    capacity: 2,
    cols: 'minmax(0, 1fr)',
    rows: 'minmax(0, 1fr) minmax(0, 1fr)',
    areas: [['p0'], ['p1']],
    icon: 'splitscreen',
  },
  threeRight: {
    id: 'threeRight',
    name: 'Main + 2 stack',
    capacity: 3,
    cols: 'minmax(0, 1.4fr) minmax(0, 1fr)',
    rows: 'minmax(0, 1fr) minmax(0, 1fr)',
    areas: [
      ['p0', 'p1'],
      ['p0', 'p2'],
    ],
    icon: 'view_quilt',
  },
  quad: {
    id: 'quad',
    name: 'Quad',
    capacity: 4,
    cols: 'minmax(0, 1fr) minmax(0, 1fr)',
    rows: 'minmax(0, 1fr) minmax(0, 1fr)',
    areas: [
      ['p0', 'p1'],
      ['p2', 'p3'],
    ],
    icon: 'grid_view',
  },
}

// Per-pane terminal renderer. Reuses TermLine from views.jsx for consistency.
function PaneTerminal({ pane, agent, session, paused, focused }) {
  const script =
    window.VIMEFLOW_PANE_SCRIPTS[agent.id] ||
    window.VIMEFLOW_PANE_SCRIPTS.claude
  const [lines, setLines] = React.useState([script[0]])
  const scrollRef = React.useRef(null)
  const iRef = React.useRef(1)
  const TermLine = window.TermLine

  React.useEffect(() => {
    if (paused) return
    if (iRef.current >= script.length) return
    const t = setTimeout(
      () => {
        setLines((l) => [...l, script[iRef.current]])
        iRef.current += 1
        if (scrollRef.current)
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight + 200
      },
      1400 + Math.random() * 900
    )
    return () => clearTimeout(t)
  }, [lines.length, paused, script])

  React.useEffect(() => {
    setLines([script[0]])
    iRef.current = 1
  }, [pane.id, agent.id])

  return (
    <div
      ref={scrollRef}
      className="vf-scroll"
      style={{
        flex: 1,
        overflow: 'auto',
        padding: '14px 18px 8px',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11.5,
        lineHeight: 1.6,
        opacity: focused ? 1 : 0.78,
        transition: 'opacity 220ms ease',
      }}
    >
      {lines.map((l, i) => (
        <PaneTermLine
          key={i}
          line={l}
          last={i === lines.length - 1 && !paused}
          agent={agent}
        />
      ))}
    </div>
  )
}

// Slimmer term line, agent-themed (uses agent.glyph + agent.accent).
function PaneTermLine({ line, last, agent }) {
  if (!line) return null
  if (line.t === 'meta')
    return (
      <div style={{ color: '#6c7086', marginBottom: 8, fontSize: 10 }}>
        ── {line.text}
      </div>
    )
  if (line.t === 'prompt')
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          marginTop: 5,
          marginBottom: 3,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ color: '#7defa1' }}>➜</span>
        <span style={{ color: '#a8c8ff' }}>{line.path}</span>
        <span style={{ color: agent.accent }}>git:({line.branch})</span>
        <span style={{ color: '#e3e0f7' }}>{line.cmd}</span>
        {line.cursor && (
          <span
            className="vf-cursor"
            style={{
              display: 'inline-block',
              width: 7,
              height: 14,
              marginLeft: 2,
              background: agent.accent,
              verticalAlign: 'middle',
            }}
          />
        )}
      </div>
    )
  if (line.t === 'agent')
    return (
      <div
        style={{
          color: '#cdc3d1',
          marginBottom: 3,
          paddingLeft: 14,
          position: 'relative',
        }}
      >
        <span
          style={{
            position: 'absolute',
            left: 0,
            color: agent.accent,
            fontWeight: 600,
          }}
        >
          {agent.glyph}
        </span>
        {line.text}
        {last && (
          <span
            className="vf-cursor"
            style={{
              display: 'inline-block',
              width: 6,
              height: 12,
              marginLeft: 4,
              background: agent.accent,
              verticalAlign: 'middle',
            }}
          />
        )}
      </div>
    )
  if (line.t === 'tool')
    return (
      <div style={{ marginBottom: 3, paddingLeft: 14, fontSize: 11 }}>
        <span style={{ color: '#a8c8ff' }}>⚒ {line.name}</span>
        <span style={{ color: '#6c7086' }}>(</span>
        <span style={{ color: '#f5e0dc' }}>{line.args}</span>
        <span style={{ color: '#6c7086' }}>)</span>
        <span
          style={{
            marginLeft: 6,
            color: line.status === 'ok' ? '#7defa1' : '#ff94a5',
          }}
        >
          ● {line.status}
        </span>
        <span style={{ marginLeft: 6, color: '#6c7086' }}>· {line.detail}</span>
      </div>
    )
  if (line.t === 'output')
    return (
      <div
        style={{
          color: '#cdc3d1',
          marginBottom: 3,
          paddingLeft: 14,
          fontSize: 11,
        }}
      >
        {line.text}
      </div>
    )
  return null
}

// A single pane: header + terminal + input. Click anywhere to focus.
function TerminalPane({
  pane,
  agent,
  session,
  focused,
  onFocus,
  onClose,
  onSwapAgent,
  paused,
}) {
  const [collapsed, setCollapsed] = React.useState(false)
  const StatusDot = window.StatusDot
  const Icon = window.Icon
  const RelTime = window.RelTime

  const headerBg = focused
    ? `linear-gradient(180deg, ${agent.accentDim}, rgba(13,13,28,0.0))`
    : 'transparent'

  return (
    <div
      onClick={onFocus}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        minWidth: 0,
        background: '#121221',
        borderRadius: 10,
        overflow: 'hidden',
        outline: focused
          ? `2px solid ${agent.accent}`
          : '1px solid rgba(74,68,79,0.22)',
        outlineOffset: focused ? -2 : -1,
        boxShadow: focused
          ? `0 0 0 6px ${agent.accentDim}, 0 8px 32px rgba(0,0,0,0.35)`
          : 'none',
        transition:
          'outline-color 180ms ease, box-shadow 220ms ease, opacity 220ms ease',
        cursor: focused ? 'default' : 'pointer',
      }}
    >
      {/* Pane header — collapsible status. Single pill row when collapsed. */}
      <div
        style={{
          flexShrink: 0,
          background: headerBg,
          borderBottom: '1px solid rgba(74,68,79,0.18)',
          padding: collapsed ? '6px 10px' : '8px 12px 8px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10.5,
          userSelect: 'none',
        }}
      >
        {/* Agent identity chip */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 8px 3px 6px',
            background: agent.accentDim,
            border: `1px solid ${agent.accentSoft}`,
            borderRadius: 6,
            color: agent.accent,
            fontWeight: 600,
            letterSpacing: '0.04em',
          }}
        >
          <span style={{ fontSize: 12 }}>{agent.glyph}</span>
          <span>{agent.short}</span>
        </div>

        {/* State */}
        <StatusDot state={paused ? 'idle' : session.state} size={6} />
        <span style={{ color: '#cdc3d1' }}>{pane.title || session.title}</span>

        {!collapsed && (
          <>
            <span style={{ color: '#4a444f' }}>·</span>
            <span style={{ color: '#8a8299' }}>{session.branch}</span>
            <span style={{ color: '#4a444f' }}>·</span>
            <span style={{ color: '#7defa1' }}>+{session.changes.added}</span>
            <span style={{ color: '#ff94a5' }}>−{session.changes.removed}</span>
            <span style={{ color: '#4a444f' }}>·</span>
            <RelTime value={session.updated || 'now'} />
          </>
        )}

        <span style={{ flex: 1 }} />

        <button
          onClick={(e) => {
            e.stopPropagation()
            setCollapsed((c) => !c)
          }}
          title={collapsed ? 'expand status' : 'collapse status'}
          style={paneIconBtn}
        >
          <Icon
            name={collapsed ? 'unfold_more' : 'unfold_less'}
            size={13}
            style={{ color: '#8a8299' }}
          />
        </button>
        {onClose && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            title="close pane"
            style={paneIconBtn}
          >
            <Icon name="close" size={13} style={{ color: '#8a8299' }} />
          </button>
        )}
      </div>

      {/* Terminal */}
      <PaneTerminal
        pane={pane}
        agent={agent}
        session={session}
        paused={paused}
        focused={focused}
      />

      {/* Input bar */}
      <PaneInput
        agent={agent}
        session={session}
        paused={paused}
        focused={focused}
      />
    </div>
  )
}

const paneIconBtn = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  background: 'transparent',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
}

function PaneInput({ agent, session, paused, focused }) {
  const [val, setVal] = React.useState('')
  const StatusDot = window.StatusDot
  return (
    <div
      style={{
        flexShrink: 0,
        borderTop: '1px solid rgba(74,68,79,0.2)',
        background: focused ? 'rgba(13,13,28,0.55)' : 'rgba(13,13,28,0.4)',
        padding: '7px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11.5,
      }}
    >
      <StatusDot state={paused ? 'idle' : session.state} size={6} />
      <span style={{ color: agent.accent }}>{'>'}</span>
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        placeholder={
          focused
            ? paused
              ? 'paused'
              : `message ${agent.short.toLowerCase()}...`
            : `click to focus ${agent.short.toLowerCase()}`
        }
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: '#e3e0f7',
          fontFamily: 'inherit',
          fontSize: 'inherit',
        }}
      />
    </div>
  )
}

// Agent picker popover — used when user clicks the identity chip.
function AgentPicker({ open, anchor, onPick, onClose }) {
  if (!open) return null
  const agents = Object.values(window.VIMEFLOW_AGENTS)
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90 }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: anchor.y,
          left: anchor.x,
          width: 220,
          background: '#1e1e2e',
          border: '1px solid rgba(74,68,79,0.4)',
          borderRadius: 10,
          padding: 6,
          boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
        }}
      >
        {agents.map((a) => (
          <button
            key={a.id}
            onClick={() => {
              onPick(a.id)
              onClose()
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: '8px 10px',
              borderRadius: 7,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#e3e0f7',
              textAlign: 'left',
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = 'transparent')
            }
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: 5,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: a.accentDim,
                color: a.accent,
                fontWeight: 700,
              }}
            >
              {a.glyph}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  color: a.accent,
                  fontWeight: 600,
                }}
              >
                {a.short}
              </div>
              <div style={{ fontSize: 11, color: '#8a8299' }}>{a.name}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// Layout switcher — Cursor-style quick selector. 5 little SVG previews.
function LayoutSwitcher({ layoutId, onPick }) {
  const layouts = window.VIMEFLOW_LAYOUTS
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        padding: 3,
        background: 'rgba(13,13,28,0.6)',
        border: '1px solid rgba(74,68,79,0.3)',
        borderRadius: 8,
      }}
    >
      {Object.values(layouts).map((L) => (
        <button
          key={L.id}
          title={L.name}
          onClick={() => onPick(L.id)}
          style={{
            width: 26,
            height: 22,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background:
              layoutId === L.id ? 'rgba(203,166,247,0.15)' : 'transparent',
            border:
              layoutId === L.id
                ? '1px solid rgba(203,166,247,0.45)'
                : '1px solid transparent',
            borderRadius: 5,
            cursor: 'pointer',
            color: layoutId === L.id ? '#cba6f7' : '#8a8299',
          }}
        >
          <LayoutGlyph layoutId={L.id} />
        </button>
      ))}
    </div>
  )
}

function LayoutGlyph({ layoutId }) {
  // Small SVG icons that match the actual layout shape.
  const stroke = 'currentColor'
  const sw = 1.4
  const r = 1.4
  if (layoutId === 'single')
    return (
      <svg width="14" height="11" viewBox="0 0 14 11">
        <rect
          x="1"
          y="1"
          width="12"
          height="9"
          rx={r}
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
        />
      </svg>
    )
  if (layoutId === 'vsplit')
    return (
      <svg width="14" height="11" viewBox="0 0 14 11">
        <rect
          x="1"
          y="1"
          width="12"
          height="9"
          rx={r}
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
        />
        <line
          x1="7"
          y1="1.5"
          x2="7"
          y2="9.5"
          stroke={stroke}
          strokeWidth={sw}
        />
      </svg>
    )
  if (layoutId === 'hsplit')
    return (
      <svg width="14" height="11" viewBox="0 0 14 11">
        <rect
          x="1"
          y="1"
          width="12"
          height="9"
          rx={r}
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
        />
        <line
          x1="1.5"
          y1="5.5"
          x2="12.5"
          y2="5.5"
          stroke={stroke}
          strokeWidth={sw}
        />
      </svg>
    )
  if (layoutId === 'threeRight')
    return (
      <svg width="14" height="11" viewBox="0 0 14 11">
        <rect
          x="1"
          y="1"
          width="12"
          height="9"
          rx={r}
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
        />
        <line
          x1="8"
          y1="1.5"
          x2="8"
          y2="9.5"
          stroke={stroke}
          strokeWidth={sw}
        />
        <line
          x1="8"
          y1="5.5"
          x2="12.5"
          y2="5.5"
          stroke={stroke}
          strokeWidth={sw}
        />
      </svg>
    )
  if (layoutId === 'quad')
    return (
      <svg width="14" height="11" viewBox="0 0 14 11">
        <rect
          x="1"
          y="1"
          width="12"
          height="9"
          rx={r}
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
        />
        <line
          x1="7"
          y1="1.5"
          x2="7"
          y2="9.5"
          stroke={stroke}
          strokeWidth={sw}
        />
        <line
          x1="1.5"
          y1="5.5"
          x2="12.5"
          y2="5.5"
          stroke={stroke}
          strokeWidth={sw}
        />
      </svg>
    )
  return null
}

// SplitView — top-level container that lays out multiple panes.
function SplitView({
  panes,
  layoutId,
  focusedPaneId,
  onFocus,
  onClosePane,
  agentsBySession,
  paused,
}) {
  const layout =
    window.VIMEFLOW_LAYOUTS[layoutId] || window.VIMEFLOW_LAYOUTS.vsplit
  const visiblePanes = panes.slice(0, layout.capacity)

  // Build grid-template-areas string.
  const areasStr = layout.areas.map((row) => `"${row.join(' ')}"`).join(' ')

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        display: 'grid',
        gridTemplateColumns: layout.cols,
        gridTemplateRows: layout.rows,
        gridTemplateAreas: areasStr,
        gap: 8,
        padding: 10,
        background: '#0d0d1c',
      }}
    >
      {visiblePanes.map((pane, i) => {
        const agent =
          window.VIMEFLOW_AGENTS[pane.agentId] || window.VIMEFLOW_AGENTS.claude
        const session =
          agentsBySession[pane.sessionId] ||
          agentsBySession[Object.keys(agentsBySession)[0]]
        if (!session) return null
        return (
          <div
            key={pane.id}
            style={{
              gridArea: `p${i}`,
              minHeight: 0,
              minWidth: 0,
              display: 'flex',
            }}
          >
            <div
              style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex' }}
            >
              <TerminalPane
                pane={pane}
                agent={agent}
                session={session}
                focused={pane.id === focusedPaneId}
                onFocus={() => onFocus(pane.id)}
                onClose={
                  visiblePanes.length > 1 ? () => onClosePane(pane.id) : null
                }
                paused={paused}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Dock-position switcher (small inline control matching LayoutSwitcher's look).
function DockSwitcher({ position, onPick, compact }) {
  const allOpts = [
    { id: 'hidden', label: 'Hidden' },
    { id: 'bottom', label: 'Bottom' },
    { id: 'left', label: 'Left' },
    { id: 'right', label: 'Right' },
  ]
  const opts = compact ? allOpts.filter((o) => o.id !== 'hidden') : allOpts
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        padding: 3,
        background: 'rgba(13,13,28,0.6)',
        border: '1px solid rgba(74,68,79,0.3)',
        borderRadius: 8,
      }}
    >
      {opts.map((o) => (
        <button
          key={o.id}
          title={`Dock: ${o.label}`}
          onClick={() => onPick(o.id)}
          style={{
            width: 26,
            height: 22,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background:
              position === o.id ? 'rgba(203,166,247,0.15)' : 'transparent',
            border:
              position === o.id
                ? '1px solid rgba(203,166,247,0.45)'
                : '1px solid transparent',
            borderRadius: 5,
            cursor: 'pointer',
            color: position === o.id ? '#cba6f7' : '#8a8299',
          }}
        >
          <DockGlyph position={o.id} />
        </button>
      ))}
    </div>
  )
}

function DockGlyph({ position }) {
  const stroke = 'currentColor'
  const sw = 1.4
  const r = 1.4
  // Outer rect 12x9 at (1,1). The shaded sub-rect represents the dock.
  const fill = 'currentColor'
  if (position === 'hidden')
    return (
      <svg width="14" height="11" viewBox="0 0 14 11">
        <rect
          x="1"
          y="1"
          width="12"
          height="9"
          rx={r}
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
        />
      </svg>
    )
  if (position === 'bottom')
    return (
      <svg width="14" height="11" viewBox="0 0 14 11">
        <rect
          x="1"
          y="1"
          width="12"
          height="9"
          rx={r}
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
        />
        <rect
          x="2"
          y="6.5"
          width="10"
          height="3"
          rx={0.6}
          fill={fill}
          opacity="0.55"
        />
      </svg>
    )
  if (position === 'left')
    return (
      <svg width="14" height="11" viewBox="0 0 14 11">
        <rect
          x="1"
          y="1"
          width="12"
          height="9"
          rx={r}
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
        />
        <rect
          x="2"
          y="2"
          width="4"
          height="7"
          rx={0.6}
          fill={fill}
          opacity="0.55"
        />
      </svg>
    )
  if (position === 'right')
    return (
      <svg width="14" height="11" viewBox="0 0 14 11">
        <rect
          x="1"
          y="1"
          width="12"
          height="9"
          rx={r}
          fill="none"
          stroke={stroke}
          strokeWidth={sw}
        />
        <rect
          x="8"
          y="2"
          width="4"
          height="7"
          rx={0.6}
          fill={fill}
          opacity="0.55"
        />
      </svg>
    )
  return null
}

Object.assign(window, {
  SplitView,
  TerminalPane,
  LayoutSwitcher,
  LayoutGlyph,
  AgentPicker,
  DockSwitcher,
  DockGlyph,
})

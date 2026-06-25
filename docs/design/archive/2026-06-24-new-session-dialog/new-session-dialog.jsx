// Vimeflow — New Session dialog (refined Direction A).
// Name (defaults to folder) · working directory · layout · per-pane agent assignment.
const { useState, useRef, useEffect } = React

const MONO = "'JetBrains Mono', monospace"
const Icon = ({ n, s = 18, c, style }) => (
  <span
    className="material-symbols-outlined"
    style={{ fontSize: s, color: c, lineHeight: 1, ...style }}
  >
    {n}
  </span>
)

// ── Native OS folder picker with graceful fallback ─────────────
async function pickFolder(fallback) {
  try {
    if (window.showDirectoryPicker) {
      const h = await window.showDirectoryPicker({ mode: 'read' })
      return '~/' + h.name
    }
  } catch (e) {
    /* cancelled / blocked */
  }
  return fallback
}

const RECENTS = [
  {
    path: '~/code/vimeflow-core',
    abbr: 'VF',
    branch: 'feat/jose-auth',
    tone: 'var(--vf-agent-claude)',
    ago: '2m ago',
  },
  {
    path: '~/code/agent-harness',
    abbr: 'AH',
    branch: 'chore/test-harness',
    tone: 'var(--vf-agent-kimi)',
    ago: '4h ago',
  },
  {
    path: '~/code/tauri-shell',
    abbr: 'TS',
    branch: 'main',
    tone: 'var(--vf-agent-codex)',
    ago: '1d ago',
  },
]

// Agents that can occupy a pane — identity mirrors the real workspace registry
// (glyph, SHORT tag, accent + dim/soft tints). `soon` ⇒ may not ship in v1.
const AGENTS = {
  claude: {
    key: 'claude',
    name: 'Claude Code',
    short: 'CLAUDE',
    glyph: '∴',
    cli: 'claude',
    c: 'var(--vf-agent-claude)',
    dim: 'rgba(203,166,247,0.16)',
    soft: 'rgba(203,166,247,0.34)',
  },
  codex: {
    key: 'codex',
    name: 'Codex CLI',
    short: 'CODEX',
    glyph: '◇',
    cli: 'codex',
    c: 'var(--vf-agent-codex)',
    dim: 'rgba(125,239,161,0.16)',
    soft: 'rgba(125,239,161,0.34)',
  },
  kimi: {
    key: 'kimi',
    name: 'Kimi',
    short: 'KIMI',
    glyph: '◐',
    cli: 'kimi',
    c: 'var(--vf-agent-kimi)',
    dim: 'rgba(116,224,207,0.16)',
    soft: 'rgba(116,224,207,0.34)',
  },
  opencode: {
    key: 'opencode',
    name: 'opencode',
    short: 'OPNCD',
    glyph: '◈',
    cli: 'opencode',
    c: 'var(--vf-agent-opencode)',
    dim: 'rgba(247,166,212,0.16)',
    soft: 'rgba(247,166,212,0.34)',
    soon: true,
  },
  vbrowser: {
    key: 'vbrowser',
    name: 'Browser pane',
    short: 'VBROWSER',
    glyph: '◑',
    cli: 'vbrowser',
    c: 'var(--vf-agent-vbrowser)',
    dim: 'rgba(168,200,255,0.16)',
    soft: 'rgba(168,200,255,0.34)',
  },
  shell: {
    key: 'shell',
    name: 'Shell',
    short: 'SHELL',
    glyph: '$',
    cli: 'zsh',
    c: 'var(--vf-agent-shell)',
    dim: 'rgba(240,198,116,0.16)',
    soft: 'rgba(240,198,116,0.30)',
  },
}
const AGENT_ORDER = ['claude', 'codex', 'kimi', 'opencode', 'vbrowser', 'shell']
const AGENT_ORDER_UNUSED = null

// Canonical layouts (mirror window.VIMEFLOW_LAYOUTS). cap = pane capacity.
const LAYOUTS = {
  single: {
    id: 'single',
    name: 'Single',
    cap: 1,
    cols: '1fr',
    rows: '1fr',
    areas: [['p0']],
  },
  vsplit: {
    id: 'vsplit',
    name: 'Vertical',
    cap: 2,
    cols: '1fr 1fr',
    rows: '1fr',
    areas: [['p0', 'p1']],
  },
  hsplit: {
    id: 'hsplit',
    name: 'Horizontal',
    cap: 2,
    cols: '1fr',
    rows: '1fr 1fr',
    areas: [['p0'], ['p1']],
  },
  threeRight: {
    id: 'threeRight',
    name: 'Main + 2',
    cap: 3,
    cols: '1.4fr 1fr',
    rows: '1fr 1fr',
    areas: [
      ['p0', 'p1'],
      ['p0', 'p2'],
    ],
  },
  quad: {
    id: 'quad',
    name: 'Quad',
    cap: 4,
    cols: '1fr 1fr',
    rows: '1fr 1fr',
    areas: [
      ['p0', 'p1'],
      ['p2', 'p3'],
    ],
  },
}
const LAYOUT_ORDER = ['single', 'vsplit', 'hsplit', 'threeRight', 'quad']
// Quick layouts shown vertically; the rest live behind "More layouts".
const QUICK_LAYOUTS = ['single', 'vsplit', 'hsplit']

// Tiny SVG glyph matching each layout shape (matches the app's switcher).
function LayoutGlyph({ id, active }) {
  const st = active ? 'var(--vf-accent)' : 'var(--vf-text-2)'
  const sw = 1.4,
    r = 1.4
  const W = 16,
    H = 12
  const frame = (
    <rect
      x="1"
      y="1"
      width={W - 2}
      height={H - 2}
      rx={r}
      fill="none"
      stroke={st}
      strokeWidth={sw}
    />
  )
  const lines = {
    single: null,
    vsplit: (
      <line
        x1={W / 2}
        y1="1"
        x2={W / 2}
        y2={H - 1}
        stroke={st}
        strokeWidth={sw}
      />
    ),
    hsplit: (
      <line
        x1="1"
        y1={H / 2}
        x2={W - 1}
        y2={H / 2}
        stroke={st}
        strokeWidth={sw}
      />
    ),
    threeRight: (
      <>
        <line
          x1="9.4"
          y1="1"
          x2="9.4"
          y2={H - 1}
          stroke={st}
          strokeWidth={sw}
        />
        <line
          x1="9.4"
          y1={H / 2}
          x2={W - 1}
          y2={H / 2}
          stroke={st}
          strokeWidth={sw}
        />
      </>
    ),
    quad: (
      <>
        <line
          x1={W / 2}
          y1="1"
          x2={W / 2}
          y2={H - 1}
          stroke={st}
          strokeWidth={sw}
        />
        <line
          x1="1"
          y1={H / 2}
          x2={W - 1}
          y2={H / 2}
          stroke={st}
          strokeWidth={sw}
        />
      </>
    ),
  }
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      {frame}
      {lines[id]}
    </svg>
  )
}

function AgentDot({ c, size = 9 }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 99,
        background: c,
        display: 'inline-block',
        flexShrink: 0,
        boxShadow: `0 0 8px ${c}55`,
      }}
    />
  )
}

function PathCrumb({ path, size = 12.5 }) {
  const parts = path.split('/').filter(Boolean)
  return (
    <span
      style={{
        fontFamily: MONO,
        fontSize: size,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {parts.map((p, i) => {
        const last = i === parts.length - 1,
          home = p === '~'
        return (
          <React.Fragment key={i}>
            {i > 0 && <span style={{ color: 'var(--vf-text-3)' }}>/</span>}
            <span
              style={{
                color: home
                  ? 'var(--vf-text-3)'
                  : last
                    ? 'var(--vf-accent-bright)'
                    : 'var(--vf-text-2)',
                fontWeight: last && !home ? 600 : 400,
              }}
            >
              {p}
            </span>
          </React.Fragment>
        )
      })}
    </span>
  )
}

const baseOf = (p) => p.split('/').filter(Boolean).pop()

// ── Per-pane agent assignment board ────────────────────────────
// Renders the chosen layout at scale; each pane is a button that opens a
// small agent menu. Pane labels default to the agent CLI and are editable.
function Cursor({ c }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 6,
        height: 11,
        background: c || 'var(--vf-accent)',
        marginLeft: 1,
        verticalAlign: '-1px',
        animation: 'vfBlink 1.1s steps(1) infinite',
      }}
    />
  )
}

// Floating popup anchored to a trigger rect. Rendered position:fixed so it
// escapes the dialog's scroll container and never grows the dialog height.
function FloatingMenu({ anchor, width, onClose, children }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({
    left: anchor.left,
    top: anchor.bottom + 5,
    ready: false,
  })
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const h = el.offsetHeight,
      w = width || el.offsetWidth
    const vw = window.innerWidth,
      vh = window.innerHeight,
      m = 8
    let top = anchor.bottom + 5
    if (top + h > vh - m) top = Math.max(m, anchor.top - h - 5) // flip up
    let left = anchor.left
    if (left + w > vw - m) left = Math.max(m, vw - m - w) // clamp right
    setPos({ left, top, ready: true })
  }, [anchor, width])
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 100 }}
      />
      <div
        ref={ref}
        style={{
          position: 'fixed',
          left: pos.left,
          top: pos.top,
          width,
          zIndex: 101,
          visibility: pos.ready ? 'visible' : 'hidden',
          background: 'rgba(var(--vf-surface-2-rgb),0.98)',
          border: '1px solid rgba(var(--vf-outline-rgb),0.5)',
          borderRadius: 10,
          padding: 5,
          boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
          backdropFilter: 'blur(8px)',
          animation: 'vfPop 140ms ease',
        }}
      >
        {children}
      </div>
    </>
  )
}

function LayoutBoard({ layout, assign, onAssign }) {
  const [openPane, setOpenPane] = useState(null) // { i, anchor } | null
  const areasStr = layout.areas.map((row) => `"${row.join(' ')}"`).join(' ')
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: layout.cols,
        gridTemplateRows: layout.rows,
        gridTemplateAreas: areasStr,
        gap: 8,
        height: 150,
      }}
    >
      {Array.from({ length: layout.cap }).map((_, i) => {
        const ag = AGENTS[assign[i]] || AGENTS.shell
        const open = openPane && openPane.i === i
        return (
          <div
            key={i}
            style={{ gridArea: `p${i}`, position: 'relative', minWidth: 0 }}
          >
            {/* skeleton pane — click to choose its starting command */}
            <button
              onClick={(e) =>
                setOpenPane(
                  open
                    ? null
                    : { i, anchor: e.currentTarget.getBoundingClientRect() }
                )
              }
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 7,
                minWidth: 0,
                background: open ? ag.dim : 'var(--vf-surface-0)',
                borderRadius: 10,
                cursor: 'pointer',
                textAlign: 'center',
                padding: 8,
                border: `1px ${open ? 'solid' : 'dashed'} ${open ? ag.c : 'rgba(74,68,79,0.55)'}`,
                transition: 'background 160ms ease, border-color 160ms ease',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: ag.dim,
                  border: `1px solid ${ag.soft}`,
                  color: ag.c,
                  fontFamily: MONO,
                  fontSize: 16,
                  flexShrink: 0,
                }}
              >
                {ag.glyph}
              </span>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--vf-text-1)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {ag.name}
                </span>
                {ag.soon && <span style={soonPill}>soon</span>}
              </span>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 10,
                  color: 'var(--vf-text-3)',
                  fontFamily: MONO,
                }}
              >
                {ag.cli}
                <Icon n="expand_more" s={13} c="var(--vf-text-3)" />
              </span>
            </button>
            {open && (
              <FloatingMenu
                anchor={openPane.anchor}
                width={210}
                onClose={() => setOpenPane(null)}
              >
                {AGENT_ORDER.map((k) => {
                  const a = AGENTS[k],
                    on = assign[i] === k
                  return (
                    <div
                      key={k}
                      onClick={() => {
                        onAssign(i, k)
                        setOpenPane(null)
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 9,
                        padding: '8px 10px',
                        borderRadius: 7,
                        cursor: 'pointer',
                        background: on
                          ? 'rgba(var(--vf-accent-rgb),0.12)'
                          : 'transparent',
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: 20,
                          height: 20,
                          borderRadius: 5,
                          background: a.dim,
                          border: `1px solid ${a.soft}`,
                          color: a.c,
                          fontFamily: MONO,
                          fontSize: 11,
                          flexShrink: 0,
                        }}
                      >
                        {a.glyph}
                      </span>
                      <span
                        style={{
                          flex: 1,
                          fontSize: 12.5,
                          color: 'var(--vf-text-1)',
                        }}
                      >
                        {a.name}
                      </span>
                      <span
                        style={{
                          fontFamily: MONO,
                          fontSize: 10.5,
                          color: 'var(--vf-text-3)',
                        }}
                      >
                        {a.cli}
                      </span>
                      {a.soon && <span style={soonPill}>soon</span>}
                      {on && <Icon n="check" s={15} c="var(--vf-accent)" />}
                    </div>
                  )
                })}
              </FloatingMenu>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── The dialog ─────────────────────────────────────────────────
function NewSessionDialog() {
  const [path, setPath] = useState('~/code/vimeflow-core')
  const [name, setName] = useState('vimeflow-core')
  const [nameEdited, setNameEdited] = useState(false)
  const [layoutId, setLayoutId] = useState('vsplit')
  const [layoutMenu, setLayoutMenu] = useState(null) // trigger rect | null
  const [extra, setExtra] = useState(null) // a 'more' layout the user picked — keep it pinned in the quick list
  const [assign, setAssign] = useState(['claude', 'shell', 'shell', 'shell'])
  const layout = LAYOUTS[layoutId]
  const visibleLayouts =
    extra && !QUICK_LAYOUTS.includes(extra)
      ? [...QUICK_LAYOUTS, extra]
      : QUICK_LAYOUTS
  const recMatch = RECENTS.find((r) => r.path === path)
  const branch = recMatch ? recMatch.branch : 'main'

  // Name defaults to folder basename until the user types their own.
  const applyPath = (p) => {
    setPath(p)
    if (!nameEdited) setName(baseOf(p))
  }

  return (
    <div style={dialog}>
      {/* header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '16px 20px',
          borderBottom: '1px solid rgba(var(--vf-outline-rgb),0.25)',
        }}
      >
        <Icon n="bolt" s={17} c="var(--vf-accent)" />
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>New session</span>
        <span style={{ flex: 1 }} />
        <button style={iconGhost}>
          <Icon n="close" s={17} c="var(--vf-text-3)" />
        </button>
      </div>

      <div
        className="vfscroll"
        style={{
          padding: '18px 20px 24px',
          overflow: 'auto',
          height: 'min(600px, 70vh)',
        }}
      >
        {/* Session name */}
        <label style={fieldLabel}>Session name</label>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            marginTop: 8,
            padding: '10px 12px',
            background: 'var(--vf-surface-0)',
            border: '1px solid rgba(var(--vf-outline-rgb),0.5)',
            borderRadius: 9,
          }}
        >
          <Icon n="edit" s={15} c="var(--vf-text-3)" />
          <input
            value={name}
            spellCheck={false}
            onChange={(e) => {
              setName(e.target.value)
              setNameEdited(true)
            }}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--vf-text)',
              fontSize: 13,
              fontWeight: 500,
            }}
          />
          {!nameEdited ? (
            <span style={hintPill}>folder name</span>
          ) : (
            <button
              onClick={() => {
                setNameEdited(false)
                setName(baseOf(path))
              }}
              style={{
                ...hintPill,
                cursor: 'pointer',
                borderColor: 'rgba(var(--vf-accent-rgb),0.4)',
                color: 'var(--vf-accent)',
              }}
            >
              reset
            </button>
          )}
        </div>

        {/* Working directory */}
        <label style={{ ...fieldLabel, marginTop: 18, display: 'block' }}>
          Working directory
        </label>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '10px 12px',
              background: 'var(--vf-surface-0)',
              border: '1px solid rgba(var(--vf-accent-rgb),0.3)',
              borderRadius: 9,
              minWidth: 0,
            }}
          >
            <Icon n="folder_open" s={16} c="var(--vf-accent)" />
            <PathCrumb path={path} />
          </div>
          <button
            onClick={async () =>
              applyPath(await pickFolder('~/Developer/new-project'))
            }
            style={browseBtn}
          >
            <Icon n="drive_folder_upload" s={15} c="var(--vf-text-1)" />
            Browse…
          </button>
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            marginTop: 8,
          }}
        >
          {RECENTS.map((r) => {
            const on = r.path === path
            return (
              <div
                key={r.path}
                onClick={() => applyPath(r.path)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 11,
                  padding: '8px 10px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: on
                    ? 'rgba(var(--vf-accent-rgb),0.1)'
                    : 'transparent',
                  border: on
                    ? '1px solid rgba(var(--vf-accent-rgb),0.28)'
                    : '1px solid transparent',
                }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    background: `color-mix(in srgb, ${r.tone} 18%, transparent)`,
                    color: r.tone,
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 9.5,
                    fontWeight: 700,
                    fontFamily: MONO,
                    flexShrink: 0,
                  }}
                >
                  {r.abbr}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <PathCrumb path={r.path} size={12} />
                </span>
                {r.branch && (
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      color: 'var(--vf-text-3)',
                      fontFamily: MONO,
                      fontSize: 10.5,
                    }}
                  >
                    <Icon n="fork_right" s={12} c="var(--vf-text-3)" />
                    {r.branch}
                  </span>
                )}
                <span style={{ color: 'var(--vf-text-3)', fontSize: 10.5 }}>
                  {r.ago}
                </span>
              </div>
            )
          })}
        </div>

        {/* Layout (left, vertical) + command board (right) — side by side.
            minHeight reserves room for the tallest state (extra layout pinned)
            so the dialog never changes height when you switch layouts. */}
        <div
          style={{
            display: 'flex',
            gap: 16,
            marginTop: 18,
            alignItems: 'flex-start',
            minHeight: 232,
          }}
        >
          {/* layout column */}
          <div style={{ width: 158, flexShrink: 0 }}>
            <label style={fieldLabel}>Layout</label>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
                marginTop: 8,
              }}
            >
              {visibleLayouts.map((id) => {
                const on = id === layoutId
                return (
                  <button
                    key={id}
                    onClick={() => setLayoutId(id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 10px',
                      borderRadius: 9,
                      cursor: 'pointer',
                      textAlign: 'left',
                      background: on
                        ? 'rgba(var(--vf-accent-rgb),0.12)'
                        : 'var(--vf-surface-0)',
                      border: on
                        ? '1px solid rgba(var(--vf-accent-rgb),0.45)'
                        : '1px solid rgba(var(--vf-outline-rgb),0.4)',
                    }}
                  >
                    <span style={{ display: 'inline-flex', flexShrink: 0 }}>
                      <LayoutGlyph id={id} active={on} />
                    </span>
                    <span
                      style={{
                        flex: 1,
                        fontSize: 12,
                        color: on
                          ? 'var(--vf-accent-bright)'
                          : 'var(--vf-text-1)',
                        fontWeight: on ? 600 : 400,
                      }}
                    >
                      {LAYOUTS[id].name}
                    </span>
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 10,
                        color: 'var(--vf-text-3)',
                      }}
                    >
                      {LAYOUTS[id].cap}
                    </span>
                  </button>
                )
              })}
              {/* More menu for layouts not in the quick list */}
              <div>
                <button
                  onClick={(e) =>
                    setLayoutMenu(
                      layoutMenu
                        ? null
                        : e.currentTarget.getBoundingClientRect()
                    )
                  }
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 9,
                    cursor: 'pointer',
                    textAlign: 'left',
                    background: 'transparent',
                    border: '1px dashed rgba(var(--vf-outline-rgb),0.5)',
                    color: 'var(--vf-text-2)',
                    fontSize: 12,
                  }}
                >
                  <Icon n="more_horiz" s={16} c="var(--vf-text-3)" />
                  <span style={{ flex: 1 }}>More layouts</span>
                  <Icon
                    n={layoutMenu ? 'expand_less' : 'expand_more'}
                    s={15}
                    c="var(--vf-text-3)"
                  />
                </button>
                {layoutMenu && (
                  <FloatingMenu
                    anchor={layoutMenu}
                    width={200}
                    onClose={() => setLayoutMenu(null)}
                  >
                    {LAYOUT_ORDER.map((id) => {
                      const on = id === layoutId
                      return (
                        <div
                          key={id}
                          onClick={() => {
                            setLayoutId(id)
                            if (!QUICK_LAYOUTS.includes(id)) setExtra(id)
                            setLayoutMenu(null)
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '8px 10px',
                            borderRadius: 7,
                            cursor: 'pointer',
                            background: on
                              ? 'rgba(var(--vf-accent-rgb),0.12)'
                              : 'transparent',
                          }}
                        >
                          <LayoutGlyph id={id} active={on} />
                          <span
                            style={{
                              flex: 1,
                              fontSize: 12.5,
                              color: 'var(--vf-text-1)',
                            }}
                          >
                            {LAYOUTS[id].name}
                          </span>
                          <span
                            style={{
                              fontFamily: MONO,
                              fontSize: 10,
                              color: 'var(--vf-text-3)',
                            }}
                          >
                            {LAYOUTS[id].cap} pane
                            {LAYOUTS[id].cap > 1 ? 's' : ''}
                          </span>
                          {on && <Icon n="check" s={15} c="var(--vf-accent)" />}
                        </div>
                      )
                    })}
                  </FloatingMenu>
                )}
              </div>
            </div>
          </div>

          {/* command board column */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <label style={fieldLabel}>Starting command</label>
            </div>
            <div
              style={{ fontSize: 11, color: 'var(--vf-text-3)', marginTop: 3 }}
            >
              click a panel to choose what it opens with
            </div>
            <div style={{ marginTop: 10 }}>
              <LayoutBoard
                layout={layout}
                assign={assign}
                onAssign={(i, k) =>
                  setAssign((a) => {
                    const n = [...a]
                    n[i] = k
                    return n
                  })
                }
              />
            </div>
          </div>
        </div>
      </div>

      {/* footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 20px',
          borderTop: '1px solid rgba(var(--vf-outline-rgb),0.2)',
          background: 'rgba(var(--vf-surface-0-rgb),0.4)',
        }}
      >
        <span
          style={{ fontSize: 11, color: 'var(--vf-text-3)', fontFamily: MONO }}
        >
          {layout.cap} pane{layout.cap > 1 ? 's' : ''} · {baseOf(path)}
        </span>
        <span style={{ flex: 1 }} />
        <button style={ghostBtn}>Cancel</button>
        <button style={primaryBtn}>
          <Icon n="bolt" s={15} c="var(--vf-surface-0)" />
          Create session
        </button>
      </div>
    </div>
  )
}

function NewSessionApp() {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        minHeight: '100vh',
        background:
          'radial-gradient(1100px circle at 20% -10%, rgba(203,166,247,0.07), transparent 45%), radial-gradient(900px circle at 100% 110%, rgba(116,224,207,0.05), transparent 50%), var(--vf-bg)',
        display: 'grid',
        placeItems: 'center',
        padding: 40,
      }}
    >
      <NewSessionDialog />
    </div>
  )
}

// ── styles ─────────────────────────────────────────────────────
const dialog = {
  width: 560,
  maxWidth: '100%',
  background: 'rgba(var(--vf-surface-2-rgb),0.96)',
  border: '1px solid rgba(var(--vf-accent-bright-rgb),0.18)',
  borderRadius: 14,
  boxShadow:
    '0 30px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(var(--vf-accent-rgb),0.08)',
  overflow: 'hidden',
}
const fieldLabel = {
  fontSize: 10.5,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: 'var(--vf-text-3)',
  fontWeight: 600,
}
const browseBtn = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  padding: '0 14px',
  borderRadius: 9,
  cursor: 'pointer',
  background: 'var(--vf-surface-3)',
  border: '1px solid rgba(var(--vf-outline-rgb),0.5)',
  color: 'var(--vf-text-1)',
  fontSize: 12,
  fontWeight: 500,
  whiteSpace: 'nowrap',
}
const ghostBtn = {
  padding: '9px 16px',
  borderRadius: 9,
  cursor: 'pointer',
  background: 'transparent',
  border: '1px solid rgba(var(--vf-outline-rgb),0.5)',
  color: 'var(--vf-text-1)',
  fontSize: 12.5,
}
const primaryBtn = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  padding: '9px 16px',
  borderRadius: 9,
  cursor: 'pointer',
  background: 'var(--vf-accent)',
  border: '1px solid var(--vf-accent)',
  color: 'var(--vf-surface-0)',
  fontSize: 12.5,
  fontWeight: 600,
}
const iconGhost = {
  width: 28,
  height: 28,
  display: 'grid',
  placeItems: 'center',
  borderRadius: 7,
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
}
const hintPill = {
  fontSize: 9.5,
  fontFamily: MONO,
  color: 'var(--vf-text-3)',
  padding: '2px 7px',
  borderRadius: 99,
  border: '1px solid rgba(var(--vf-outline-rgb),0.5)',
  background: 'transparent',
}
const soonPill = {
  fontSize: 8.5,
  fontFamily: MONO,
  letterSpacing: '.04em',
  textTransform: 'uppercase',
  color: 'var(--vf-agent-kimi)',
  padding: '1px 5px',
  borderRadius: 99,
  border: '1px solid color-mix(in srgb, var(--vf-agent-kimi) 45%, transparent)',
  background: 'color-mix(in srgb, var(--vf-agent-kimi) 12%, transparent)',
}
const agentMenu = {
  position: 'absolute',
  top: 'calc(100% + 5px)',
  left: 0,
  zIndex: 20,
  minWidth: 190,
  background: 'rgba(var(--vf-surface-2-rgb),0.98)',
  border: '1px solid rgba(var(--vf-outline-rgb),0.5)',
  borderRadius: 10,
  padding: 5,
  boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
  animation: 'vfPop 140ms ease',
}

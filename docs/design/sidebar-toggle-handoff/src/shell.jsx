// Vimeflow — shell: left icon rail, left sidebar (sessions + tree), right activity panel.

// ---------- Sidebar toggle (Codex-style panel-left glyph) ------------------
// Rounded-rect "panel" icon. With the left rail filled = sidebar is showing
// (click to hide). Plain rect = sidebar hidden (click to show). Lives in the
// sidebar header when expanded, and hops into the icon rail when collapsed.
function SidebarToggle({ collapsed, onClick, size = 28 }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={collapsed ? 'Show sidebar  ⌘B' : 'Hide sidebar  ⌘B'}
      aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
      aria-pressed={collapsed}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 7,
        border: '1px solid transparent',
        background: hover ? 'rgba(226,199,255,0.08)' : 'transparent',
        color: hover ? '#e2c7ff' : '#8a8299',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 140ms ease',
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <rect
          x="1.6"
          y="2.6"
          width="12.8"
          height="10.8"
          rx="2.4"
          stroke="currentColor"
          strokeWidth="1.3"
        />
        <path d="M5.9 2.9V13.1" stroke="currentColor" strokeWidth="1.3" />
        {!collapsed && (
          <rect
            x="2.2"
            y="3.2"
            width="3.1"
            height="9.6"
            rx="1.4"
            fill="currentColor"
            fillOpacity="0.28"
          />
        )}
      </svg>
    </button>
  )
}

// ---------- Icon rail (48px) — nav between top-level areas -----------------
function IconRail({
  activeArea,
  onArea,
  onCommand,
  onSettings,
  sidebarCollapsed,
  onToggleSidebar,
}) {
  // Top-level area items are now driven from session tabs / dock, not the rail.
  // The rail focuses on identity (top) and global utilities (bottom).
  const bottom = [
    {
      id: 'cmd',
      icon: 'terminal',
      label: 'Command Palette (⌘K)',
      onClick: onCommand,
    },
    {
      id: 'settings',
      icon: 'settings',
      label: 'Settings',
      onClick: onSettings,
    },
  ]

  return (
    <nav
      style={{
        width: 48,
        flexShrink: 0,
        height: '100%',
        background: '#0d0d1c',
        borderRight: '1px solid rgba(74,68,79,0.25)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 10,
        paddingBottom: 10,
        zIndex: 5,
      }}
    >
      {/* Sidebar expand control — only present while the sidebar is collapsed */}
      {sidebarCollapsed && (
        <div style={{ marginBottom: 8 }}>
          <SidebarToggle collapsed={true} onClick={onToggleSidebar} size={34} />
        </div>
      )}

      <div style={{ flex: 1 }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {bottom.map((it) => (
          <RailBtn key={it.id} {...it} />
        ))}
      </div>
    </nav>
  )
}
function RailBtn({ icon, label, active, onClick }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      title={label}
      style={{
        width: 34,
        height: 34,
        borderRadius: 8,
        background: active
          ? 'rgba(203,166,247,0.14)'
          : hover
            ? 'rgba(226,199,255,0.06)'
            : 'transparent',
        border: active
          ? '1px solid rgba(203,166,247,0.32)'
          : '1px solid transparent',
        color: active ? '#e2c7ff' : '#8a8299',
        display: 'grid',
        placeItems: 'center',
        cursor: 'pointer',
        transition: 'all 160ms ease',
        position: 'relative',
      }}
    >
      {active && (
        <span
          style={{
            position: 'absolute',
            left: -10,
            top: 8,
            bottom: 8,
            width: 2,
            background: '#cba6f7',
            borderRadius: 2,
          }}
        />
      )}
      <Icon name={icon} size={18} />
    </button>
  )
}

// ---------- Sidebar — session list + file tree entry -----------------------
function Sidebar({
  sessions,
  activeId,
  onPick,
  tree,
  onCtx,
  density,
  onToggleSidebar,
}) {
  const [pane, setPane] = useState('sessions') // 'sessions' | 'files' | 'context'
  const compact = density === 'compact'
  return (
    <aside
      style={{
        width: compact ? 248 : 272,
        flexShrink: 0,
        height: '100%',
        background: '#141424',
        borderRight: '1px solid rgba(74,68,79,0.25)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header: project switcher */}
      <div
        style={{
          padding: '14px 14px 10px',
          borderBottom: '1px solid rgba(74,68,79,0.18)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              flexShrink: 0,
              background: 'linear-gradient(135deg,#cba6f7,#57377f)',
              display: 'grid',
              placeItems: 'center',
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 700,
              fontSize: 10,
              color: '#2a1646',
              letterSpacing: '-0.02em',
            }}
          >
            VF
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontFamily: "'Instrument Sans', system-ui",
                fontSize: 13.5,
                fontWeight: 600,
                color: '#e3e0f7',
              }}
            >
              vimeflow-core
            </div>
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                color: '#8a8299',
                marginTop: 1,
              }}
            >
              feat/jose-auth
            </div>
          </div>
          <Icon
            name="unfold_more"
            size={16}
            style={{ color: '#8a8299', cursor: 'pointer' }}
          />
          <SidebarToggle collapsed={false} onClick={onToggleSidebar} />
        </div>
      </div>

      {/* View switcher — a real segmented control so the panes read as switchable */}
      <SidebarViewSwitcher
        pane={pane}
        sessionCount={sessions.length}
        onChange={(id) => {
          setPane(id)
          if (id === 'context') onCtx && onCtx()
        }}
      />

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {pane === 'sessions' && (
          <ScrollArea style={{ height: '100%', padding: '10px 10px 16px' }}>
            <SectionLabel style={{ margin: '6px 4px 8px' }}>
              Active ·{' '}
              {
                sessions.filter(
                  (s) => s.state === 'running' || s.state === 'awaiting'
                ).length
              }
            </SectionLabel>
            {sessions
              .filter((s) => s.state === 'running' || s.state === 'awaiting')
              .map((s) => (
                <SessionCard
                  key={s.id}
                  s={s}
                  active={activeId === s.id}
                  onClick={() => onPick(s.id)}
                  compact={compact}
                />
              ))}
            <SectionLabel style={{ margin: '14px 4px 8px' }}>
              Recent
            </SectionLabel>
            {sessions
              .filter((s) => s.state !== 'running' && s.state !== 'awaiting')
              .map((s) => (
                <SessionCard
                  key={s.id}
                  s={s}
                  active={activeId === s.id}
                  onClick={() => onPick(s.id)}
                  compact={compact}
                />
              ))}
            <button
              style={{
                marginTop: 10,
                width: '100%',
                padding: '9px 10px',
                borderRadius: 8,
                background: 'transparent',
                border: '1px dashed rgba(74,68,79,0.5)',
                color: '#8a8299',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <Icon name="add" size={14} /> new session
            </button>
          </ScrollArea>
        )}
        {pane === 'files' && <FileTreePane tree={tree} compact={compact} />}
        {pane === 'context' && <ContextPane compact={compact} />}
      </div>
    </aside>
  )
}

function SessionCard({ s, active, onClick, compact }) {
  const label = {
    running: { tone: 'success', text: `running · ${s.startedAgo}` },
    awaiting: { tone: 'warn', text: `awaits you · ${s.startedAgo}` },
    completed: { tone: 'primary', text: `done · ${s.updated}` },
    errored: { tone: 'error', text: `errored · ${s.updated}` },
    idle: { tone: 'neutral', text: `idle` },
  }[s.state]

  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: compact ? '8px 9px' : '10px 11px',
        borderRadius: 8,
        marginBottom: 4,
        background: active ? 'rgba(226,199,255,0.07)' : 'transparent',
        border: active
          ? '1px solid rgba(203,166,247,0.35)'
          : '1px solid transparent',
        cursor: 'pointer',
        transition: 'background 160ms ease',
        position: 'relative',
      }}
    >
      {active && (
        <span
          style={{
            position: 'absolute',
            left: -1,
            top: 8,
            bottom: 8,
            width: 2,
            background: '#cba6f7',
            borderRadius: 2,
          }}
        />
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 4,
        }}
      >
        <StatusDot state={s.state} size={7} />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: "'Instrument Sans', system-ui",
            fontSize: 13,
            fontWeight: 600,
            color: '#e3e0f7',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {s.title}
        </span>
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9.5,
            color: '#6c7086',
            flexShrink: 0,
          }}
        >
          {s.turns > 0 ? `${s.turns}↵` : '—'}
        </span>
      </div>
      {!compact && (
        <div
          style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 11,
            color: '#8a8299',
            lineHeight: 1.35,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {s.subtitle}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: compact ? 2 : 6,
        }}
      >
        <Chip tone={label.tone} style={{ padding: '1px 6px', fontSize: 9 }}>
          {label.text}
        </Chip>
        <span style={{ flex: 1 }} />
        {s.changes.added > 0 && (
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              color: '#7defa1',
            }}
          >
            +{s.changes.added}
          </span>
        )}
        {s.changes.removed > 0 && (
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              color: '#ff94a5',
            }}
          >
            −{s.changes.removed}
          </span>
        )}
      </div>
    </button>
  )
}

// ---------- File tree pane --------------------------------------------------
function FileTreePane({ tree, compact }) {
  return (
    <ScrollArea style={{ height: '100%', padding: '10px 6px 16px' }}>
      <SectionLabel style={{ margin: '6px 8px 8px' }}>Explorer</SectionLabel>
      <TreeNode node={tree} depth={0} />
    </ScrollArea>
  )
}
function TreeNode({ node, depth }) {
  const [open, setOpen] = useState(!!node.expanded)
  const isFolder = node.type === 'folder'
  const gitColor = { M: '#f0c674', A: '#7defa1', D: '#ff94a5' }[node.git]
  const langIcon =
    {
      ts: 'data_object',
      tsx: 'data_object',
      json: 'data_object',
      md: 'description',
    }[node.lang] || 'draft'

  return (
    <>
      <div
        onClick={() => isFolder && setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '4px 6px 4px',
          paddingLeft: 6 + depth * 14,
          borderRadius: 4,
          background: node.active ? 'rgba(226,199,255,0.08)' : 'transparent',
          cursor: 'pointer',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11.5,
          color: node.active ? '#e2c7ff' : '#cdc3d1',
        }}
      >
        {isFolder && (
          <Icon
            name={open ? 'expand_more' : 'chevron_right'}
            size={14}
            style={{ color: '#6c7086' }}
          />
        )}
        {!isFolder && <span style={{ width: 14 }} />}
        <Icon
          name={isFolder ? (open ? 'folder_open' : 'folder') : langIcon}
          size={14}
          style={{ color: isFolder ? '#cba6f7' : '#8a8299' }}
        />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {node.name}
        </span>
        {node.git && (
          <span
            style={{
              width: 14,
              textAlign: 'center',
              fontSize: 9.5,
              fontWeight: 700,
              color: gitColor,
            }}
          >
            {node.git}
          </span>
        )}
      </div>
      {isFolder &&
        open &&
        node.children &&
        node.children.map((c, i) => (
          <TreeNode key={i} node={c} depth={depth + 1} />
        ))}
    </>
  )
}

// ---------- Context bucket pane --------------------------------------------
function ContextPane({ compact }) {
  const items = [
    { name: 'src/middleware/auth.ts', tokens: 420, kind: 'file' },
    { name: 'src/utils/jwt.ts', tokens: 180, kind: 'file' },
    { name: 'DESIGN.md', tokens: 3400, kind: 'file' },
    { name: 'pinned prompt: "migrate jose"', tokens: 180, kind: 'prompt' },
    { name: 'stacktrace: auth.test.ts', tokens: 740, kind: 'trace' },
  ]
  return (
    <ScrollArea style={{ height: '100%', padding: '10px 10px 16px' }}>
      <SectionLabel style={{ margin: '6px 4px 8px' }}>
        Context bucket · {items.length}
      </SectionLabel>
      {items.map((it, i) => (
        <div
          key={i}
          style={{
            padding: '8px 10px',
            marginBottom: 4,
            borderRadius: 7,
            background: 'rgba(26,26,42,0.5)',
            border: '1px solid rgba(74,68,79,0.15)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Icon
            name={
              { file: 'draft', prompt: 'bolt', trace: 'bug_report' }[it.kind]
            }
            size={14}
            style={{
              color:
                it.kind === 'trace'
                  ? '#ff94a5'
                  : it.kind === 'prompt'
                    ? '#cba6f7'
                    : '#8a8299',
            }}
          />
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10.5,
              color: '#cdc3d1',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {it.name}
          </span>
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 9.5,
              color: '#6c7086',
            }}
          >
            {it.tokens}t
          </span>
        </div>
      ))}
    </ScrollArea>
  )
}

// ---------- Sidebar view switcher (segmented control) ----------------------
// The old version was three uppercase mono labels with a near-invisible active
// tint — they read as static section headers, so first-time users never knew
// the panes were switchable. This is a proper segmented control: a recessed
// track, an animated lavender thumb, icon + label per segment. Sessions/Files
// are the two primary views (per UNIFIED.md); Context is a compact trailing
// toggle so it stays reachable without crowding the primary switch.
function SidebarViewSwitcher({ pane, sessionCount, onChange }) {
  const segs = [
    { id: 'sessions', label: 'Sessions', icon: 'bolt', count: sessionCount },
    { id: 'files', label: 'Files', icon: 'folder_open', count: null },
  ]
  const ctxActive = pane === 'context'
  const activeIndex = Math.max(
    0,
    segs.findIndex((t) => t.id === pane)
  ) // -1 (context) clamps to 0 visually; thumb hidden when context active
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 8,
        padding: '10px 12px 12px',
        borderBottom: '1px solid rgba(74,68,79,0.18)',
      }}
    >
      {/* Primary segmented control */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          minWidth: 0,
          display: 'flex',
          padding: 3,
          background: 'rgba(13,13,28,0.7)',
          border: '1px solid rgba(74,68,79,0.3)',
          borderRadius: 10,
          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.4)',
        }}
      >
        {/* Sliding active thumb (only while a segment owns the pane) */}
        <div
          style={{
            position: 'absolute',
            top: 3,
            bottom: 3,
            left: 3,
            width: `calc((100% - 6px) / ${segs.length})`,
            transform: `translateX(${activeIndex * 100}%)`,
            background:
              'linear-gradient(135deg, rgba(203,166,247,0.3), rgba(203,166,247,0.13))',
            border: '1px solid rgba(203,166,247,0.5)',
            borderRadius: 7,
            boxShadow:
              '0 0 14px rgba(203,166,247,0.2), 0 1px 2px rgba(0,0,0,0.35)',
            opacity: ctxActive ? 0 : 1,
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />
        {segs.map((t) => (
          <SegTab
            key={t.id}
            tab={t}
            active={pane === t.id}
            onClick={() => onChange(t.id)}
          />
        ))}
      </div>

      {/* Context — secondary pane, icon-only toggle */}
      <button
        onClick={() => onChange('context')}
        title="Context bucket"
        style={{
          width: 38,
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
          borderRadius: 9,
          cursor: 'pointer',
          background: ctxActive
            ? 'rgba(203,166,247,0.18)'
            : 'rgba(13,13,28,0.7)',
          border: ctxActive
            ? '1px solid rgba(203,166,247,0.5)'
            : '1px solid rgba(74,68,79,0.3)',
          color: ctxActive ? '#e2c7ff' : '#7c7689',
          boxShadow: ctxActive
            ? '0 0 12px rgba(203,166,247,0.18)'
            : 'inset 0 1px 2px rgba(0,0,0,0.4)',
        }}
      >
        <Icon name="data_usage" size={16} fill={ctxActive ? 1 : 0} />
      </button>
    </div>
  )
}
function SegTab({ tab, active, onClick }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={tab.label}
      style={{
        position: 'relative',
        zIndex: 1,
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        padding: '8px 5px',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: active ? '#e9dcff' : hover ? '#cdc3d1' : '#7c7689',
      }}
    >
      <Icon
        name={tab.icon}
        size={14}
        fill={active ? 1 : 0}
        style={{ color: active ? '#e2c7ff' : 'inherit', flexShrink: 0 }}
      />
      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.02em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {tab.label}
      </span>
      {tab.count != null && (
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9,
            fontWeight: 700,
            flexShrink: 0,
            marginLeft: 1,
            color: active ? '#cba6f7' : '#6c7086',
          }}
        >
          {tab.count}
        </span>
      )}
    </button>
  )
}

Object.assign(window, { IconRail, Sidebar })

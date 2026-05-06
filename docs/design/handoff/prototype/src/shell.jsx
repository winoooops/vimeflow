// Vimeflow — shell: left icon rail, left sidebar (sessions + tree), right activity panel.

// ---------- Icon rail (48px) — nav between top-level areas -----------------
function IconRail({ activeArea, onArea, onCommand }) {
  const items = [
    { id: 'agent', icon: 'bolt', label: 'Agent Workspace' },
    { id: 'files', icon: 'folder_open', label: 'Files' },
    { id: 'editor', icon: 'code', label: 'Editor' },
    { id: 'diff', icon: 'difference', label: 'Git Diff' },
    { id: 'ctx', icon: 'inventory_2', label: 'Context Bucket' },
  ]
  const bottom = [
    {
      id: 'cmd',
      icon: 'terminal',
      label: 'Command Palette (⌘K)',
      onClick: onCommand,
    },
    { id: 'settings', icon: 'settings', label: 'Settings' },
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
      {/* Brand mark */}
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          background: 'linear-gradient(135deg, #e2c7ff 0%, #cba6f7 100%)',
          display: 'grid',
          placeItems: 'center',
          fontFamily: "'Instrument Sans', system-ui",
          fontWeight: 700,
          color: '#2a1646',
          fontSize: 16,
          letterSpacing: '-0.04em',
          boxShadow: '0 4px 18px rgba(203,166,247,0.35)',
          marginBottom: 14,
        }}
      >
        V
      </div>

      <div
        style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        {items.map((it) => (
          <RailBtn
            key={it.id}
            {...it}
            active={activeArea === it.id}
            onClick={() => onArea(it.id)}
          />
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          marginTop: 8,
        }}
      >
        {bottom.map((it) => (
          <RailBtn key={it.id} {...it} />
        ))}
        {/* user */}
        <div
          style={{
            width: 30,
            height: 30,
            marginTop: 6,
            borderRadius: 999,
            background: 'linear-gradient(135deg,#57377f,#1a1a2a)',
            border: '1.5px solid rgba(226,199,255,0.35)',
            display: 'grid',
            placeItems: 'center',
            fontFamily: "'Instrument Sans', system-ui",
            fontSize: 11,
            fontWeight: 600,
            color: '#e2c7ff',
          }}
        >
          w
        </div>
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
function Sidebar({ sessions, activeId, onPick, tree, onCtx, density }) {
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
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', padding: '8px 10px 0', gap: 2 }}>
        {[
          { id: 'sessions', label: 'Sessions', count: sessions.length },
          { id: 'files', label: 'Files', count: null },
          { id: 'context', label: 'Context', count: null },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setPane(t.id)
              if (t.id === 'context') onCtx && onCtx()
            }}
            style={{
              flex: 1,
              padding: '6px 8px',
              borderRadius: 6,
              background:
                pane === t.id ? 'rgba(226,199,255,0.08)' : 'transparent',
              color: pane === t.id ? '#e2c7ff' : '#8a8299',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
            }}
          >
            {t.label}
            {t.count != null && (
              <span style={{ fontSize: 9.5, color: '#6c7086' }}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

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

Object.assign(window, { IconRail, Sidebar })

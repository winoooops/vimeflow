// Vimeflow — main views (Terminal, Editor, Diff, Files).

// ---------- SESSION TABS (browser-like, top of main region) ----------------
// One tab per open session. Click to switch active session, X to close,
// + to spawn a new session. Active tab "lifts" into the canvas below it.
function SessionTabs({ sessions, activeId, onPick, onClose, onNew }) {
  const open = sessions.filter(
    (s) => s.state === 'running' || s.state === 'awaiting' || s.state === 'idle'
  )
  return (
    <div
      style={{
        height: 38,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'flex-end',
        background: '#0d0d1c',
        borderBottom: '1px solid rgba(74,68,79,0.25)',
        paddingLeft: 8,
        paddingRight: 8,
        gap: 2,
      }}
    >
      {open.map((s) => {
        const active = s.id === activeId
        const agent =
          window.VIMEFLOW_AGENTS?.[s.agentKey] || window.VIMEFLOW_AGENTS?.claude
        const accent = agent?.accent || '#cba6f7'
        return (
          <div
            key={s.id}
            onClick={() => onPick(s.id)}
            style={{
              position: 'relative',
              height: 30,
              marginBottom: -1,
              padding: '0 8px 0 11px',
              background: active ? '#141424' : 'transparent',
              borderTopLeftRadius: 8,
              borderTopRightRadius: 8,
              border: active
                ? '1px solid rgba(74,68,79,0.3)'
                : '1px solid transparent',
              borderBottom: active
                ? '1px solid #141424'
                : '1px solid transparent',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              cursor: 'pointer',
              minWidth: 130,
              maxWidth: 220,
              transition: 'background 140ms ease',
            }}
            onMouseEnter={(e) => {
              if (!active)
                e.currentTarget.style.background = 'rgba(255,255,255,0.025)'
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.background = 'transparent'
            }}
          >
            {/* Top accent line on active tab */}
            {active && (
              <span
                style={{
                  position: 'absolute',
                  left: 6,
                  right: 6,
                  top: 0,
                  height: 2,
                  background: accent,
                  borderRadius: '0 0 2px 2px',
                }}
              />
            )}
            {/* Agent glyph chip */}
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: 4,
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: agent?.accentDim || 'rgba(203,166,247,0.12)',
                color: accent,
                fontSize: 10,
                fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {agent?.glyph || '∴'}
            </span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                color: active ? '#e3e0f7' : '#8a8299',
                fontWeight: active ? 500 : 400,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {s.title}
            </span>
            {/* Status pip */}
            {s.state === 'running' && (
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 999,
                  background: '#7defa1',
                  boxShadow: '0 0 6px #7defa1',
                  flexShrink: 0,
                  animation: 'vfPulse 1.6s ease-in-out infinite',
                }}
              />
            )}
            {s.state === 'awaiting' && (
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 999,
                  background: '#f0c674',
                  flexShrink: 0,
                }}
              />
            )}
            {/* Close X */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onClose && onClose(s.id)
              }}
              title="close session"
              style={{
                width: 16,
                height: 16,
                borderRadius: 4,
                flexShrink: 0,
                background: 'transparent',
                border: 'none',
                color: '#6c7086',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: active ? 0.8 : 0.45,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
                e.currentTarget.style.color = '#e3e0f7'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = '#6c7086'
              }}
            >
              <Icon name="close" size={11} />
            </button>
          </div>
        )
      })}
      {/* New session */}
      <button
        onClick={onNew}
        title="new session"
        style={{
          width: 28,
          height: 28,
          marginBottom: 1,
          marginLeft: 2,
          borderRadius: 6,
          background: 'transparent',
          border: 'none',
          color: '#8a8299',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(226,199,255,0.06)'
          e.currentTarget.style.color = '#e2c7ff'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = '#8a8299'
        }}
      >
        <Icon name="add" size={15} />
      </button>
      <span style={{ flex: 1 }} />
    </div>
  )
}

// ---------- View tabs (terminal / editor / diff / files) ------------------
function ViewTabs({ view, onView, session, fileName }) {
  const tabs = [
    { id: 'terminal', icon: 'terminal', label: 'terminal' },
    {
      id: 'editor',
      icon: 'code',
      label: fileName || 'src/middleware/auth.ts',
      dirty: true,
    },
    { id: 'diff', icon: 'difference', label: 'diff · HEAD' },
    { id: 'files', icon: 'folder_open', label: 'files' },
  ]
  return (
    <div
      style={{
        height: 40,
        display: 'flex',
        alignItems: 'flex-end',
        background: '#121221',
        borderBottom: '1px solid rgba(74,68,79,0.25)',
        paddingLeft: 10,
        paddingRight: 10,
        gap: 2,
      }}
    >
      {tabs.map((t) => {
        const active = t.id === view
        return (
          <button
            key={t.id}
            onClick={() => onView(t.id)}
            style={{
              position: 'relative',
              height: 32,
              padding: '0 12px',
              marginBottom: -1,
              background: active ? '#1e1e2e' : 'transparent',
              borderTopLeftRadius: 7,
              borderTopRightRadius: 7,
              border: active
                ? '1px solid rgba(74,68,79,0.25)'
                : '1px solid transparent',
              borderBottom: active
                ? '1px solid #1e1e2e'
                : '1px solid transparent',
              color: active ? '#e3e0f7' : '#8a8299',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              cursor: 'pointer',
            }}
          >
            <Icon
              name={t.icon}
              size={13}
              style={{ color: active ? '#cba6f7' : '#6c7086' }}
            />
            <span
              style={{
                maxWidth: 260,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {t.label}
            </span>
            {t.dirty && (
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 999,
                  background: '#e2c7ff',
                }}
              />
            )}
          </button>
        )
      })}
      <span style={{ flex: 1 }} />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          paddingBottom: 8,
          paddingRight: 4,
        }}
      >
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10.5,
            color: '#8a8299',
          }}
        >
          {session.branch}
        </span>
        <span
          style={{ width: 1, height: 12, background: 'rgba(74,68,79,0.4)' }}
        />
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10.5,
            color: '#7defa1',
          }}
        >
          +{session.changes.added}
        </span>
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10.5,
            color: '#ff94a5',
          }}
        >
          −{session.changes.removed}
        </span>
      </div>
    </div>
  )
}

// ---------- Terminal view ---------------------------------------------------
function TerminalView({ session, paused, script }) {
  const [lines, setLines] = useState([script[0]])
  const scrollRef = useRef(null)
  const iRef = useRef(1)

  useEffect(() => {
    if (paused || session.state !== 'running') return
    if (iRef.current >= script.length) return
    const t = setTimeout(
      () => {
        setLines((l) => [...l, script[iRef.current]])
        iRef.current += 1
        if (scrollRef.current)
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight + 200
      },
      1300 + Math.random() * 700
    )
    return () => clearTimeout(t)
  }, [lines.length, paused, session.state, script])

  // reset when session changes
  useEffect(() => {
    setLines([script[0]])
    iRef.current = 1
  }, [session.id, script])

  return (
    <div
      style={{
        flex: 1,
        background: '#121221',
        position: 'relative',
        backgroundImage:
          'radial-gradient(ellipse at top left, rgba(203,166,247,0.08), transparent 50%), radial-gradient(ellipse at bottom right, rgba(168,200,255,0.05), transparent 60%)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div
        ref={scrollRef}
        className="vf-scroll"
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '20px 28px 8px',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12.5,
          lineHeight: 1.65,
        }}
      >
        {lines.map((l, i) => (
          <TermLine key={i} line={l} last={i === lines.length - 1 && !paused} />
        ))}
      </div>
      <TermInput session={session} paused={paused} />
    </div>
  )
}

function TermLine({ line, last }) {
  if (!line) return null
  if (line.t === 'meta')
    return (
      <div style={{ color: '#6c7086', marginBottom: 10, fontSize: 11 }}>
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
          marginTop: 6,
          marginBottom: 4,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ color: '#7defa1' }}>➜</span>
        <span style={{ color: '#a8c8ff' }}>{line.path}</span>
        <span style={{ color: '#cba6f7' }}>git:({line.branch})</span>
        <span style={{ color: '#e3e0f7' }}>{line.cmd}</span>
        {line.cursor && (
          <span
            className="vf-cursor"
            style={{
              display: 'inline-block',
              width: 8,
              height: 15,
              marginLeft: 2,
              background: '#e2c7ff',
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
          color: line.tone === 'warn' ? '#ff94a5' : '#cdc3d1',
          marginBottom: 4,
          paddingLeft: 14,
          position: 'relative',
        }}
      >
        <span style={{ position: 'absolute', left: 0, color: '#cba6f7' }}>
          ∴
        </span>
        {line.text}
        {last && (
          <span
            className="vf-cursor"
            style={{
              display: 'inline-block',
              width: 7,
              height: 13,
              marginLeft: 4,
              background: '#cba6f7',
              verticalAlign: 'middle',
            }}
          />
        )}
      </div>
    )
  if (line.t === 'tool')
    return (
      <div style={{ marginBottom: 4, paddingLeft: 14 }}>
        <span style={{ color: '#a8c8ff' }}>⚒ {line.name}</span>
        <span style={{ color: '#6c7086' }}>(</span>
        <span style={{ color: '#f5e0dc' }}>{line.args}</span>
        <span style={{ color: '#6c7086' }}>)</span>
        <span
          style={{
            marginLeft: 8,
            color: line.status === 'ok' ? '#7defa1' : '#ff94a5',
          }}
        >
          ● {line.status}
        </span>
        <span style={{ marginLeft: 8, color: '#6c7086' }}>· {line.detail}</span>
      </div>
    )
  if (line.t === 'output')
    return (
      <div style={{ color: '#7defa1', marginBottom: 4, paddingLeft: 14 }}>
        {line.text}
      </div>
    )
  if (line.t === 'patch')
    return (
      <div
        style={{
          margin: '6px 0 10px 14px',
          border: '1px solid rgba(74,68,79,0.3)',
          borderRadius: 6,
          overflow: 'hidden',
          background: 'rgba(13,13,28,0.7)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 10px',
            borderBottom: '1px solid rgba(74,68,79,0.25)',
            background: 'rgba(30,30,46,0.5)',
          }}
        >
          <Icon name="difference" size={11} style={{ color: '#cba6f7' }} />
          <span style={{ color: '#cdc3d1', fontSize: 11 }}>{line.file}</span>
          <span style={{ color: '#6c7086', fontSize: 10.5 }}>{line.span}</span>
        </div>
        <div style={{ padding: '6px 10px' }}>
          {line.before.map((b, i) => (
            <div key={'b' + i} style={{ color: '#ff94a5', fontSize: 11.5 }}>
              {b}
            </div>
          ))}
          {line.after.map((a, i) => (
            <div key={'a' + i} style={{ color: '#7defa1', fontSize: 11.5 }}>
              {a}
            </div>
          ))}
        </div>
      </div>
    )
  return null
}

function TermInput({ session, paused }) {
  const [val, setVal] = useState('')
  return (
    <div
      style={{
        borderTop: '1px solid rgba(74,68,79,0.25)',
        background: 'rgba(13,13,28,0.5)',
        padding: '10px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12.5,
      }}
    >
      <StatusDot state={paused ? 'idle' : session.state} size={7} />
      <span style={{ color: '#cba6f7' }}>{'> '}</span>
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder={
          paused
            ? 'paused — press resume to continue'
            : 'send a message or command (:help)'
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
      <Kbd>⌘</Kbd>
      <Kbd>K</Kbd>
      <span style={{ color: '#6c7086' }}> palette </span>
      <Kbd>↵</Kbd>
      <span style={{ color: '#6c7086' }}> send</span>
    </div>
  )
}

// ---------- Editor view -----------------------------------------------------
function EditorView({ file }) {
  const { cursor } = file
  return (
    <div
      style={{
        flex: 1,
        background: '#121221',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      {/* Path crumb */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '7px 16px',
          borderBottom: '1px solid rgba(74,68,79,0.2)',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: '#8a8299',
        }}
      >
        <Icon name="folder_open" size={12} />
        <span>src</span>
        <span style={{ color: '#4a444f' }}>/</span>
        <span>middleware</span>
        <span style={{ color: '#4a444f' }}>/</span>
        <span style={{ color: '#e3e0f7' }}>auth.ts</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: '#e2c7ff' }}>MODIFIED</span>
      </div>

      <div
        className="vf-scroll"
        style={{
          flex: 1,
          overflow: 'auto',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 12.5,
          lineHeight: 1.7,
          padding: '14px 0',
        }}
      >
        {file.lines.map((tokens, i) => {
          const lineNum = i + 1
          const isCursor = lineNum === cursor.line
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                paddingLeft: 4,
                paddingRight: 24,
                background: isCursor ? 'rgba(226,199,255,0.06)' : 'transparent',
                borderLeft: isCursor
                  ? '2px solid #cba6f7'
                  : '2px solid transparent',
              }}
            >
              <span
                style={{
                  width: 40,
                  textAlign: 'right',
                  color: '#4a444f',
                  flexShrink: 0,
                  userSelect: 'none',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {lineNum}
              </span>
              <span style={{ width: 14, flexShrink: 0 }} />
              <span style={{ whiteSpace: 'pre' }}>
                {tokens.map((tk, j) => (
                  <span key={j} style={{ color: tokColor(tk.t) }}>
                    {tk.s}
                  </span>
                ))}
                {isCursor && (
                  <span
                    className="vf-cursor"
                    style={{
                      display: 'inline-block',
                      width: 2,
                      height: 16,
                      background: '#e2c7ff',
                      marginLeft: 1,
                      verticalAlign: 'middle',
                    }}
                  />
                )}
              </span>
            </div>
          )
        })}
      </div>

      {/* Minimap-ish status bar */}
      <div
        style={{
          height: 24,
          flexShrink: 0,
          borderTop: '1px solid rgba(74,68,79,0.25)',
          background: '#0d0d1c',
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          gap: 16,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10.5,
          color: '#8a8299',
        }}
      >
        <span style={{ color: '#cba6f7' }}>TS</span>
        <span>
          Ln {cursor.line}, Col {cursor.col}
        </span>
        <span>UTF-8</span>
        <span>LF</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: '#7defa1' }}>● agent is editing</span>
      </div>
    </div>
  )
}
function tokColor(t) {
  return (
    {
      kw: '#cba6f7',
      str: '#a6e3a1',
      fn: '#89b4fa',
      var: '#f5e0dc',
      cm: '#6c7086',
      ty: '#fab387',
      tag: '#f38ba8',
      '': '#cdc3d1',
    }[t] || '#cdc3d1'
  )
}

// ---------- Diff view -------------------------------------------------------
function DiffView({ hunk, files }) {
  const [activeFile, setActiveFile] = useState(
    files.find((f) => f.active)?.name || files[0].name
  )
  return (
    <div
      style={{ flex: 1, background: '#121221', display: 'flex', minHeight: 0 }}
    >
      {/* Changed files list */}
      <div
        style={{
          width: 240,
          flexShrink: 0,
          borderRight: '1px solid rgba(74,68,79,0.2)',
          padding: '14px 10px',
          overflow: 'auto',
        }}
        className="vf-scroll"
      >
        <SectionLabel style={{ margin: '4px 6px 10px' }}>
          Changes · {files.length}
        </SectionLabel>
        {files.map((f) => (
          <button
            key={f.name}
            onClick={() => setActiveFile(f.name)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '6px 8px',
              marginBottom: 2,
              borderRadius: 5,
              background:
                activeFile === f.name
                  ? 'rgba(226,199,255,0.08)'
                  : 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10.5,
              color: activeFile === f.name ? '#e2c7ff' : '#cdc3d1',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {f.status === 'D' && (
                <span
                  style={{
                    color: '#ff94a5',
                    fontWeight: 700,
                    fontSize: 9.5,
                    width: 10,
                  }}
                >
                  D
                </span>
              )}
              {!f.status && (
                <Icon name="draft" size={11} style={{ color: '#6c7086' }} />
              )}
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {f.name}
              </span>
            </div>
            <div
              style={{ display: 'flex', gap: 6, marginTop: 3, paddingLeft: 15 }}
            >
              {f.add > 0 && (
                <span style={{ color: '#7defa1', fontSize: 9.5 }}>
                  +{f.add}
                </span>
              )}
              {f.rem > 0 && (
                <span style={{ color: '#ff94a5', fontSize: 9.5 }}>
                  −{f.rem}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Commit meta */}
        <div
          style={{
            padding: '12px 18px',
            borderBottom: '1px solid rgba(74,68,79,0.2)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 4,
            }}
          >
            <Chip tone="primary" style={{ fontSize: 9 }}>
              {hunk.commit}
            </Chip>
            <span
              style={{
                fontFamily: "'Instrument Sans', system-ui",
                fontSize: 13.5,
                fontWeight: 600,
                color: '#e3e0f7',
              }}
            >
              {hunk.message}
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10.5,
              color: '#8a8299',
            }}
          >
            <span>{hunk.author}</span>
            <span>·</span>
            <RelTime value={hunk.ago} />
          </div>
        </div>

        <div
          className="vf-scroll"
          style={{ flex: 1, overflow: 'auto', display: 'flex', minWidth: 0 }}
        >
          <DiffSide lines={hunk.left} label="HEAD" />
          <div style={{ width: 1, background: 'rgba(74,68,79,0.25)' }} />
          <DiffSide lines={hunk.right} label="WORKING" />
        </div>

        <div
          style={{
            height: 36,
            flexShrink: 0,
            borderTop: '1px solid rgba(74,68,79,0.25)',
            background: '#0d0d1c',
            display: 'flex',
            alignItems: 'center',
            padding: '0 16px',
            gap: 10,
          }}
        >
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10.5,
              color: '#8a8299',
            }}
          >
            Review &amp; apply
          </span>
          <span style={{ flex: 1 }} />
          <button
            style={{
              padding: '5px 12px',
              borderRadius: 5,
              background: 'transparent',
              color: '#cdc3d1',
              border: '1px solid rgba(74,68,79,0.5)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10.5,
              cursor: 'pointer',
            }}
          >
            Reject
          </button>
          <button
            style={{
              padding: '5px 12px',
              borderRadius: 5,
              background: '#cba6f7',
              color: '#2a1646',
              border: 'none',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10.5,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Stage hunk
          </button>
        </div>
      </div>
    </div>
  )
}
function DiffSide({ lines, label }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11.5,
        lineHeight: 1.65,
        padding: '10px 0',
      }}
    >
      <div
        style={{
          padding: '0 14px 6px',
          color: '#6c7086',
          fontSize: 10,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      {lines.map((l, i) => {
        const bg =
          l.tone === 'add'
            ? 'rgba(80,250,123,0.08)'
            : l.tone === 'rem'
              ? 'rgba(215,51,87,0.12)'
              : 'transparent'
        const pfx = l.tone === 'add' ? '+' : l.tone === 'rem' ? '−' : ' '
        const color =
          l.tone === 'add'
            ? '#a6e3a1'
            : l.tone === 'rem'
              ? '#f38ba8'
              : '#cdc3d1'
        return (
          <div
            key={i}
            style={{ display: 'flex', background: bg, paddingRight: 12 }}
          >
            <span
              style={{
                width: 38,
                paddingRight: 8,
                textAlign: 'right',
                color: '#4a444f',
                flexShrink: 0,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {l.n}
            </span>
            <span style={{ width: 16, color: color, flexShrink: 0 }}>
              {pfx}
            </span>
            <span style={{ color, whiteSpace: 'pre' }}>{l.text}</span>
          </div>
        )
      })}
    </div>
  )
}

// ---------- Files view (full-panel explorer) --------------------------------
function FilesView({ tree }) {
  return (
    <div
      style={{ flex: 1, background: '#121221', display: 'flex', minHeight: 0 }}
    >
      <div
        style={{
          width: 320,
          flexShrink: 0,
          borderRight: '1px solid rgba(74,68,79,0.2)',
          padding: '14px 10px',
          overflow: 'auto',
        }}
        className="vf-scroll"
      >
        <SectionLabel style={{ margin: '4px 6px 10px' }}>
          Working tree
        </SectionLabel>
        <TreeNode node={tree} depth={0} />
      </div>
      <div
        style={{
          flex: 1,
          padding: '48px 56px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <Icon
            name="folder_open"
            size={48}
            style={{ color: 'rgba(203,166,247,0.3)', marginBottom: 14 }}
          />
          <div
            style={{
              fontFamily: "'Instrument Sans', system-ui",
              fontSize: 18,
              fontWeight: 600,
              color: '#e3e0f7',
              marginBottom: 8,
            }}
          >
            Pick a file to view
          </div>
          <div
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 13,
              color: '#8a8299',
              lineHeight: 1.5,
            }}
          >
            Or drop files into the{' '}
            <span style={{ color: '#cba6f7' }}>Context bucket</span> in the
            sidebar to add them to the agent's context window.
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------- Dock panel — Editor / Diff / Files. Positionable: bottom | left | right | top ----------
function DockPanel({
  position = 'bottom',
  flex,
  tab,
  onTab,
  onClose,
  onMovePosition,
  file,
  hunk,
  diffFiles,
  tree,
}) {
  const tabs = [
    { id: 'editor', icon: 'code', label: 'Editor' },
    { id: 'diff', icon: 'difference', label: 'Diff Viewer' },
    { id: 'files', icon: 'folder_open', label: 'Files' },
  ]
  // Border faces the terminal area.
  const borderSide =
    position === 'bottom'
      ? 'borderTop'
      : position === 'top'
        ? 'borderBottom'
        : position === 'left'
          ? 'borderRight'
          : 'borderLeft'
  const collapseIcon =
    position === 'bottom'
      ? 'expand_more'
      : position === 'top'
        ? 'expand_less'
        : position === 'left'
          ? 'chevron_left'
          : 'chevron_right'

  return (
    <div
      style={{
        flex: flex || '1 1 40%',
        minHeight: 0,
        minWidth: 0,
        [borderSide]: '1px solid rgba(74,68,79,0.3)',
        background: '#121221',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          height: 34,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px',
          gap: 4,
          background: '#0d0d1c',
          borderBottom: '1px solid rgba(74,68,79,0.25)',
        }}
      >
        {tabs.map((t) => {
          const active = t.id === tab
          return (
            <button
              key={t.id}
              onClick={() => onTab(t.id)}
              style={{
                height: 26,
                padding: '0 11px',
                borderRadius: 6,
                background: active ? 'rgba(226,199,255,0.08)' : 'transparent',
                border: active
                  ? '1px solid rgba(203,166,247,0.3)'
                  : '1px solid transparent',
                color: active ? '#e2c7ff' : '#8a8299',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10.5,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
              }}
            >
              <Icon
                name={t.icon}
                size={12}
                style={{ color: active ? '#cba6f7' : '#6c7086' }}
              />
              {t.label}
            </button>
          )
        })}
        <span style={{ flex: 1 }} />
        {onMovePosition && window.DockSwitcher && (
          <div style={{ marginRight: 4 }}>
            <window.DockSwitcher
              position={position}
              onPick={onMovePosition}
              compact
            />
          </div>
        )}
        <button
          onClick={onClose}
          title="hide panel"
          style={{
            width: 24,
            height: 24,
            borderRadius: 5,
            background: 'transparent',
            border: 'none',
            color: '#8a8299',
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)'
            e.currentTarget.style.color = '#e2c7ff'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = '#8a8299'
          }}
        >
          <Icon name={collapseIcon} size={14} />
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {tab === 'editor' && <EditorView file={file} />}
        {tab === 'diff' && <DiffView hunk={hunk} files={diffFiles} />}
        {tab === 'files' && <FilesView tree={tree} />}
      </div>
    </div>
  )
}

// Inline mini-menu for moving the dock around.
function DockPositionMenu({ position, onPick }) {
  const opts = [
    { id: 'bottom', icon: 'vertical_align_bottom', label: 'Dock bottom' },
    { id: 'left', icon: 'align_horizontal_left', label: 'Dock left' },
    { id: 'right', icon: 'align_horizontal_right', label: 'Dock right' },
  ]
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        padding: 2,
        marginRight: 4,
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(74,68,79,0.25)',
        borderRadius: 6,
      }}
    >
      {opts.map((o) => (
        <button
          key={o.id}
          onClick={() => onPick(o.id)}
          title={o.label}
          style={{
            width: 22,
            height: 20,
            borderRadius: 4,
            background:
              position === o.id ? 'rgba(203,166,247,0.15)' : 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: position === o.id ? '#cba6f7' : '#6c7086',
            display: 'grid',
            placeItems: 'center',
          }}
          onMouseEnter={(e) => {
            if (position !== o.id) e.currentTarget.style.color = '#e2c7ff'
          }}
          onMouseLeave={(e) => {
            if (position !== o.id) e.currentTarget.style.color = '#6c7086'
          }}
        >
          <Icon name={o.icon} size={12} />
        </button>
      ))}
    </div>
  )
}

// Backward-compat alias used elsewhere.
const BottomPanel = DockPanel

Object.assign(window, {
  SessionTabs,
  ViewTabs,
  TerminalView,
  EditorView,
  DiffView,
  FilesView,
  DockPanel,
  DockPositionMenu,
  BottomPanel,
})

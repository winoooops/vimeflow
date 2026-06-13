// Vimeflow — Command Palette (⌘K) + Tweaks panel.

function CommandPalette({ open, onClose, commands, onRun }) {
  const [query, setQuery] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setIdx(0)
      setTimeout(() => inputRef.current && inputRef.current.focus(), 10)
    }
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((c) =>
      (c.cmd + ' ' + c.label + ' ' + c.hint).toLowerCase().includes(q)
    )
  }, [query, commands])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setIdx((i) => Math.min(filtered.length - 1, i + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setIdx((i) => Math.max(0, i - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (filtered[idx]) {
          onRun(filtered[idx])
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, filtered, idx, onClose, onRun])

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 100,
        background: 'rgba(13,13,28,0.55)',
        backdropFilter: 'blur(14px) saturate(120%)',
        WebkitBackdropFilter: 'blur(14px) saturate(120%)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '16vh',
        animation: 'vfFadeIn 160ms ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxWidth: '90%',
          background: 'rgba(30,30,46,0.88)',
          backdropFilter: 'blur(24px) saturate(160%)',
          WebkitBackdropFilter: 'blur(24px) saturate(160%)',
          border: '1px solid rgba(226,199,255,0.2)',
          borderRadius: 12,
          boxShadow:
            '0 20px 60px rgba(13,13,28,0.7), 0 0 0 1px rgba(203,166,247,0.1)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '14px 16px',
            borderBottom: '1px solid rgba(74,68,79,0.25)',
          }}
        >
          <Icon name="terminal" size={16} style={{ color: '#cba6f7' }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setIdx(0)
            }}
            placeholder="type a command, : prefix, or search files…"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#e3e0f7',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 13.5,
            }}
          />
          <Kbd>esc</Kbd>
        </div>
        <div
          style={{ maxHeight: 320, overflow: 'auto', padding: '6px 6px 8px' }}
          className="vf-scroll"
        >
          {filtered.length === 0 && (
            <div
              style={{
                padding: '20px',
                textAlign: 'center',
                color: '#6c7086',
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
              }}
            >
              no matches
            </div>
          )}
          {filtered.map((c, i) => (
            <div
              key={c.cmd}
              onMouseEnter={() => setIdx(i)}
              onClick={() => {
                onRun(c)
                onClose()
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '9px 12px',
                margin: '2px 0',
                borderRadius: 8,
                background: idx === i ? 'rgba(203,166,247,0.1)' : 'transparent',
                border:
                  idx === i
                    ? '1px solid rgba(203,166,247,0.25)'
                    : '1px solid transparent',
                cursor: 'pointer',
              }}
            >
              <Icon
                name={c.icon}
                size={15}
                style={{ color: idx === i ? '#e2c7ff' : '#8a8299' }}
              />
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11.5,
                  color: '#e2c7ff',
                  minWidth: 100,
                }}
              >
                {c.cmd}
              </span>
              <span
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 12.5,
                  color: '#e3e0f7',
                  flex: 1,
                }}
              >
                {c.label}
              </span>
              <span
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 11,
                  color: '#6c7086',
                }}
              >
                {c.hint}
              </span>
            </div>
          ))}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 14px',
            borderTop: '1px solid rgba(74,68,79,0.2)',
            background: 'rgba(13,13,28,0.5)',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: '#6c7086',
          }}
        >
          <Kbd>↵</Kbd> run
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> navigate
          <span style={{ flex: 1 }} />
          <span>vimeflow · obsidian-cli</span>
        </div>
      </div>
    </div>
  )
}

// ---------- Tweaks panel ---------------------------------------------------
function TweaksPanel({ open, onClose, tweaks, onChange }) {
  if (!open) return null

  const aesthetics = [
    { id: 'obsidian', label: 'Obsidian' },
    { id: 'editorial', label: 'Editorial' },
    { id: 'dense', label: 'Dense' },
  ]
  const states = [
    { id: 'running', label: 'Running', tone: 'success' },
    { id: 'awaiting', label: 'Awaiting', tone: 'warn' },
    { id: 'completed', label: 'Completed', tone: 'primary' },
    { id: 'errored', label: 'Errored', tone: 'error' },
    { id: 'idle', label: 'Idle', tone: 'neutral' },
  ]

  return (
    <div
      style={{
        position: 'absolute',
        right: 20,
        bottom: 20,
        zIndex: 90,
        width: 300,
        background: 'rgba(30,30,46,0.92)',
        backdropFilter: 'blur(20px) saturate(150%)',
        WebkitBackdropFilter: 'blur(20px) saturate(150%)',
        border: '1px solid rgba(226,199,255,0.2)',
        borderRadius: 12,
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        animation: 'vfSlideUp 220ms cubic-bezier(.2,.8,.2,1)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '11px 14px',
          borderBottom: '1px solid rgba(74,68,79,0.25)',
        }}
      >
        <Icon name="tune" size={14} style={{ color: '#cba6f7' }} />
        <span
          style={{
            fontFamily: "'Instrument Sans', system-ui",
            fontSize: 13,
            fontWeight: 600,
            color: '#e3e0f7',
            flex: 1,
          }}
        >
          Tweaks
        </span>
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#8a8299',
            cursor: 'pointer',
            padding: 2,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Icon name="close" size={14} />
        </button>
      </div>

      <div
        style={{
          padding: '12px 14px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <TweakBlock label="Split mode">
          <Segmented
            items={[
              { id: 'on', label: 'Multi-pane' },
              { id: 'off', label: 'Single' },
            ]}
            value={tweaks.splitMode ? 'on' : 'off'}
            onChange={(v) => onChange({ splitMode: v === 'on' })}
          />
        </TweakBlock>

        {tweaks.splitMode && (
          <TweakBlock label="Layout">
            <LayoutSwitcher
              layoutId={tweaks.layout || 'vsplit'}
              onPick={(v) => onChange({ layout: v })}
            />
          </TweakBlock>
        )}

        <TweakBlock label="Editor / Diff dock">
          <DockSwitcher
            position={tweaks.dockPosition || 'bottom'}
            onPick={(v) =>
              onChange({ dockPosition: v, bottomPanelOpen: v !== 'hidden' })
            }
          />
        </TweakBlock>

        <TweakBlock label="Aesthetic">
          <Segmented
            items={aesthetics}
            value={tweaks.aesthetic}
            onChange={(v) => onChange({ aesthetic: v })}
          />
        </TweakBlock>

        <TweakBlock label="Agent state">
          <Segmented
            items={states}
            value={tweaks.agentState}
            onChange={(v) => onChange({ agentState: v })}
            small
          />
        </TweakBlock>

        <TweakBlock label="Density">
          <Segmented
            items={[
              { id: 'comfortable', label: 'Comfortable' },
              { id: 'compact', label: 'Compact' },
            ]}
            value={tweaks.density}
            onChange={(v) => onChange({ density: v })}
          />
        </TweakBlock>

        <TweakBlock label={`Context pressure · ${tweaks.contextPct}%`}>
          <ContextSlider
            value={tweaks.contextPct}
            onChange={(v) => onChange({ contextPct: v })}
          />
          <div
            style={{
              marginTop: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10.5,
                color: '#8a8299',
              }}
            >
              smiley
            </span>
            <ContextSmiley pct={tweaks.contextPct} />
          </div>
        </TweakBlock>

        <TweakBlock label={`Accent hue · ${tweaks.accentHue}°`}>
          <input
            type="range"
            min="240"
            max="360"
            step="2"
            value={tweaks.accentHue}
            onChange={(e) => onChange({ accentHue: +e.target.value })}
            style={{
              width: '100%',
              background:
                'linear-gradient(to right, oklch(0.8 0.14 240), oklch(0.8 0.14 285), oklch(0.8 0.14 330), oklch(0.8 0.14 360))',
              borderRadius: 999,
              height: 6,
              appearance: 'none',
              WebkitAppearance: 'none',
            }}
          />
        </TweakBlock>
      </div>
    </div>
  )
}

function TweakBlock({ label, children }) {
  return (
    <div>
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          color: '#8a8299',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          marginBottom: 7,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

function Segmented({ items, value, onChange, small }) {
  return (
    <div
      style={{
        display: 'flex',
        background: 'rgba(13,13,28,0.5)',
        padding: 3,
        borderRadius: 7,
        border: '1px solid rgba(74,68,79,0.2)',
      }}
    >
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => onChange(it.id)}
          style={{
            flex: 1,
            padding: small ? '4px 4px' : '5px 8px',
            borderRadius: 5,
            background:
              value === it.id ? 'rgba(203,166,247,0.15)' : 'transparent',
            border:
              value === it.id
                ? '1px solid rgba(203,166,247,0.3)'
                : '1px solid transparent',
            color: value === it.id ? '#e2c7ff' : '#8a8299',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: small ? 9.5 : 10.5,
            fontWeight: 600,
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
            cursor: 'pointer',
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

function ContextSlider({ value, onChange }) {
  return (
    <input
      type="range"
      min="0"
      max="100"
      value={value}
      onChange={(e) => onChange(+e.target.value)}
      style={{ width: '100%' }}
    />
  )
}

// ---------- Floating "Tweaks" trigger (fallback when edit-mode off) --------
function TweaksTrigger({ onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        position: 'absolute',
        right: 20,
        bottom: 20,
        zIndex: 80,
        padding: '9px 14px',
        borderRadius: 999,
        background: 'rgba(30,30,46,0.9)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid rgba(226,199,255,0.28)',
        color: '#e3e0f7',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        cursor: 'pointer',
        boxShadow: '0 8px 28px rgba(0,0,0,0.4)',
      }}
    >
      <Icon name="tune" size={13} style={{ color: '#cba6f7' }} />
      tweaks
    </button>
  )
}

Object.assign(window, { CommandPalette, TweaksPanel, TweaksTrigger })

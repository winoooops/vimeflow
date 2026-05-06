// Vimeflow — right-side activity panel. Shows what the agent is doing right now,
// token/turn/context meters, and a scrollable activity feed.

function ActivityPanel({
  session,
  running,
  agent,
  collapsed,
  onToggleCollapsed,
}) {
  const tokPct = Math.round((session.tokens.used / session.tokens.max) * 100)
  const usePct = Math.round((session.usage.used / session.usage.max) * 100)
  const cache = session.cache || { cached: 0, wrote: 0, fresh: 0, history: [] }
  const cacheTotal = cache.cached + cache.wrote + cache.fresh
  const cacheRate =
    cacheTotal > 0 ? Math.round((cache.cached / cacheTotal) * 100) : 0
  const accent = agent?.accent || '#cba6f7'
  const accentDim = agent?.accentDim || 'rgba(203,166,247,0.12)'

  if (collapsed) {
    return (
      <aside
        style={{
          width: 36,
          flexShrink: 0,
          height: '100%',
          background: '#141424',
          borderLeft: '1px solid rgba(74,68,79,0.25)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 10,
          gap: 10,
        }}
      >
        <button
          onClick={onToggleCollapsed}
          title="expand status panel"
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
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
          <Icon name="chevron_left" size={16} />
        </button>
        {/* Mini agent glyph */}
        <div
          title={agent?.name || 'agent'}
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: accentDim,
            color: accent,
            display: 'grid',
            placeItems: 'center',
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 700,
            fontSize: 11,
          }}
        >
          {agent?.glyph || '∴'}
        </div>
        {/* Mini meters: vertical context bar */}
        <div
          title={`context ${tokPct}%`}
          style={{
            width: 4,
            height: 64,
            borderRadius: 999,
            background: 'rgba(74,68,79,0.3)',
            position: 'relative',
            overflow: 'hidden',
            marginTop: 4,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: `${tokPct}%`,
              background: tokPct > 85 ? '#ff94a5' : accent,
            }}
          />
        </div>
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 9,
            color: '#8a8299',
            letterSpacing: '0.08em',
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
            marginTop: 6,
          }}
        >
          {tokPct}% ctx
        </span>
        <span style={{ flex: 1 }} />
        {running && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: accent,
              marginBottom: 14,
              boxShadow: `0 0 8px ${accent}`,
              animation: 'vfPulse 1.6s ease-in-out infinite',
            }}
          />
        )}
      </aside>
    )
  }

  return (
    <aside
      style={{
        width: 320,
        flexShrink: 0,
        height: '100%',
        background: '#141424',
        borderLeft: '1px solid rgba(74,68,79,0.25)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header — agent-aware: chip color + name follow focused pane's agent */}
      <div
        style={{
          padding: '14px 16px 12px',
          borderBottom: '1px solid rgba(74,68,79,0.18)',
          background: `linear-gradient(180deg, ${accentDim}, transparent 80%)`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              flexShrink: 0,
              background: accentDim,
              color: accent,
              display: 'grid',
              placeItems: 'center',
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 700,
              fontSize: 13,
              border: `1px solid ${accent}33`,
            }}
          >
            {agent?.glyph || '∴'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 6,
              }}
            >
              <span
                style={{
                  fontFamily: "'Instrument Sans', system-ui",
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: '#e3e0f7',
                }}
              >
                {agent?.short || session.agent}
              </span>
              <StatusDot state={session.state} size={6} />
            </div>
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10.5,
                color: '#8a8299',
                marginTop: 2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {session.title} · {session.branch}
            </div>
          </div>
          <button
            onClick={onToggleCollapsed}
            title="collapse status panel"
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
            <Icon name="chevron_right" size={16} />
          </button>
        </div>
      </div>

      {/* Meters */}
      <div
        style={{
          padding: '14px 16px 12px',
          borderBottom: '1px solid rgba(74,68,79,0.18)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <Meter
          label="Context"
          detail={`${(session.tokens.used / 1000).toFixed(1)}k / ${(session.tokens.max / 1000) | 0}k`}
          pct={tokPct}
          tone={tokPct > 85 ? 'warn' : 'primary'}
        />
        <Meter
          label="5-hour usage"
          detail={`${session.usage.used} / ${session.usage.max}`}
          pct={usePct}
          tone="secondary"
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 10,
              color: '#8a8299',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            Turns
          </span>
          <span style={{ flex: 1 }} />
          <span
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              color: '#e3e0f7',
              fontWeight: 600,
            }}
          >
            {session.turns}
          </span>
        </div>
      </div>

      {/* Cache hit rate */}
      <CacheBlock
        cache={cache}
        rate={cacheRate}
        live={running}
        history={window.VIMEFLOW_CACHE_HISTORY || []}
        activeId={session.id}
      />

      {/* Live action */}
      {running && (
        <div
          style={{
            padding: '14px 16px 12px',
            borderBottom: '1px solid rgba(74,68,79,0.18)',
          }}
        >
          <SectionLabel style={{ marginBottom: 8 }}>Now</SectionLabel>
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              background:
                'linear-gradient(135deg, rgba(203,166,247,0.08), rgba(26,26,42,0.5))',
              border: '1px solid rgba(203,166,247,0.22)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 6,
              }}
            >
              <Icon name="bolt" size={13} style={{ color: '#e2c7ff' }} />
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10.5,
                  color: '#e2c7ff',
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                }}
              >
                edit
              </span>
              <span style={{ flex: 1 }} />
              <RelTime value="now" />
            </div>
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 11,
                color: '#cdc3d1',
              }}
            >
              src/middleware/auth.ts
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginTop: 6,
              }}
            >
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  color: '#7defa1',
                }}
              >
                +12
              </span>
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10,
                  color: '#ff94a5',
                }}
              >
                −2
              </span>
              <span style={{ flex: 1 }} />
              <Chip tone="success" style={{ padding: '1px 6px', fontSize: 9 }}>
                live
              </Chip>
            </div>
          </div>
        </div>
      )}

      {session.state === 'awaiting' && (
        <div
          style={{
            padding: '14px 16px 14px',
            borderBottom: '1px solid rgba(74,68,79,0.18)',
          }}
        >
          <SectionLabel style={{ marginBottom: 8 }}>Awaiting you</SectionLabel>
          <div
            style={{
              padding: '12px',
              borderRadius: 8,
              background: 'rgba(255,148,165,0.08)',
              border: '1px solid rgba(255,148,165,0.32)',
            }}
          >
            <div
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 12.5,
                color: '#ffc4cd',
                lineHeight: 1.4,
                marginBottom: 10,
              }}
            >
              {session.waitingOn}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: '#ff94a5',
                  color: '#2a0f16',
                  border: 'none',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                Approve
              </button>
              <button
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: 'transparent',
                  color: '#cdc3d1',
                  border: '1px solid rgba(74,68,79,0.5)',
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                }}
              >
                Deny
              </button>
            </div>
          </div>
        </div>
      )}

      {session.state === 'errored' && (
        <div
          style={{
            padding: '14px 16px 14px',
            borderBottom: '1px solid rgba(74,68,79,0.18)',
          }}
        >
          <SectionLabel style={{ marginBottom: 8 }}>Error</SectionLabel>
          <div
            style={{
              padding: '12px',
              borderRadius: 8,
              background: 'rgba(215,51,87,0.1)',
              border: '1px solid rgba(255,180,171,0.3)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              color: '#ffb4ab',
              lineHeight: 1.5,
            }}
          >
            {session.error}
          </div>
        </div>
      )}

      {/* Activity feed */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '12px 16px 6px' }}>
          <SectionLabel>Activity</SectionLabel>
        </div>
        <ScrollArea style={{ flex: 1, padding: '4px 12px 16px' }}>
          <Feed />
        </ScrollArea>
      </div>
    </aside>
  )
}

function Meter({ label, detail, pct, tone }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 5 }}>
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: '#8a8299',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          {label}
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            color: '#cdc3d1',
            fontWeight: 600,
          }}
        >
          {detail}
        </span>
      </div>
      <ProgressBar pct={pct} tone={tone} height={3} />
    </div>
  )
}

function Feed() {
  const items = [
    {
      kind: 'edit',
      file: 'src/middleware/auth.ts',
      add: 12,
      rem: 2,
      ago: 'now',
    },
    {
      kind: 'bash',
      text: 'pnpm test auth',
      ago: '18s ago',
      status: 'failed 1/4',
    },
    { kind: 'read', file: 'src/utils/jwt.ts', ago: '46s ago' },
    {
      kind: 'think',
      text: '"I need to check how `jwt.verify` is being called elsewhere before removing the helper."',
      ago: '1m ago',
    },
    { kind: 'bash', text: 'pnpm add jose', ago: '1m ago', status: 'ok' },
    { kind: 'read', file: 'src/middleware/auth.ts', ago: '2m ago' },
    {
      kind: 'user',
      text: 'refactor this to use jose instead of jsonwebtoken',
      ago: '2m ago',
    },
  ]

  const iconOf = {
    edit: ['edit', '#e2c7ff'],
    bash: ['terminal', '#a8c8ff'],
    read: ['visibility', '#8a8299'],
    think: ['psychology', '#c39eee'],
    user: ['person', '#f0c674'],
  }
  return (
    <div style={{ position: 'relative', paddingLeft: 16 }}>
      <div
        style={{
          position: 'absolute',
          left: 9,
          top: 4,
          bottom: 4,
          width: 1,
          background: 'rgba(74,68,79,0.4)',
        }}
      />
      {items.map((it, i) => {
        const [ic, col] = iconOf[it.kind]
        return (
          <div key={i} style={{ position: 'relative', marginBottom: 14 }}>
            <div
              style={{
                position: 'absolute',
                left: -16,
                top: 2,
                width: 18,
                height: 18,
                borderRadius: 999,
                background: '#141424',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 999,
                  background: 'rgba(30,30,46,0.9)',
                  border: `1px solid ${col}44`,
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <Icon name={ic} size={9} style={{ color: col }} />
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 2,
              }}
            >
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 9.5,
                  color: col,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}
              >
                {it.kind}
              </span>
              <span style={{ flex: 1 }} />
              <RelTime value={it.ago} style={{ fontSize: 9.5 }} />
            </div>
            <div
              style={{
                fontFamily:
                  it.kind === 'think' || it.kind === 'user'
                    ? "'Inter', sans-serif"
                    : "'JetBrains Mono', monospace",
                fontSize: it.kind === 'think' || it.kind === 'user' ? 12 : 11,
                fontStyle: it.kind === 'think' ? 'italic' : 'normal',
                color: it.kind === 'think' ? '#8a8299' : '#cdc3d1',
                lineHeight: 1.4,
              }}
            >
              {it.file || it.text}
            </div>
            {(it.add != null || it.status) && (
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                {it.add != null && (
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 10,
                      color: '#7defa1',
                    }}
                  >
                    +{it.add}
                  </span>
                )}
                {it.rem != null && (
                  <span
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 10,
                      color: '#ff94a5',
                    }}
                  >
                    −{it.rem}
                  </span>
                )}
                {it.status && (
                  <Chip
                    tone={it.status.includes('fail') ? 'warn' : 'success'}
                    style={{ padding: '1px 6px', fontSize: 9 }}
                  >
                    {it.status}
                  </Chip>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

Object.assign(window, {
  ActivityPanel,
  CacheBlock,
  CacheStackBar,
  Sparkline,
  HistoryBars,
})

// ---------- Stacked bar: cached vs wrote vs fresh -------------------------
function CacheStackBar({ cached, wrote, fresh }) {
  const total = cached + wrote + fresh
  if (total === 0) {
    return (
      <div
        style={{
          height: 8,
          borderRadius: 999,
          background: 'rgba(74,68,79,0.25)',
        }}
      />
    )
  }
  const cPct = (cached / total) * 100
  const wPct = (wrote / total) * 100
  const fPct = (fresh / total) * 100
  const cTone = cPct >= 70 ? '#7defa1' : cPct >= 40 ? '#cba6f7' : '#ff94a5'
  return (
    <div
      style={{
        height: 8,
        borderRadius: 999,
        overflow: 'hidden',
        background: 'rgba(13,13,28,0.6)',
        border: '1px solid rgba(74,68,79,0.25)',
        display: 'flex',
      }}
    >
      <div
        title={`cached ${Math.round(cPct)}%`}
        style={{
          width: `${cPct}%`,
          background: `linear-gradient(90deg, ${cTone}, ${cTone}cc)`,
          boxShadow: `inset 0 0 6px ${cTone}55`,
        }}
      />
      <div
        title={`wrote ${Math.round(wPct)}%`}
        style={{
          width: `${wPct}%`,
          background: 'linear-gradient(90deg, #a8c8ff, #8aa9d8)',
        }}
      />
      <div
        title={`fresh ${Math.round(fPct)}%`}
        style={{
          width: `${fPct}%`,
          background: 'rgba(205,195,209,0.4)',
        }}
      />
    </div>
  )
}

// ---------- Cache hit rate block ------------------------------------------
// Shows current session cache hit rate as a big number with sparkline trend,
// plus a small history bar of past sessions (Claude-web inspired).

function CacheBlock({ cache, rate, live, history, activeId }) {
  // Tone: green if >70, primary if 40-70, warn if <40
  const tone = rate >= 70 ? 'success' : rate >= 40 ? 'primary' : 'warn'
  const toneColor =
    tone === 'success' ? '#7defa1' : tone === 'warn' ? '#ff94a5' : '#e2c7ff'
  const toneDim =
    tone === 'success'
      ? 'rgba(125,239,161,0.55)'
      : tone === 'warn'
        ? 'rgba(255,148,165,0.55)'
        : 'rgba(226,199,255,0.55)'

  const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`)

  return (
    <div
      style={{
        padding: '14px 16px 14px',
        borderBottom: '1px solid rgba(74,68,79,0.18)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <SectionLabel>Token cache</SectionLabel>
        <span style={{ flex: 1 }} />
        {live && (
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: 999,
              background: toneColor,
              boxShadow: `0 0 6px ${toneColor}`,
              animation: 'vfPulse 1.6s ease-in-out infinite',
            }}
          />
        )}
      </div>

      {/* Big number + sparkline (current session) */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 12,
          padding: '12px 14px',
          borderRadius: 10,
          background: `linear-gradient(135deg, ${tone === 'success' ? 'rgba(125,239,161,0.06)' : tone === 'warn' ? 'rgba(255,148,165,0.06)' : 'rgba(203,166,247,0.06)'}, rgba(13,13,28,0.5))`,
          border: `1px solid ${toneColor}26`,
          marginBottom: 10,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span
              style={{
                fontFamily: "'Instrument Sans', system-ui",
                fontSize: 28,
                fontWeight: 600,
                color: '#e3e0f7',
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: '-0.02em',
              }}
            >
              {rate}
            </span>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 13,
                color: toneColor,
                fontWeight: 600,
              }}
            >
              %
            </span>
          </div>
          <div
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 9.5,
              color: '#8a8299',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              marginTop: 2,
            }}
          >
            cached this turn
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0, height: 36 }}>
          <Sparkline
            data={cache.history || []}
            color={toneColor}
            dim={toneDim}
          />
        </div>
      </div>

      {/* Token breakdown — cached / wrote / fresh */}
      <div style={{ marginBottom: 12 }}>
        <CacheStackBar
          cached={cache.cached}
          wrote={cache.wrote}
          fresh={cache.fresh}
        />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 8,
            marginTop: 9,
          }}
        >
          {[
            {
              label: 'cached',
              hint: 'free reuse',
              value: fmt(cache.cached),
              dot: toneColor,
            },
            {
              label: 'wrote',
              hint: 'uploaded',
              value: fmt(cache.wrote),
              dot: '#a8c8ff',
            },
            {
              label: 'fresh',
              hint: 'new tokens',
              value: fmt(cache.fresh),
              dot: '#cdc3d1',
            },
          ].map((s) => (
            <div
              key={s.label}
              style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: s.dot,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: 11.5,
                    color: '#e3e0f7',
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {s.value}
                </span>
              </div>
              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 9,
                  color: '#8a8299',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  paddingLeft: 11,
                }}
              >
                {s.label}
              </div>
              <div
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 10,
                  color: '#6c7086',
                  paddingLeft: 11,
                }}
              >
                {s.hint}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Past sessions */}
      {history && history.length > 0 && (
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 6,
            }}
          >
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 9.5,
                color: '#8a8299',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              past sessions
            </span>
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 9.5,
                color: '#6c7086',
              }}
            >
              avg{' '}
              {Math.round(
                history.reduce((a, h) => a + h.hitRate, 0) / history.length
              )}
              %
            </span>
          </div>
          <HistoryBars items={history} activeId={activeId} currentRate={rate} />
        </div>
      )}
    </div>
  )
}

// Inline sparkline — simple SVG line + filled area, draws session trend.
function Sparkline({ data, color, dim }) {
  if (!data || data.length === 0) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          color: '#4a444f',
        }}
      >
        no data yet
      </div>
    )
  }
  const w = 100,
    h = 36
  const max = Math.max(100, ...data)
  const min = Math.max(0, Math.min(...data) - 10)
  const span = Math.max(1, max - min)
  const step = data.length > 1 ? w / (data.length - 1) : w
  const pts = data.map((v, i) => {
    const x = i * step
    const y = h - ((v - min) / span) * (h - 6) - 3
    return [x, y]
  })
  const linePath = pts
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ')
  const fillPath = `${linePath} L${w},${h} L0,${h} Z`

  // Last point indicator
  const last = pts[pts.length - 1]

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      <defs>
        <linearGradient id="vf-spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill="url(#vf-spark-fill)" />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last[0]} cy={last[1]} r="1.8" fill={color} />
      <circle
        cx={last[0]}
        cy={last[1]}
        r="3.5"
        fill={color}
        fillOpacity="0.25"
      />
    </svg>
  )
}

// History bars — past sessions as vertical bars, claude-web styled.
function HistoryBars({ items, activeId, currentRate }) {
  // Render a row of bars; current session is appended as a brighter bar at the right.
  const max = 100
  const colorFor = (r) =>
    r >= 70 ? '#7defa1' : r >= 40 ? '#cba6f7' : '#ff94a5'
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 3,
        height: 38,
        padding: '4px 6px',
        background: 'rgba(13,13,28,0.5)',
        borderRadius: 6,
        border: '1px solid rgba(74,68,79,0.2)',
        position: 'relative',
      }}
    >
      {/* Reference grid line at 50% */}
      <div
        style={{
          position: 'absolute',
          left: 6,
          right: 6,
          top: 4 + ((100 - 50) / 100) * 30,
          height: 1,
          background: 'rgba(74,68,79,0.4)',
          pointerEvents: 'none',
        }}
      />
      {items.map((it) => {
        const c = colorFor(it.hitRate)
        const hRatio = it.hitRate / max
        return (
          <div
            key={it.id}
            title={`${it.label} - ${it.hitRate}% (${it.ago})`}
            style={{
              flex: 1,
              minWidth: 4,
              height: `${hRatio * 100}%`,
              background: `linear-gradient(180deg, ${c} 0%, ${c}88 100%)`,
              borderRadius: '2px 2px 0 0',
              opacity: 0.55,
              cursor: 'help',
              transition: 'opacity 200ms ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.95')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.55')}
          />
        )
      })}
      {/* Current session bar — outlined + brighter */}
      <div
        title={`current - ${currentRate}%`}
        style={{
          flex: 1,
          minWidth: 6,
          height: `${(currentRate / max) * 100}%`,
          background: `linear-gradient(180deg, ${colorFor(currentRate)} 0%, ${colorFor(currentRate)}cc 100%)`,
          borderRadius: '2px 2px 0 0',
          boxShadow: `0 0 8px ${colorFor(currentRate)}80`,
          marginLeft: 2,
          position: 'relative',
        }}
      />
    </div>
  )
}

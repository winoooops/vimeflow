// Vimeflow — right-side activity panel. Shows what the agent is doing right now,
// token/turn/context meters, and a scrollable activity feed.

function ActivityPanel({
  session,
  running,
  agent,
  collapsed,
  onToggleCollapsed,
  cacheCollapsedStyle = 'ring',
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
    const cache = session.cache || { cached: 0, wrote: 0, fresh: 0 }
    const cacheTotal = cache.cached + cache.wrote + cache.fresh
    const cacheRate =
      cacheTotal > 0 ? Math.round((cache.cached / cacheTotal) * 100) : null
    const ctxTone = tokPct > 90 ? '#ff94a5' : tokPct > 75 ? '#ffb4ab' : accent
    const cacheTone =
      cacheRate == null
        ? null
        : cacheRate >= 70
          ? '#7defa1'
          : cacheRate >= 40
            ? '#e2c7ff'
            : '#ff94a5'
    return (
      <aside
        style={{
          width: 44,
          flexShrink: 0,
          height: '100%',
          background: '#141424',
          borderLeft: '1px solid rgba(74,68,79,0.25)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '8px 0 12px',
        }}
      >
        {/* Expand chevron */}
        <button
          onClick={onToggleCollapsed}
          title="expand status panel"
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            background: 'transparent',
            border: 'none',
            color: '#8a8299',
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
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

        {/* Agent identity chip */}
        <div
          title={agent?.name || 'agent'}
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            background: accentDim,
            color: accent,
            display: 'grid',
            placeItems: 'center',
            fontFamily: "'JetBrains Mono', monospace",
            fontWeight: 700,
            fontSize: 12,
            marginTop: 8,
            marginBottom: 12,
            flexShrink: 0,
            border: `1px solid ${agent?.accentSoft || 'rgba(203,166,247,0.32)'}`,
          }}
        >
          {agent?.glyph || '∴'}
        </div>

        {/* Context bucket — primary indicator */}
        <Bucket
          pct={tokPct}
          color={ctxTone}
          label="CTX"
          title={`Context: ${tokPct}% (${(session.tokens.used / 1000).toFixed(1)}k / ${(session.tokens.max / 1000) | 0}k)`}
        />

        {/* Cache indicator — only when data exists. Designed to feel
            distinct from the CTX bucket: cache rate is a ratio (higher =
            good), not a fill level, so we don't reuse the beaker metaphor. */}
        {cacheRate != null && (
          <div
            style={{
              marginTop: 16,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <CacheIndicator
              style={cacheCollapsedStyle}
              rate={cacheRate}
              color={cacheTone}
              history={cache.history || []}
              breakdown={cache}
            />
            <div
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 8,
                color: '#8a8299',
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                marginTop: 2,
              }}
            >
              cache
            </div>
          </div>
        )}

        <span style={{ flex: 1 }} />

        {/* Running pulse — visible signal of life when panel is collapsed */}
        {running && (
          <span
            title="running"
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: accent,
              boxShadow: `0 0 10px ${accent}`,
              animation: 'vfPulse 1.6s ease-in-out infinite',
              flexShrink: 0,
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
  Bucket,
  BucketLiquid,
})

// ---------- BucketLiquid — animated wavy liquid inside the beaker ---------
// Two sine paths layered with opposing phases, each translated leftward on a
// loop so the visible slice continuously appears to ripple. The whole group
// also gently slosh-rotates by < 1deg. Honors prefers-reduced-motion.
function BucketLiquid({ dims, pct, color, id }) {
  const liquidH = (dims.h - 4) * (pct / 100)
  const top = dims.h - liquidH // y of liquid surface
  if (pct <= 0) return null

  // Wave amplitude scales with bucket size; capped to 1.8px so it stays subtle.
  const amp = Math.min(2.4, dims.w * 0.12)
  // Wavelength: we render TWO cycles inside a path that is 2× the bucket width,
  // then translate left by 50% to loop seamlessly.
  const wavelen = dims.w

  // Build a wavy path 2× wide. SVG x runs 0..2w; we approximate the sine with
  // a series of cubic Bézier curves. 4 segments per wavelength reads as a
  // smooth wave at these sizes.
  const wavePath = buildWave(dims.w * 2, amp, wavelen, dims.h)

  return (
    <g
      style={{
        transformOrigin: `${dims.w / 2}px ${dims.h}px`,
        animation: 'vfSlosh 1.8s ease-in-out infinite',
      }}
    >
      {/* Solid fill below the wave: a rect from (top + amp) down to bottom.
          This is the bulk of the liquid that doesn't need to ripple. */}
      <rect
        x={0}
        y={top + amp}
        width={dims.w}
        height={dims.h - (top + amp)}
        fill={`url(#bucket-fill-${id})`}
      />

      {/* Animated wave A — lighter, faster */}
      <g
        style={{
          transform: `translateY(${top - amp / 2}px)`,
        }}
      >
        <g
          style={{
            animation: 'vfWaveA 1.6s linear infinite',
          }}
        >
          <path d={wavePath} fill={color} fillOpacity="0.55" />
        </g>
      </g>

      {/* Animated wave B — heavier, slower, offset phase */}
      <g
        style={{
          transform: `translateY(${top}px)`,
        }}
      >
        <g
          style={{
            animation: 'vfWaveB 2.4s linear infinite',
          }}
        >
          <path
            d={wavePath}
            fill={`url(#bucket-fill-${id})`}
            fillOpacity="0.95"
          />
        </g>
      </g>

      {/* Meniscus highlight — a 1px line at the average level */}
      <line
        x1="2"
        x2={dims.w - 2}
        y1={top + 0.5}
        y2={top + 0.5}
        stroke={color}
        strokeWidth="1.1"
        strokeOpacity="0.85"
      />
    </g>
  )
}

// Build a wavy filled path that's `width` wide (we use 2× the bucket width so
// translateX(-50%) loops seamlessly). The path starts at the wave's leading
// edge, sweeps through 2 sine cycles, then drops straight down and seals.
function buildWave(width, amp, wavelen, totalH) {
  // 4 cubic-Bézier segments per wavelength gives a smooth sine.
  // Each segment spans wavelen/4 horizontally.
  const segs = Math.ceil((width / wavelen) * 4)
  const step = width / segs
  let d = `M 0,${amp}`
  // Heights at each anchor point: 0, +amp, 0, -amp, 0, +amp, ...
  // Anchor 0 = +amp (start), anchor 1 = 0, anchor 2 = -amp, anchor 3 = 0, anchor 4 = +amp, ...
  // Bézier control points: smooth-curve via reflection.
  for (let i = 1; i <= segs; i++) {
    const x = step * i
    const phase = i % 4
    const y = phase === 0 ? amp : phase === 1 ? 0 : phase === 2 ? 0 : 0
    // We use a smooth quadratic-feel with cubic Bézier; alternating high/low.
    const cp1x = step * (i - 1) + step / 2
    const cp2x = step * i - step / 2
    const prevPhase = (i - 1) % 4
    const prevY =
      prevPhase === 0 ? amp : prevPhase === 1 ? 0 : prevPhase === 2 ? 0 : 0
    // Simple sine-ish: alternate between peak and trough every 2 segments.
    const targetY = i % 2 === 0 ? amp : 0
    const startY = (i - 1) % 2 === 0 ? amp : 0
    d += ` C ${cp1x},${startY} ${cp2x},${targetY} ${x},${targetY}`
  }
  // Close the bottom: drop to totalH and back to x=0
  d += ` L ${width},${totalH} L 0,${totalH} Z`
  return d
}

// ---------- Bucket — vertical beaker for the collapsed activity rail -------
// Big horizontal % above a glass beaker that fills from the bottom in the
// agent's accent color. Replaces the older 4px bar + rotated text rail.
function Bucket({ pct, color, label, size = 'md', title }) {
  const clamped = Math.max(0, Math.min(100, pct))
  const dims =
    size === 'sm'
      ? { w: 18, h: 56, neck: 6, pctSize: 10, labelSize: 7.5 }
      : { w: 22, h: 110, neck: 8, pctSize: 12, labelSize: 8 }

  // Tick marks at 25/50/75 inside the beaker
  const ticks = [25, 50, 75]

  return (
    <div
      title={title}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
      }}
    >
      {/* Big percentage above the bucket */}
      <div
        style={{
          fontFamily: "'Instrument Sans', system-ui",
          fontSize: dims.pctSize + 2,
          fontWeight: 600,
          color: '#e3e0f7',
          letterSpacing: '-0.02em',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}
      >
        {clamped}
        <span style={{ color, fontSize: dims.pctSize - 2, marginLeft: 1 }}>
          %
        </span>
      </div>

      {/* The beaker */}
      <svg
        width={dims.w}
        height={dims.h}
        viewBox={`0 0 ${dims.w} ${dims.h}`}
        style={{ display: 'block' }}
      >
        <defs>
          <linearGradient
            id={`bucket-fill-${label}-${size}`}
            x1="0"
            y1="1"
            x2="0"
            y2="0"
          >
            <stop offset="0%" stopColor={color} stopOpacity="0.85" />
            <stop offset="100%" stopColor={color} stopOpacity="0.55" />
          </linearGradient>
          <linearGradient
            id={`bucket-glass-${label}-${size}`}
            x1="0"
            y1="0"
            x2="1"
            y2="0"
          >
            <stop offset="0%" stopColor="rgba(255,255,255,0.06)" />
            <stop offset="40%" stopColor="rgba(255,255,255,0.02)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.15)" />
          </linearGradient>
          {/* Clip to the inner beaker shape so the fill respects the neck */}
          <clipPath id={`bucket-clip-${label}-${size}`}>
            {beakerPath(dims, 1)}
          </clipPath>
        </defs>

        {/* Glass back layer */}
        {beakerPath(dims, 0, `url(#bucket-glass-${label}-${size})`)}

        {/* Liquid fill (clipped to beaker) — wavy top, gentle slosh */}
        <g clipPath={`url(#bucket-clip-${label}-${size})`}>
          <BucketLiquid
            dims={dims}
            pct={clamped}
            color={color}
            id={`${label}-${size}`}
          />
          {/* Tick marks (only on medium bucket) */}
          {size === 'md' &&
            ticks.map((t) => (
              <line
                key={t}
                x1="1"
                x2="4"
                y1={dims.h - (dims.h - 4) * (t / 100)}
                y2={dims.h - (dims.h - 4) * (t / 100)}
                stroke="rgba(255,255,255,0.18)"
                strokeWidth="0.8"
              />
            ))}
          {size === 'md' &&
            ticks.map((t) => (
              <line
                key={`r${t}`}
                x1={dims.w - 4}
                x2={dims.w - 1}
                y1={dims.h - (dims.h - 4) * (t / 100)}
                y2={dims.h - (dims.h - 4) * (t / 100)}
                stroke="rgba(255,255,255,0.18)"
                strokeWidth="0.8"
              />
            ))}
        </g>

        {/* Glass outline */}
        {beakerPath(dims, 0, 'none', color)}
      </svg>

      {/* Label below — horizontal, readable */}
      {label && (
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: dims.labelSize,
            color: '#8a8299',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            marginTop: 2,
          }}
        >
          {label}
        </div>
      )}
    </div>
  )
}

// Beaker path: rounded rectangle with a slightly inset top opening so it
// reads as a vessel rather than a pill. Returns an SVG <rect> for the simple
// version — a real beaker shape with a narrowed neck would need a <path>,
// but the rectangle reads cleanly at these small sizes.
function beakerPath(dims, isClipPath, fill, stroke) {
  const r = 3
  if (isClipPath) {
    return (
      <rect x="1" y="2" width={dims.w - 2} height={dims.h - 3} rx={r} ry={r} />
    )
  }
  return (
    <rect
      x="1"
      y="2"
      width={dims.w - 2}
      height={dims.h - 3}
      rx={r}
      ry={r}
      fill={fill || 'transparent'}
      stroke={stroke || 'rgba(255,255,255,0.18)'}
      strokeWidth="1"
    />
  )
}

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

// ---------- CacheIndicator — collapsed-rail cache hit display -------------
// Cache rate is a RATIO (% of tokens reused), not a fill level. We avoid the
// bucket metaphor by default so it doesn't read as "filling up = bad"
// alongside the CTX bucket above it.
//   - ring   : donut with % in the middle (natural ratio viz, default)
//   - bucket : the original beaker, kept as a tweakable fallback
//
// CacheSpark is defined below but intentionally NOT wired into the switch —
// it's reserved for the upcoming rate card (separate component) where a
// sparkline of recent session rates earns its own row.
function CacheIndicator({ style, rate, color, history, breakdown }) {
  const title = `Cache hit rate: ${rate}%`
  if (style === 'bucket') {
    return <Bucket pct={rate} color={color} label="" title={title} size="sm" />
  }
  return <CacheRing rate={rate} color={color} title={title} />
}

// Donut ring. % sits in the middle. Ratio metric → ratio shape.
function CacheRing({ rate, color, title }) {
  const size = 30,
    stroke = 3.5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const off = c - (rate / 100) * c
  return (
    <div
      title={title}
      style={{ position: 'relative', width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ display: 'block', transform: 'rotate(-90deg)' }}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(74,68,79,0.45)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
          style={{
            filter: `drop-shadow(0 0 3px ${color}88)`,
            transition: 'stroke-dashoffset 360ms ease',
          }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeItems: 'center',
          fontFamily: "'Instrument Sans', system-ui",
          fontSize: 9.5,
          fontWeight: 600,
          color: '#e3e0f7',
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}
      >
        {rate}
      </div>
    </div>
  )
}

// Vertical sparkline of the last few session rates, with the current value
// labelled below. Emphasises trend, which is what you actually care about
// once a session has been running for a while.
function CacheSpark({ rate, color, history, title }) {
  const data = history && history.length > 0 ? history.slice(-12) : [rate]
  const w = 28,
    h = 30
  const max = 100
  const step = data.length > 1 ? w / (data.length - 1) : w
  const pts = data.map((v, i) => [i * step, h - (v / max) * (h - 3) - 1.5])
  const line = pts
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ')
  const fill = `${line} L${w},${h} L0,${h} Z`
  const last = pts[pts.length - 1]
  return (
    <div
      title={title}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
      }}
    >
      <div
        style={{
          fontFamily: "'Instrument Sans', system-ui",
          fontSize: 11,
          fontWeight: 600,
          color: '#e3e0f7',
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}
      >
        {rate}
        <span style={{ color, fontSize: 8, marginLeft: 1 }}>%</span>
      </div>
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{ display: 'block' }}
      >
        <defs>
          <linearGradient id="vf-cache-spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* 50% reference line */}
        <line
          x1="0"
          y1={h / 2}
          x2={w}
          y2={h / 2}
          stroke="rgba(74,68,79,0.5)"
          strokeWidth="0.5"
          strokeDasharray="1.5,2"
        />
        <path d={fill} fill="url(#vf-cache-spark-fill)" />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={last[0]} cy={last[1]} r="1.6" fill={color} />
        <circle
          cx={last[0]}
          cy={last[1]}
          r="3"
          fill={color}
          fillOpacity="0.25"
        />
      </svg>
    </div>
  )
}

// 5-segment vertical signal bar (Bars / dots) was removed — Ring won, and
// the bucket fallback covers anyone who still wants the fill metaphor.
// Sparkline lives on for the future rate card.

Object.assign(window, { CacheIndicator, CacheRing, CacheSpark })

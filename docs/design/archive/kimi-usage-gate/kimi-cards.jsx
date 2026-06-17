// Vimeflow — Kimi-only "plan usage" permission gate for the Agent Status Card.
//
// Kimi's 5-hour + weekly plan limits aren't in any local file — reading them
// means POSTing the user's Kimi API key to api.kimi.com. Claude / Codex read
// limits from local config, so they never show this; this affordance is
// KIMI-ONLY and carries Kimi's peach ☾ identity.
//
// The usage SLOT (the fixed-height region under the card header) has five
// states. They all occupy the SAME height (SLOT_H) so the session list below
// the card never shifts as the slot changes:
//   OFF      — compact opt-in CTA (button) + one network-hint line
//   LOADING  — brief two-bar skeleton, shimmering toward the ON layout
//   ON       — two PEACH RateLimit bars (5-hour + weekly) each w/ reset subline
//   ERROR    — quiet offline / auth failure + soft retry
//   REVOKE   — ON + the subtle turn-off control revealed
//
// Everything reuses the live card shell (radial wash + soft elevation, no hard
// header stripe) and the exact UsageBar two-bar style from src/shell.jsx.

const { useState } = React

const SIDEBAR_W = 272
const SLOT_H = 84 // tallest state (ON, with reset sublines) — others center within it
const MONO = "'JetBrains Mono', monospace"
const SANS = "'Instrument Sans', system-ui"

// Kimi peach identity — warm, between the coral warn (#ff94a5) and shell
// yellow (#f0c674); shares the pastel chroma of every other agent accent.
const KIMI = '#ffb38a',
  KIMI_RGB = '255,179,138'
const KIMI_BRIGHT = '#ffcaa8',
  KIMI_BRIGHT_RGB = '255,201,168'

function useHover() {
  const [h, setH] = useState(false)
  return [
    h,
    { onMouseEnter: () => setH(true), onMouseLeave: () => setH(false) },
  ]
}

// ── Shared card shell — identical to src/shell.jsx's elevated surface ───────
function CardShell({ wash, children }) {
  return (
    <div style={{ padding: '12px 12px 10px' }}>
      <div
        style={{
          position: 'relative',
          borderRadius: 13,
          padding: '12px 14px 14px',
          background: `radial-gradient(120% 90% at 0% 0%, ${wash} 0%, rgba(var(--vf-surface-2-rgb),0) 55%), rgba(var(--vf-surface-2-rgb),0.88)`,
          border: '1px solid rgba(var(--vf-outline-rgb),0.3)',
          boxShadow:
            '0 5px 18px rgba(0,0,0,0.14), inset 0 1px 0 rgba(255,255,255,0.045)',
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
    </div>
  )
}

// ── Kimi header — peach ☾ identity chip + model + context + turns ───────────
// Parallels the agent header in src/shell.jsx (identity left, count right).
function KimiHeader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: 6,
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: `rgba(${KIMI_RGB},0.16)`,
            color: KIMI,
            fontSize: 12,
            lineHeight: 1,
          }}
        >
          ☾
        </span>
        <span
          style={{
            fontFamily: SANS,
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--vf-text)',
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          Kimi K2
        </span>
        <span
          style={{
            flexShrink: 0,
            fontFamily: MONO,
            fontSize: 9.5,
            fontWeight: 600,
            color: 'var(--vf-text-2)',
            padding: '1px 5px',
            borderRadius: 5,
            background: 'rgba(var(--vf-outline-rgb),0.32)',
          }}
        >
          256K
        </span>
      </div>
      <span
        style={{
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontFamily: MONO,
          fontSize: 10.5,
          fontWeight: 600,
          color: 'var(--vf-text-1)',
        }}
        title="8 turns"
      >
        <Icon name="forum" size={12} style={{ color: 'var(--vf-text-3)' }} />8
      </span>
    </div>
  )
}

// ── Peach RateLimit bar — the live two-bar UsageBar style + a reset subline ──
function KimiUsageBar({ label, pct, reset, style }) {
  const p = Math.max(0, Math.min(100, pct || 0))
  return (
    <div style={style}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 5,
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--vf-text-2)',
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 10.5,
            fontWeight: 600,
            color: 'var(--vf-text-1)',
          }}
        >
          {p}%
        </span>
      </div>
      <div
        style={{
          height: 4,
          borderRadius: 999,
          background: 'rgba(var(--vf-outline-rgb),0.32)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${p}%`,
            borderRadius: 999,
            background: `linear-gradient(90deg, ${KIMI}, ${KIMI_BRIGHT})`,
          }}
        />
      </div>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 5 }}
      >
        <Icon name="schedule" size={10} style={{ color: 'var(--vf-text-3)' }} />
        <span
          style={{
            fontFamily: MONO,
            fontSize: 9,
            color: 'var(--vf-text-3)',
            letterSpacing: '0.02em',
          }}
        >
          {reset}
        </span>
      </div>
    </div>
  )
}

// ── 1 · OFF (default) — the opt-in affordance ───────────────────────────────
// A button (not a toggle, not a link): the action is a deliberate, reversible
// network fetch that ships your key off-device — a toggle implies a free,
// instant local flip; a link implies navigation. The cloud glyph + the named
// host api.kimi.com say "this goes over the network" plainly, without alarm.
function SlotOff({ onEnable }) {
  const [hover, bind] = useHover()
  return (
    <div
      style={{
        height: SLOT_H,
        marginTop: 11,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 9,
      }}
    >
      <button
        {...bind}
        onClick={onEnable}
        title="Sends your Kimi API key to api.kimi.com to read your 5-hour and weekly limits"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          width: '100%',
          height: 34,
          padding: '0 11px',
          borderRadius: 9,
          cursor: 'pointer',
          textAlign: 'left',
          background: hover
            ? `rgba(${KIMI_RGB},0.14)`
            : 'rgba(var(--vf-surface-0-rgb),0.5)',
          border: `1px solid ${hover ? `rgba(${KIMI_RGB},0.5)` : 'rgba(var(--vf-outline-rgb),0.34)'}`,
          transition: 'all 140ms ease',
        }}
      >
        <Icon
          name="cloud"
          size={15}
          style={{ color: hover ? KIMI : 'var(--vf-text-2)', flexShrink: 0 }}
        />
        <span
          style={{
            flex: 1,
            fontFamily: SANS,
            fontSize: 12.5,
            fontWeight: 600,
            color: hover ? KIMI_BRIGHT : 'var(--vf-text-1)',
          }}
        >
          Show plan usage
        </span>
        <span
          style={{
            fontSize: 12,
            color: hover ? KIMI : 'var(--vf-text-3)',
            flexShrink: 0,
          }}
        >
          ☾
        </span>
      </button>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: '0 2px',
        }}
      >
        <Icon
          name="lock"
          size={11}
          style={{ color: 'var(--vf-text-3)', flexShrink: 0 }}
        />
        <span
          style={{
            fontFamily: MONO,
            fontSize: 9.5,
            lineHeight: 1.3,
            color: 'var(--vf-text-3)',
          }}
        >
          Fetches limits from{' '}
          <span style={{ color: 'var(--vf-text-2)' }}>api.kimi.com</span>
        </span>
      </div>
    </div>
  )
}

// ── 2 · LOADING — brief two-bar skeleton, shimmering toward ON ──────────────
function SkeletonBar({ label, caption }) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 5,
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 9.5,
            fontWeight: 700,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--vf-text-2)',
          }}
        >
          {label}
        </span>
        <Icon
          name="progress_activity"
          size={11}
          style={{ color: KIMI, animation: 'kimiSpin 0.8s linear infinite' }}
        />
      </div>
      <div
        style={{
          height: 4,
          borderRadius: 999,
          background: 'rgba(var(--vf-outline-rgb),0.32)',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div className="kimi-shimmer" />
      </div>
      <div style={{ marginTop: 5, height: 11 }}>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 9,
            color: 'var(--vf-text-3)',
            letterSpacing: '0.02em',
          }}
        >
          {caption}
        </span>
      </div>
    </div>
  )
}
function SlotLoading() {
  return (
    <div
      style={{
        height: SLOT_H,
        marginTop: 11,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 8,
      }}
    >
      <SkeletonBar label="5-Hour Session" caption="Contacting api.kimi.com…" />
      <SkeletonBar label="Weekly Usage" caption="checking…" />
    </div>
  )
}

// ── 5 · the subtle revoke / turn-off control (visible once ON) ──────────────
// Sits in the slot's bottom-right corner — clear of the bars' % values and
// reset sublines. Faint at rest; on hover it tints peach and grows a "Turn
// off" label that flows left so it stays inside the card.
function RevokeControl({ expanded, onClick }) {
  const [hover, bind] = useHover()
  const on = expanded || hover
  return (
    <button
      {...bind}
      onClick={onClick}
      title="Turn off plan usage — stops network calls to Kimi"
      style={{
        position: 'absolute',
        bottom: -3,
        right: -3,
        height: 20,
        borderRadius: 6,
        border: 'none',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: on ? '0 7px 0 6px' : 0,
        width: on ? 'auto' : 20,
        justifyContent: 'center',
        background: on ? `rgba(${KIMI_RGB},0.16)` : 'transparent',
        color: on ? KIMI : 'var(--vf-text-3)',
        opacity: on ? 1 : 0.55,
        transition:
          'background 140ms ease, color 140ms ease, opacity 140ms ease',
        zIndex: 3,
      }}
    >
      <Icon name="power_settings_new" size={13} style={{ flexShrink: 0 }} />
      {on && (
        <span
          style={{
            fontFamily: MONO,
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
          }}
        >
          Turn off
        </span>
      )}
    </button>
  )
}

// ── 3 · ON — two peach bars, each with a reset-time subline ─────────────────
function SlotOn({ revoke, onRevoke }) {
  return (
    <div
      style={{
        position: 'relative',
        height: SLOT_H,
        marginTop: 11,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 8,
      }}
    >
      <KimiUsageBar label="5-Hour Session" pct={41} reset="resets in 4h 12m" />
      <KimiUsageBar label="Weekly Usage" pct={68} reset="resets Mon · 3d 6h" />
      <RevokeControl expanded={revoke} onClick={onRevoke} />
    </div>
  )
}

// ── 4 · ERROR — quiet offline / auth failure + soft retry ───────────────────
function SlotError({ onRetry, onOff }) {
  const [hover, bind] = useHover()
  return (
    <div
      style={{
        height: SLOT_H,
        marginTop: 11,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            flexShrink: 0,
            background: 'rgba(var(--vf-warn-rgb),0.1)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Icon
            name="cloud_off"
            size={16}
            style={{ color: 'var(--vf-warn)' }}
          />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 12.5,
              fontWeight: 600,
              color: 'var(--vf-text-1)',
            }}
          >
            Couldn’t reach Kimi
          </div>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 9.5,
              color: 'var(--vf-text-3)',
              marginTop: 2,
            }}
          >
            Offline, or key was rejected.
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          {...bind}
          onClick={onRetry}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            height: 24,
            padding: '0 10px 0 8px',
            borderRadius: 7,
            cursor: 'pointer',
            background: hover
              ? `rgba(${KIMI_RGB},0.14)`
              : 'rgba(var(--vf-surface-0-rgb),0.5)',
            border: `1px solid ${hover ? `rgba(${KIMI_RGB},0.45)` : 'rgba(var(--vf-outline-rgb),0.34)'}`,
            color: hover ? KIMI : 'var(--vf-text-1)',
            transition: 'all 140ms ease',
          }}
        >
          <Icon name="refresh" size={13} />
          <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 600 }}>
            Retry
          </span>
        </button>
        <button
          onClick={onOff}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '4px 2px',
            color: 'var(--vf-text-3)',
            fontFamily: MONO,
            fontSize: 10,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--vf-text-1)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--vf-text-3)'
          }}
        >
          Turn off
        </button>
      </div>
    </div>
  )
}

// ── The Kimi card in a given slot state ─────────────────────────────────────
const SLOT_WASH = `rgba(${KIMI_RGB},0.09)`
function KimiCard({ state }) {
  let body
  if (state === 'off') body = <SlotOff />
  else if (state === 'loading') body = <SlotLoading />
  else if (state === 'error') body = <SlotError />
  else if (state === 'revoke') body = <SlotOn revoke />
  else body = <SlotOn /> // 'on'
  return (
    <CardShell wash={SLOT_WASH}>
      <KimiHeader />
      {body}
    </CardShell>
  )
}

// Interactive demo card — click the OFF CTA to watch off → loading → on, and
// the revoke control to return to off. Used in the live preview row.
function KimiCardLive() {
  const [state, setState] = useState('off')
  const enable = () => {
    setState('loading')
    setTimeout(() => setState('on'), 1500)
  }
  let body
  if (state === 'off') body = <SlotOff onEnable={enable} />
  else if (state === 'loading') body = <SlotLoading />
  else if (state === 'error')
    body = <SlotError onRetry={enable} onOff={() => setState('off')} />
  else body = <SlotOn onRevoke={() => setState('off')} />
  return (
    <CardShell wash={SLOT_WASH}>
      <KimiHeader />
      {body}
    </CardShell>
  )
}

// ── Sidebar frame — drops the card at the top of a faux sidebar so each state
//    reads in context: the divider + view switcher + ghost session rows below
//    show that the list stays anchored no matter which slot state is shown. ──
function KimiSidebarFrame({ children }) {
  return (
    <div
      style={{ width: SIDEBAR_W, background: 'var(--vf-bg)', paddingTop: 2 }}
    >
      {children}
      <div
        style={{
          borderTop: '1px solid rgba(var(--vf-outline-rgb),0.18)',
          margin: '0 12px',
        }}
      />
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '12px 12px 8px',
          opacity: 0.5,
        }}
      >
        <div
          style={{
            flex: 1,
            height: 28,
            borderRadius: 8,
            background: 'rgba(var(--vf-surface-0-rgb),0.5)',
            border: '1px solid rgba(var(--vf-outline-rgb),0.25)',
          }}
        />
        <div
          style={{
            width: 36,
            height: 28,
            borderRadius: 8,
            background: 'rgba(var(--vf-surface-0-rgb),0.3)',
          }}
        />
      </div>
      <div style={{ padding: '4px 12px 14px', opacity: 0.32 }}>
        {[0, 1].map((i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: '8px 6px',
            }}
          >
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: 'var(--vf-outline)',
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1 }}>
              <div
                style={{
                  height: 8,
                  width: i ? '52%' : '68%',
                  borderRadius: 4,
                  background: 'rgba(var(--vf-outline-rgb),0.6)',
                }}
              />
              <div
                style={{
                  height: 6,
                  width: '38%',
                  borderRadius: 4,
                  background: 'rgba(var(--vf-outline-rgb),0.35)',
                  marginTop: 6,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

Object.assign(window, {
  SIDEBAR_W,
  KIMI,
  KIMI_RGB,
  KimiCard,
  KimiCardLive,
  KimiSidebarFrame,
})

// Vimeflow — atomic primitives. Design-system aware; respond to density / aesthetic via context.

const {
  useState,
  useEffect,
  useRef,
  useContext,
  useMemo,
  useCallback,
  createContext,
} = React

// ---------- Design context ----------------------------------------------------
window.VFContext = createContext({
  aesthetic: 'obsidian',
  density: 'comfortable', // 'comfortable' | 'compact'
  contextPct: 74,
  accentHue: 285, // degrees on OKLCH wheel; base is ~285 (lavender)
  agentState: 'running', // current agent state broadcast
})

function useVF() {
  return useContext(window.VFContext)
}

// ---------- Status dot with the spec'd animations ----------------------------
function StatusDot({ state, size = 8, glow = true }) {
  // running: mint pulse + glow ; awaiting: coral pulse ; completed: hollow mint ;
  // errored: coral solid ; idle: dim hollow
  const styles = {
    running: {
      bg: '#50fa7b',
      ring: 'rgba(80,250,123,0.45)',
      anim: 'vfPulse 2s ease-in-out infinite',
    },
    awaiting: {
      bg: '#ff94a5',
      ring: 'rgba(255,148,165,0.45)',
      anim: 'vfPulse 1.4s ease-in-out infinite',
    },
    completed: {
      bg: 'transparent',
      border: '1.5px solid #7defa1',
      ring: 'transparent',
      anim: 'none',
    },
    errored: { bg: '#ffb4ab', ring: 'rgba(255,180,171,0.4)', anim: 'none' },
    idle: {
      bg: 'transparent',
      border: '1.5px solid #4a444f',
      ring: 'transparent',
      anim: 'none',
    },
  }[state] || { bg: '#8a8299' }

  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: 999,
        background: styles.bg,
        border: styles.border,
        boxShadow:
          glow && styles.ring !== 'transparent'
            ? `0 0 0 3px ${styles.ring}, 0 0 10px ${styles.bg}`
            : 'none',
        animation: styles.anim,
        flexShrink: 0,
      }}
    />
  )
}

// ---------- Small label pill -------------------------------------------------
function Chip({ tone = 'neutral', children, style, ...rest }) {
  const tones =
    {
      neutral: { bg: 'rgba(74,68,79,0.18)', fg: '#cdc3d1' },
      primary: { bg: 'rgba(203,166,247,0.14)', fg: '#e2c7ff' },
      secondary: { bg: 'rgba(168,200,255,0.14)', fg: '#a8c8ff' },
      success: { bg: 'rgba(80,250,123,0.12)', fg: '#7defa1' },
      warn: { bg: 'rgba(255,148,165,0.14)', fg: '#ff94a5' },
      error: { bg: 'rgba(215,51,87,0.18)', fg: '#ffb4ab' },
    }[tone] || {}
  return (
    <span
      {...rest}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 7px',
        borderRadius: 999,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        background: tones.bg,
        color: tones.fg,
        ...style,
      }}
    >
      {children}
    </span>
  )
}

// ---------- Tiny section header ---------------------------------------------
function SectionLabel({ children, right, style }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 2px',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
        fontWeight: 700,
        color: '#8a8299',
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        ...style,
      }}
    >
      <span>{children}</span>
      {right}
    </div>
  )
}

// ---------- Icon (Material Symbols outlined) --------------------------------
function Icon({ name, size = 18, fill = 0, style, ...rest }) {
  return (
    <span
      {...rest}
      className="material-symbols-outlined"
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' ${fill}, 'wght' 400, 'GRAD' 0, 'opsz' ${size}`,
        lineHeight: 1,
        userSelect: 'none',
        ...style,
      }}
    >
      {name}
    </span>
  )
}

// ---------- Relative-time "happened 2h ago" ---------------------------------
function RelTime({ value, style }) {
  return (
    <span
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10.5,
        color: '#8a8299',
        ...style,
      }}
    >
      {value}
    </span>
  )
}

// ---------- Tiny progress bar -----------------------------------------------
function ProgressBar({ pct, tone = 'primary', height = 3, glow = false }) {
  const grad = {
    primary: 'linear-gradient(90deg,#e2c7ff 0%,#cba6f7 100%)',
    secondary: 'linear-gradient(90deg,#a8c8ff 0%,#57377f 100%)',
    warn: 'linear-gradient(90deg,#ff94a5 0%,#fd7e94 100%)',
    success: 'linear-gradient(90deg,#7defa1 0%,#50fa7b 100%)',
  }[tone]
  return (
    <div
      style={{
        height,
        width: '100%',
        background: '#1e1e2e',
        borderRadius: 999,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${Math.max(0, Math.min(100, pct))}%`,
          background: grad,
          boxShadow: glow ? '0 0 10px rgba(226,199,255,0.45)' : 'none',
          transition: 'width 320ms cubic-bezier(.2,.8,.2,1)',
        }}
      />
    </div>
  )
}

// ---------- Glass panel (used for overlays + activity cards) ----------------
function Glass({ children, style, blur = 20, bg = 'rgba(30,30,50,0.55)' }) {
  return (
    <div
      style={{
        background: bg,
        backdropFilter: `blur(${blur}px) saturate(150%)`,
        WebkitBackdropFilter: `blur(${blur}px) saturate(150%)`,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

// ---------- Context smiley --------------------------------------------------
function ContextSmiley({ pct }) {
  const face = pct < 50 ? '😊' : pct < 75 ? '😐' : pct < 90 ? '😟' : '🥵'
  const tone =
    pct < 50
      ? '#7defa1'
      : pct < 75
        ? '#cdc3d1'
        : pct < 90
          ? '#ff94a5'
          : '#ffb4ab'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 14 }}>{face}</span>
      <span
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: tone,
          fontWeight: 700,
        }}
      >
        {pct}%
      </span>
    </span>
  )
}

// ---------- Keyboard hint ---------------------------------------------------
function Kbd({ children }) {
  return (
    <kbd
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 18,
        height: 18,
        padding: '0 5px',
        background: 'rgba(51,51,68,0.6)',
        border: '1px solid rgba(74,68,79,0.6)',
        borderRadius: 4,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
        fontWeight: 600,
        color: '#cdc3d1',
      }}
    >
      {children}
    </kbd>
  )
}

// ---------- Shadow scroll helper (fade out ends) ----------------------------
function ScrollArea({ children, style, ...rest }) {
  return (
    <div
      {...rest}
      className="vf-scroll"
      style={{
        overflow: 'auto',
        maskImage:
          'linear-gradient(to bottom, transparent 0, black 12px, black calc(100% - 12px), transparent 100%)',
        WebkitMaskImage:
          'linear-gradient(to bottom, transparent 0, black 12px, black calc(100% - 12px), transparent 100%)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

Object.assign(window, {
  useVF,
  StatusDot,
  Chip,
  SectionLabel,
  Icon,
  RelTime,
  ProgressBar,
  Glass,
  ContextSmiley,
  Kbd,
  ScrollArea,
})

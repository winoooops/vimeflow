import { GlassSurface } from 'vibm'

// GlassSurface only reads when content sits BEHIND it (backdrop blur samples
// what's underneath), so every cell floats the glass above a colorful
// gradient + busy workspace content, the way the app's overlay chrome
// (command palette, dialogs, diff popovers) floats above panes.
const surface = {
  background: 'var(--color-surface)',
  color: 'var(--color-on-surface)',
  padding: 24,
  borderRadius: 12,
  display: 'flex',
  flexWrap: 'wrap' as const,
  alignItems: 'center',
  gap: 16,
}

const backdrop = {
  position: 'relative' as const,
  borderRadius: 12,
  overflow: 'hidden',
  background:
    'linear-gradient(135deg, var(--color-primary) 0%, var(--color-tertiary) 45%, var(--color-agent-kimi-accent) 100%)',
}

const codeLine = {
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  lineHeight: '18px',
  color: 'color-mix(in srgb, var(--color-scrim) 70%, transparent)',
  whiteSpace: 'nowrap' as const,
}

// Busy terminal-ish text painted under the glass so the blur has detail to eat.
const BackdropNoise = () => (
  <div style={{ position: 'absolute', inset: 0, padding: 16 }} aria-hidden>
    <div style={codeLine}>❯ git switch -c fix/vim-362-kimi-resume</div>
    <div style={codeLine}>❯ cargo test -p vimeflow-backend agent::kimi</div>
    <div style={codeLine}>running 14 tests ... ok. 0 failed</div>
    <div style={codeLine}>❯ npx vitest run src/features/sessions</div>
    <div style={codeLine}>✓ Tab.test.tsx (12) ✓ SessionsView.test.tsx (9)</div>
    <div style={codeLine}>❯ gh pr create --fill --label auto-review</div>
    <div style={codeLine}>https://github.com/winoooops/vimeflow/pull/716</div>
  </div>
)

const glassBorder = {
  border:
    '1px solid color-mix(in srgb, var(--color-outline-variant) 35%, transparent)',
  boxShadow:
    '0 18px 40px color-mix(in srgb, var(--color-scrim) 45%, transparent)',
}

const paletteRow = (label: string, hint: string, active = false) => (
  <div
    key={label}
    style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '7px 10px',
      borderRadius: 8,
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      background: active
        ? 'color-mix(in srgb, var(--color-primary) 18%, transparent)'
        : 'transparent',
      color: active ? 'var(--color-primary)' : 'var(--color-on-surface)',
    }}
  >
    <span>{label}</span>
    <span style={{ fontSize: 10, color: 'var(--color-on-surface-variant)' }}>
      {hint}
    </span>
  </div>
)

// The command-palette treatment: a frosted panel centered above the workspace.
export const CommandPaletteOverlay = () => (
  <div style={surface}>
    <div style={{ ...backdrop, width: 620, height: 300 }}>
      <BackdropNoise />
      <GlassSurface
        style={{
          ...glassBorder,
          position: 'absolute',
          top: 36,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 420,
          borderRadius: 14,
          padding: 10,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px 10px',
            borderBottom:
              '1px solid color-mix(in srgb, var(--color-outline-variant) 25%, transparent)',
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--color-on-surface-variant)',
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 15 }}
            aria-hidden
          >
            keyboard_command_key
          </span>
          <span>:sp</span>
        </div>
        <div style={{ paddingTop: 6 }}>
          {paletteRow(':split vertical', 'pane', true)}
          {paletteRow(':split horizontal', 'pane')}
          {paletteRow(':sp diff HEAD~1', 'git')}
        </div>
      </GlassSurface>
    </div>
  </div>
)

// tintAlpha sweep — lower alpha lets more of the gradient ghost through.
export const TintAlphaScale = () => (
  <div style={surface}>
    <div
      style={{
        ...backdrop,
        width: 620,
        height: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
      }}
    >
      <BackdropNoise />
      {[0.35, 0.65, 0.9].map((alpha) => (
        <GlassSurface
          key={alpha}
          tintAlpha={alpha}
          style={{
            ...glassBorder,
            position: 'relative',
            width: 160,
            height: 110,
            borderRadius: 12,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            gap: 4,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--color-on-surface)',
            }}
          >
            tintAlpha {alpha}
          </div>
          <div
            style={{
              fontSize: 10,
              color: 'var(--color-on-surface-variant)',
            }}
          >
            {alpha < 0.5
              ? 'see-through'
              : alpha < 0.8
                ? 'default overlay'
                : 'near-opaque'}
          </div>
        </GlassSurface>
      ))}
    </div>
  </div>
)

// A small floating action bar — the tooltip/popover-scale use of the glass.
export const FloatingPaneToolbar = () => (
  <div style={surface}>
    <div style={{ ...backdrop, width: 400, height: 190 }}>
      <BackdropNoise />
      <GlassSurface
        tintAlpha={0.55}
        style={{
          ...glassBorder,
          position: 'absolute',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 8px',
          borderRadius: 999,
        }}
      >
        {['content_copy', 'vertical_split', 'open_in_full', 'close'].map(
          (icon) => (
            <span
              key={icon}
              className="material-symbols-outlined"
              style={{
                fontSize: 16,
                padding: 6,
                borderRadius: 999,
                color: 'var(--color-on-surface)',
              }}
              aria-hidden
            >
              {icon}
            </span>
          )
        )}
      </GlassSurface>
    </div>
  </div>
)

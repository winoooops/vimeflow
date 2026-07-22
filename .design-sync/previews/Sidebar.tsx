import { AgentGlyph, Sidebar, SidebarTabs } from 'vibm'

// Sidebar is the app's left-rail shell: slot-driven (topBar / header /
// content / bottomPane / footer) on the surface-container-low plane, with a
// WAI-ARIA splitter above the optional bottom pane. Cells rebuild the
// WorkspaceView composition with inline-styled slot content.
const surface = {
  background: 'var(--color-surface)',
  color: 'var(--color-on-surface)',
  padding: 24,
  borderRadius: 12,
  display: 'flex',
  flexWrap: 'wrap' as const,
  alignItems: 'flex-start',
  gap: 16,
}

const shell = (width: number, height: number) => ({
  width,
  height,
  borderRadius: 12,
  overflow: 'hidden',
  boxShadow:
    '0 12px 32px color-mix(in srgb, var(--color-scrim) 35%, transparent)',
})

const mono = (size: number) => ({
  fontFamily: 'var(--font-mono)',
  fontSize: size,
})

const noop = () => {}

const icon = (name: string, size = 16, color?: string) => (
  <span
    className="material-symbols-outlined"
    style={{
      fontSize: size,
      color: color ?? 'var(--color-on-surface-variant)',
    }}
    aria-hidden
  >
    {name}
  </span>
)

const TopBar = () => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: 42,
      padding: '0 12px',
    }}
  >
    <span
      style={{
        ...mono(11),
        fontWeight: 700,
        letterSpacing: '0.14em',
        color: 'var(--color-on-surface)',
      }}
    >
      VIMEFLOW
    </span>
    {icon('left_panel_close')}
  </div>
)

const usageBar = (pct: number) => (
  <div
    style={{
      height: 3,
      borderRadius: 999,
      background: 'color-mix(in srgb, var(--color-primary) 18%, transparent)',
    }}
  >
    <div
      style={{
        width: `${pct}%`,
        height: '100%',
        borderRadius: 999,
        background: 'var(--color-primary)',
      }}
    />
  </div>
)

const AgentStatusHeader = () => (
  <div
    style={{
      background: 'var(--color-surface-container)',
      borderRadius: 10,
      padding: 12,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}
  >
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600 }}>Claude Code</span>
      <span style={{ ...mono(9.5), color: 'var(--color-on-surface-variant)' }}>
        TURNS 14
      </span>
    </div>
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {usageBar(62)}
      {usageBar(31)}
    </div>
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        ...mono(9),
        color: 'var(--color-on-surface-muted)',
      }}
    >
      <span>5H 62%</span>
      <span>WEEK 31%</span>
    </div>
  </div>
)

const CLAUDE = {
  id: 'claude',
  short: 'CLAUDE',
  glyph: '∴',
  accent: 'var(--color-agent-claude-accent)',
  accentDim: 'var(--color-agent-claude-accent-dim)',
}
const CODEX = {
  id: 'codex',
  short: 'CODEX',
  glyph: '◇',
  accent: 'var(--color-agent-codex-accent)',
  accentDim: 'var(--color-agent-codex-accent-dim)',
}
const KIMI = {
  id: 'kimi',
  short: 'KIMI',
  glyph: '☾',
  accent: 'var(--color-agent-kimi-accent)',
  accentDim: 'var(--color-agent-kimi-accent-dim)',
}
const SHELL = {
  id: 'shell',
  short: 'SHELL',
  glyph: '$',
  accent: 'var(--color-agent-shell-accent)',
  accentDim: 'var(--color-agent-shell-accent-dim)',
}

const SessionRow = ({
  agent,
  name,
  active = false,
}: {
  agent: typeof CLAUDE
  name: string
  active?: boolean
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 10px',
      borderRadius: 8,
      background: active
        ? 'var(--color-surface-container-high)'
        : 'transparent',
    }}
  >
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 16,
        flexShrink: 0,
        borderRadius: 4,
        background: agent.accentDim,
        color: agent.accent,
        ...mono(10),
        fontWeight: 700,
      }}
      aria-hidden
    >
      <AgentGlyph agent={agent} size={12} />
    </span>
    <span
      style={{
        ...mono(12.5),
        fontWeight: active ? 500 : 400,
        color: active
          ? 'var(--color-on-surface)'
          : 'var(--color-on-surface-variant)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {name}
    </span>
  </div>
)

const NewSessionStub = () => (
  <button
    type="button"
    style={{
      flex: 1,
      minWidth: 0,
      height: 36,
      border: 'none',
      borderRadius: 10,
      background: 'color-mix(in srgb, var(--color-primary) 14%, transparent)',
      color: 'var(--color-primary)',
      ...mono(11),
      fontWeight: 700,
      letterSpacing: '0.06em',
      cursor: 'pointer',
    }}
  >
    + NEW
  </button>
)

const SettingsFooter = () => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 8px',
      borderRadius: 8,
      color: 'var(--color-on-surface-variant)',
    }}
  >
    {icon('settings', 15)}
    <span style={{ ...mono(11), letterSpacing: '0.04em' }}>Settings</span>
  </div>
)

// The full app composition: top bar, agent-status header, tab row + session
// list content, settings footer.
export const SessionsShell = () => (
  <div style={surface}>
    <div style={shell(280, 460)}>
      <Sidebar
        topBar={<TopBar />}
        header={<AgentStatusHeader />}
        content={
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              height: '100%',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'stretch',
                gap: 8,
                padding: '10px 12px 12px',
              }}
            >
              <SidebarTabs
                tabs={[
                  { id: 'sessions', label: 'SESSIONS', icon: 'view_agenda' },
                  { id: 'files', label: 'FILES', icon: 'folder_open' },
                ]}
                activeId="sessions"
                onChange={noop}
              />
              <NewSessionStub />
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                padding: '0 8px',
              }}
            >
              <SessionRow agent={CLAUDE} name="vim-362 kimi resume" active />
              <SessionRow agent={CODEX} name="review: ds-bundle sync" />
              <SessionRow agent={KIMI} name="transcript locator" />
              <SessionRow agent={SHELL} name="zsh ~/projects/vimeflow" />
            </div>
          </div>
        }
        footer={<SettingsFooter />}
      />
    </div>
  </div>
)

const FileRow = ({
  name,
  depth = 0,
  dir = false,
  open = false,
}: {
  name: string
  depth?: number
  dir?: boolean
  open?: boolean
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 7,
      padding: `4px 10px 4px ${10 + depth * 14}px`,
      ...mono(12),
      color: dir
        ? 'var(--color-on-surface)'
        : 'var(--color-on-surface-variant)',
    }}
  >
    {icon(
      dir ? (open ? 'folder_open' : 'folder') : 'description',
      14,
      dir ? 'var(--color-primary)' : undefined
    )}
    <span>{name}</span>
  </div>
)

const ChangesPane = () => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      padding: '8px 0',
    }}
  >
    <div
      style={{
        ...mono(9.5),
        fontWeight: 700,
        letterSpacing: '0.1em',
        color: 'var(--color-on-surface-variant)',
        padding: '2px 12px 8px',
      }}
    >
      CHANGES · 3
    </div>
    {[
      ['M', 'agent/adapter/kimi/locator.rs'],
      ['M', 'agent/adapter/kimi/transcript.rs'],
      ['??', '.design-sync/'],
    ].map(([status, path]) => (
      <div
        key={path}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 12px',
          ...mono(11.5),
        }}
      >
        <span
          style={{
            width: 18,
            color:
              status === 'M'
                ? 'var(--color-tertiary)'
                : 'var(--color-on-surface-muted)',
            fontWeight: 700,
          }}
        >
          {status}
        </span>
        <span
          style={{
            color: 'var(--color-on-surface-variant)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {path}
        </span>
      </div>
    ))}
  </div>
)

// Files view with the resizable bottom pane — the splitter hairline sits
// between the tree and the git-changes pane.
export const FilesWithBottomPane = () => (
  <div style={surface}>
    <div style={shell(280, 440)}>
      <Sidebar
        header={
          <div
            style={{
              ...mono(9.5),
              fontWeight: 700,
              letterSpacing: '0.1em',
              color: 'var(--color-on-surface-variant)',
            }}
          >
            EXPLORER · VIMEFLOW
          </div>
        }
        content={
          <div style={{ padding: '4px 4px' }}>
            <FileRow name="src" dir open />
            <FileRow name="components" dir open depth={1} />
            <FileRow name="GlassSurface.tsx" depth={2} />
            <FileRow name="ResizeHandle.tsx" depth={2} />
            <FileRow name="sidebar" dir open depth={2} />
            <FileRow name="Sidebar.tsx" depth={3} />
            <FileRow name="SidebarTabs.tsx" depth={3} />
            <FileRow name="crates" dir depth={0} />
          </div>
        }
        bottomPane={<ChangesPane />}
        bottomPaneInitialHeight={140}
      />
    </div>
  </div>
)

// Bare minimum: only the required content slot — every optional slot
// (topBar/header/bottomPane/footer) suppressed.
export const ContentOnly = () => (
  <div style={surface}>
    <div style={shell(240, 300)}>
      <Sidebar
        content={
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: 10,
              color: 'var(--color-on-surface-muted)',
            }}
          >
            {icon('terminal', 24, 'var(--color-on-surface-muted)')}
            <span style={{ ...mono(11) }}>No open sessions</span>
          </div>
        }
      />
    </div>
  </div>
)

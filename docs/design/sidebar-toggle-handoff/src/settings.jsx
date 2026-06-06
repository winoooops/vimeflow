// Vimeflow — Settings dialog. Modal overlay, Zed-style layout:
// search-filtered sidebar of categories on the left, scoped settings pane on
// the right. Respects the Obsidian Lens system (lavender accent, gold-soft
// hairlines, mono labels).

const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'keymap', label: 'Keymap', icon: 'keyboard' },
  { id: 'agents', label: 'Coding Agents', icon: 'bolt' },
  { id: 'editor', label: 'Editor', icon: 'code' },
  { id: 'terminal', label: 'Terminal', icon: 'terminal' },
  { id: 'languages', label: 'Languages & Tools', icon: 'data_object' },
  { id: 'search', label: 'Search & Files', icon: 'search' },
  { id: 'window', label: 'Window & Layout', icon: 'grid_view' },
  { id: 'panels', label: 'Panels', icon: 'dock_to_bottom' },
  { id: 'version', label: 'Version Control', icon: 'difference' },
  { id: 'collab', label: 'Collaboration', icon: 'group' },
  { id: 'ai', label: 'AI', icon: 'psychology' },
  { id: 'network', label: 'Network', icon: 'lan' },
]

function SettingsDialog({ open, onClose, tweaks, onChange }) {
  const [section, setSection] = useState('appearance')
  const [scope, setScope] = useState('User') // User | vimeflow
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const filtered = query.trim()
    ? SETTINGS_SECTIONS.filter((s) =>
        s.label.toLowerCase().includes(query.toLowerCase())
      )
    : SETTINGS_SECTIONS

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 110,
        background: 'rgba(13,13,28,0.55)',
        backdropFilter: 'blur(14px) saturate(120%)',
        WebkitBackdropFilter: 'blur(14px) saturate(120%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
        animation: 'vfFadeIn 160ms ease',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 920,
          height: 640,
          maxWidth: '95vw',
          maxHeight: '90vh',
          background: 'rgba(20,20,32,0.96)',
          backdropFilter: 'blur(24px) saturate(160%)',
          WebkitBackdropFilter: 'blur(24px) saturate(160%)',
          border: '1px solid rgba(74,68,79,0.45)',
          borderRadius: 12,
          boxShadow:
            '0 28px 72px rgba(0,0,0,0.6), 0 0 0 1px rgba(203,166,247,0.08)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Title bar */}
        <div
          style={{
            height: 36,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            padding: '0 10px',
            gap: 6,
            borderBottom: '1px solid rgba(74,68,79,0.25)',
            background: '#15151f',
          }}
        >
          <button onClick={onClose} title="close" style={titleBtn}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {/* Sidebar */}
          <SettingsSidebar
            sections={filtered}
            active={section}
            onPick={setSection}
            query={query}
            onQuery={setQuery}
          />

          {/* Right pane */}
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <SettingsHeader
              scope={scope}
              onScope={setScope}
              section={SETTINGS_SECTIONS.find((s) => s.id === section)}
            />
            <div
              className="vf-scroll"
              style={{ flex: 1, overflow: 'auto', padding: '20px 28px 32px' }}
            >
              {section === 'general' && (
                <GeneralPane tweaks={tweaks} onChange={onChange} />
              )}
              {section === 'appearance' && (
                <AppearancePane tweaks={tweaks} onChange={onChange} />
              )}
              {section === 'keymap' && (
                <KeymapPane tweaks={tweaks} onChange={onChange} />
              )}
              {section === 'agents' && (
                <AgentsPane tweaks={tweaks} onChange={onChange} />
              )}
              {!['general', 'appearance', 'keymap', 'agents'].includes(
                section
              ) && (
                <PlaceholderPane
                  section={SETTINGS_SECTIONS.find((s) => s.id === section)}
                />
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            height: 28,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            padding: '0 14px',
            gap: 10,
            borderTop: '1px solid rgba(74,68,79,0.25)',
            background: '#0d0d1c',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: '#6c7086',
          }}
        >
          <Kbd>ctrl</Kbd>+<Kbd>shift</Kbd>+<Kbd>e</Kbd>
          <span style={{ color: '#cba6f7' }}>Focus</span>
          <span>Navbar</span>
          <span style={{ flex: 1 }} />
          <Kbd>esc</Kbd>
          <span>close</span>
        </div>
      </div>
    </div>
  )
}

const titleBtn = {
  width: 22,
  height: 22,
  borderRadius: 4,
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: '#8a8299',
  display: 'grid',
  placeItems: 'center',
}

function SettingsSidebar({ sections, active, onPick, query, onQuery }) {
  return (
    <aside
      style={{
        width: 220,
        flexShrink: 0,
        borderRight: '1px solid rgba(74,68,79,0.25)',
        display: 'flex',
        flexDirection: 'column',
        background: '#16161f',
      }}
    >
      <div style={{ padding: '14px 12px 10px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 10px',
            background: 'rgba(13,13,28,0.6)',
            border: '1px solid rgba(74,68,79,0.35)',
            borderRadius: 8,
          }}
        >
          <Icon name="search" size={13} style={{ color: '#6c7086' }} />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search settings..."
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#e3e0f7',
              fontFamily: "'Inter', sans-serif",
              fontSize: 12,
            }}
          />
        </div>
      </div>
      <nav
        className="vf-scroll"
        style={{ flex: 1, overflow: 'auto', padding: '4px 8px 14px' }}
      >
        {sections.map((s) => {
          const isActive = s.id === active
          return (
            <button
              key={s.id}
              onClick={() => onPick(s.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '7px 10px',
                marginBottom: 1,
                background: isActive ? 'rgba(203,166,247,0.10)' : 'transparent',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                color: isActive ? '#e2c7ff' : '#cdc3d1',
                fontFamily: "'Inter', sans-serif",
                fontSize: 13,
                textAlign: 'left',
                position: 'relative',
              }}
              onMouseEnter={(e) => {
                if (!isActive)
                  e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.background = 'transparent'
              }}
            >
              {isActive && (
                <span
                  style={{
                    position: 'absolute',
                    left: -2,
                    top: 8,
                    bottom: 8,
                    width: 2,
                    background: '#cba6f7',
                    borderRadius: 2,
                  }}
                />
              )}
              <Icon
                name="chevron_right"
                size={13}
                style={{ color: isActive ? '#cba6f7' : '#6c7086' }}
              />
              {s.label}
            </button>
          )
        })}
      </nav>
    </aside>
  )
}

function SettingsHeader({ scope, onScope, section }) {
  return (
    <div
      style={{
        flexShrink: 0,
        padding: '16px 28px 14px',
        borderBottom: '1px solid rgba(74,68,79,0.25)',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {['User', 'vimeflow'].map((s) => (
          <button
            key={s}
            onClick={() => onScope(s)}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              color: scope === s ? '#cba6f7' : '#8a8299',
              fontFamily: "'Inter', sans-serif",
              fontSize: 13,
              fontWeight: scope === s ? 600 : 400,
              borderBottom:
                scope === s ? '1.5px solid #cba6f7' : '1.5px solid transparent',
              paddingBottom: 2,
            }}
          >
            {s}
          </button>
        ))}
      </div>
      <span style={{ flex: 1 }} />
      <button
        style={{
          padding: '6px 12px',
          borderRadius: 6,
          background: 'transparent',
          border: '1px solid rgba(74,68,79,0.5)',
          color: '#cdc3d1',
          cursor: 'pointer',
          fontFamily: "'Inter', sans-serif",
          fontSize: 12,
        }}
      >
        Edit in settings.json
      </button>
    </div>
  )
}

// ---------- Generic row primitives -----------------------------------------

function Row({ label, hint, children, last }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        padding: '14px 0',
        borderBottom: last ? 'none' : '1px solid rgba(74,68,79,0.18)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "'Instrument Sans', system-ui",
            fontSize: 14,
            fontWeight: 500,
            color: '#e3e0f7',
            marginBottom: 4,
          }}
        >
          {label}
        </div>
        {hint && (
          <div
            style={{
              fontFamily: "'Inter', sans-serif",
              fontSize: 12,
              color: '#8a8299',
              lineHeight: 1.5,
            }}
          >
            {hint}
          </div>
        )}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}

function PaneTitle({ title, sub }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontFamily: "'Instrument Sans', system-ui",
          fontSize: 22,
          fontWeight: 600,
          color: '#e3e0f7',
          letterSpacing: '-0.01em',
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      {sub && (
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            color: '#8a8299',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {sub}
        </div>
      )}
    </div>
  )
}

function Toggle({ on, onChange }) {
  return (
    <button
      onClick={() => onChange(!on)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 999,
        background: on ? '#cba6f7' : 'rgba(74,68,79,0.5)',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        position: 'relative',
        transition: 'background 160ms ease',
      }}
    >
      <span
        style={{
          position: 'absolute',
          left: on ? 18 : 2,
          top: 2,
          width: 16,
          height: 16,
          borderRadius: 999,
          background: on ? '#fff' : '#cdc3d1',
          transition: 'left 180ms cubic-bezier(.2,.8,.2,1)',
        }}
      />
    </button>
  )
}

function Select({ value, options, onChange, width = 180 }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width,
        height: 30,
        background: '#1e1e2e',
        border: '1px solid rgba(74,68,79,0.5)',
        borderRadius: 6,
        color: '#e3e0f7',
        fontFamily: "'Inter', sans-serif",
        fontSize: 12,
        padding: '0 10px',
        appearance: 'none',
        cursor: 'pointer',
      }}
    >
      {options.map((o) => (
        <option key={o.id || o} value={o.id || o}>
          {o.label || o}
        </option>
      ))}
    </select>
  )
}

function GhostButton({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 12px',
        borderRadius: 6,
        background: 'transparent',
        border: '1px solid rgba(74,68,79,0.5)',
        color: '#cdc3d1',
        cursor: 'pointer',
        fontFamily: "'Inter', sans-serif",
        fontSize: 12,
      }}
    >
      {children}
    </button>
  )
}

function TextInput({ value, onChange, placeholder, width = 200, mono }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width,
        height: 30,
        background: '#1e1e2e',
        border: '1px solid rgba(74,68,79,0.5)',
        borderRadius: 6,
        color: '#e3e0f7',
        fontFamily: mono
          ? "'JetBrains Mono', monospace"
          : "'Inter', sans-serif",
        fontSize: 12,
        padding: '0 10px',
        outline: 'none',
      }}
    />
  )
}

// ---------- Pane: General --------------------------------------------------

function GeneralPane({ tweaks, onChange }) {
  return (
    <>
      <PaneTitle title="General" sub="General Settings" />
      <Row
        label="When Closing With No Tabs"
        hint="What to do when using the 'close active item' action with no tabs."
      >
        <Select
          value="platform"
          options={[
            { id: 'platform', label: 'Platform Default' },
            { id: 'close', label: 'Close Window' },
            { id: 'nothing', label: 'Do Nothing' },
          ]}
          onChange={() => {}}
        />
      </Row>
      <Row
        label="On Last Window Closed"
        hint="What to do when the last window is closed."
      >
        <Select
          value="platform"
          options={[
            { id: 'platform', label: 'Platform Default' },
            { id: 'quit', label: 'Quit Application' },
          ]}
          onChange={() => {}}
        />
      </Row>
      <Row
        label="Use System Path Prompts"
        hint="Use native OS dialogs for 'Open' and 'Save As'."
      >
        <Toggle on={true} onChange={() => {}} />
      </Row>
      <Row
        label="Use System Prompts"
        hint="Use native OS dialogs for confirmations."
      >
        <Toggle on={true} onChange={() => {}} />
      </Row>
      <Row
        label="Redact Private Values"
        hint="Hide the values of variables in private files."
      >
        <Toggle on={false} onChange={() => {}} />
      </Row>
      <Row
        label="CLI Default Open Behavior"
        hint="How `vf <path>` opens directories when no flag is specified."
        last
      >
        <Select
          value="existing"
          options={[
            { id: 'existing', label: 'Add to Existing Window' },
            { id: 'new', label: 'Open in New Window' },
          ]}
          onChange={() => {}}
        />
      </Row>
    </>
  )
}

// ---------- Pane: Appearance ----------------------------------------------

const BUILTIN_SCHEMES = [
  {
    id: 'obsidian',
    label: 'Obsidian Lens',
    accent: '#cba6f7',
    surface: '#121221',
  },
  {
    id: 'editorial',
    label: 'Editorial',
    accent: '#a8c8ff',
    surface: '#141424',
  },
  { id: 'dense', label: 'Dense', accent: '#7defa1', surface: '#0d0d1c' },
  {
    id: 'navigator',
    label: 'W.W. Navigator',
    accent: '#c9a55a',
    surface: '#1a1408',
  },
]

function AppearancePane({ tweaks, onChange }) {
  const active = tweaks.aesthetic || 'obsidian'
  const fileInputRef = useRef(null)

  return (
    <>
      <PaneTitle title="Appearance" sub="Theme · Color Scheme · Typography" />

      {/* Scheme grid */}
      <div style={{ marginBottom: 18 }}>
        <div
          style={{
            fontFamily: "'Instrument Sans', system-ui",
            fontSize: 14,
            fontWeight: 500,
            color: '#e3e0f7',
            marginBottom: 4,
          }}
        >
          Color Scheme
        </div>
        <div
          style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 12,
            color: '#8a8299',
            marginBottom: 12,
          }}
        >
          The base palette for all surfaces, text, and accents. Affects every
          panel including this dialog.
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 10,
          }}
        >
          {BUILTIN_SCHEMES.map((s) => {
            const isActive = active === s.id
            return (
              <button
                key={s.id}
                onClick={() => onChange({ aesthetic: s.id })}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: isActive
                    ? 'rgba(203,166,247,0.08)'
                    : 'rgba(20,20,32,0.6)',
                  border: isActive
                    ? '1px solid rgba(203,166,247,0.45)'
                    : '1px solid rgba(74,68,79,0.35)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                {/* Swatch */}
                <div
                  style={{
                    width: 36,
                    height: 28,
                    borderRadius: 5,
                    flexShrink: 0,
                    background: s.surface,
                    border: '1px solid rgba(74,68,79,0.4)',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      left: 4,
                      top: 4,
                      width: 12,
                      height: 4,
                      borderRadius: 2,
                      background: s.accent,
                    }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      left: 4,
                      top: 12,
                      width: 18,
                      height: 2,
                      borderRadius: 1,
                      background: 'rgba(205,195,209,0.5)',
                    }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      left: 4,
                      top: 18,
                      width: 22,
                      height: 2,
                      borderRadius: 1,
                      background: 'rgba(205,195,209,0.3)',
                    }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "'Instrument Sans', system-ui",
                      fontSize: 13,
                      color: isActive ? '#e2c7ff' : '#e3e0f7',
                      fontWeight: 500,
                    }}
                  >
                    {s.label}
                  </div>
                  <div
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 10,
                      color: '#8a8299',
                      marginTop: 2,
                      letterSpacing: '0.04em',
                    }}
                  >
                    {s.id}
                  </div>
                </div>
                {isActive && (
                  <Icon name="check" size={14} style={{ color: '#cba6f7' }} />
                )}
              </button>
            )
          })}
        </div>

        {/* Import scheme */}
        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.toml"
            style={{ display: 'none' }}
          />
          <GhostButton onClick={() => fileInputRef.current?.click()}>
            <Icon
              name="file_upload"
              size={12}
              style={{ marginRight: 6, verticalAlign: 'middle' }}
            />
            Import scheme...
          </GhostButton>
          <GhostButton onClick={() => {}}>
            <Icon
              name="download"
              size={12}
              style={{ marginRight: 6, verticalAlign: 'middle' }}
            />
            Export current
          </GhostButton>
          <GhostButton onClick={() => {}}>Browse community</GhostButton>
        </div>
      </div>

      <Row
        label="Accent Hue"
        hint={`Shift the primary accent around the wheel. Current: ${tweaks.accentHue || 285}°`}
      >
        <input
          type="range"
          min="240"
          max="360"
          step="2"
          value={tweaks.accentHue || 285}
          onChange={(e) => onChange({ accentHue: +e.target.value })}
          style={{ width: 180 }}
        />
      </Row>

      <Row
        label="Density"
        hint="Compact for power users; comfortable for readability."
      >
        <Select
          value={tweaks.density || 'comfortable'}
          options={[
            { id: 'comfortable', label: 'Comfortable' },
            { id: 'compact', label: 'Compact' },
          ]}
          onChange={(v) => onChange({ density: v })}
        />
      </Row>

      <Row
        label="UI Font"
        hint="Sans-serif used for labels, sidebars, headings."
      >
        <Select
          value="instrument"
          options={[
            { id: 'instrument', label: 'Instrument Sans' },
            { id: 'inter', label: 'Inter' },
            { id: 'fraunces', label: 'Fraunces (display)' },
          ]}
          onChange={() => {}}
        />
      </Row>

      <Row
        label="Mono Font"
        hint="Used in the terminal, editor, and all code blocks."
        last
      >
        <Select
          value="jetbrains"
          options={[
            { id: 'jetbrains', label: 'JetBrains Mono' },
            { id: 'iosevka', label: 'Iosevka' },
            { id: 'fira', label: 'Fira Code' },
          ]}
          onChange={() => {}}
        />
      </Row>
    </>
  )
}

// ---------- Pane: Keymap ---------------------------------------------------

const KEYMAPS = [
  { id: 'open_palette', label: 'Open command palette', keys: ['⌘', 'K'] },
  { id: 'focus_pane_1', label: 'Focus pane 1', keys: ['⌘', '1'] },
  { id: 'focus_pane_2', label: 'Focus pane 2', keys: ['⌘', '2'] },
  { id: 'focus_pane_3', label: 'Focus pane 3', keys: ['⌘', '3'] },
  { id: 'focus_pane_4', label: 'Focus pane 4', keys: ['⌘', '4'] },
  { id: 'toggle_split', label: 'Toggle split layout', keys: ['⌘', '\\'] },
  { id: 'new_session', label: 'New agent session', keys: ['⌘', 'T'] },
  { id: 'close_pane', label: 'Close focused pane', keys: ['⌘', 'W'] },
  { id: 'open_settings', label: 'Open settings', keys: ['⌘', ','] },
  { id: 'toggle_dock', label: 'Show/hide editor & diff', keys: ['⌘', 'J'] },
  { id: 'next_pane', label: 'Next pane', keys: ['⌘', '⇥'] },
  { id: 'pause_agent', label: 'Pause focused agent', keys: ['⌃', 'C'] },
]

function KeymapPane() {
  const [preset, setPreset] = useState('vimeflow')
  return (
    <>
      <PaneTitle title="Keymap" sub="Keyboard shortcuts" />
      <Row
        label="Preset"
        hint="Switch between vim-style, default, or a custom binding set."
      >
        <Select
          value={preset}
          onChange={setPreset}
          options={[
            { id: 'vimeflow', label: 'Vimeflow (default)' },
            { id: 'vim', label: 'Vim' },
            { id: 'vscode', label: 'VS Code' },
            { id: 'jetbrains', label: 'JetBrains' },
            { id: 'custom', label: 'Custom' },
          ]}
        />
      </Row>
      <div style={{ marginTop: 18, marginBottom: 8 }}>
        <div
          style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: '#8a8299',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            marginBottom: 10,
          }}
        >
          Bindings
        </div>
        <div
          style={{
            background: 'rgba(13,13,28,0.5)',
            border: '1px solid rgba(74,68,79,0.3)',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          {KEYMAPS.map((b, i) => (
            <div
              key={b.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '10px 14px',
                borderBottom:
                  i === KEYMAPS.length - 1
                    ? 'none'
                    : '1px solid rgba(74,68,79,0.15)',
              }}
            >
              <span
                style={{
                  flex: 1,
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 13,
                  color: '#cdc3d1',
                }}
              >
                {b.label}
              </span>
              <span style={{ display: 'flex', gap: 4 }}>
                {b.keys.map((k, j) => (
                  <Kbd key={j}>{k}</Kbd>
                ))}
              </span>
              <button
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#6c7086',
                  cursor: 'pointer',
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  display: 'grid',
                  placeItems: 'center',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#e2c7ff'
                  e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = '#6c7086'
                  e.currentTarget.style.background = 'transparent'
                }}
                title="Edit binding"
              >
                <Icon name="edit" size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
        <GhostButton>Reset to preset</GhostButton>
        <GhostButton>Import bindings...</GhostButton>
        <GhostButton>Export bindings</GhostButton>
      </div>
    </>
  )
}

// ---------- Pane: Coding Agents -------------------------------------------

function AgentsPane() {
  // Vimeflow manages these aliases internally — they're injected into the
  // pane's PTY environment, NOT written to ~/.bashrc / ~/.zshrc. The toggle
  // below controls whether the shim is active at all.
  const [shimOn, setShimOn] = useState(true)
  const [aliases, setAliases] = useState([
    {
      id: 'a1',
      alias: 'cc',
      agent: 'claude',
      model: 'sonnet-4',
      extra: '--continue',
    },
    { id: 'a2', alias: 'cdx', agent: 'codex', model: 'gpt-5-codex', extra: '' },
    {
      id: 'a3',
      alias: 'gem',
      agent: 'gemini',
      model: 'gemini-2.5',
      extra: '--chat',
    },
  ])

  const addAlias = () =>
    setAliases([
      ...aliases,
      {
        id: `a${Date.now()}`,
        alias: '',
        agent: 'claude',
        model: 'sonnet-4',
        extra: '',
      },
    ])
  const update = (id, key, value) =>
    setAliases(aliases.map((a) => (a.id === id ? { ...a, [key]: value } : a)))
  const remove = (id) => setAliases(aliases.filter((a) => a.id !== id))

  return (
    <>
      <PaneTitle title="Coding Agents" sub="Shell aliases · agent registry" />

      <Row
        label="Manage agent shell aliases"
        hint="Vimeflow injects these into each pane's PTY environment. Your .bashrc / .zshrc is never touched."
      >
        <Toggle on={shimOn} onChange={setShimOn} />
      </Row>

      <div style={{ marginTop: 18 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: 10,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "'Instrument Sans', system-ui",
                fontSize: 14,
                fontWeight: 500,
                color: '#e3e0f7',
              }}
            >
              Shell aliases
            </div>
            <div
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: 12,
                color: '#8a8299',
                marginTop: 4,
              }}
            >
              Type the alias in any pane and Vimeflow swaps it for the full
              agent invocation.
            </div>
          </div>
          <span style={{ flex: 1 }} />
          <GhostButton onClick={addAlias}>
            <Icon
              name="add"
              size={12}
              style={{ marginRight: 4, verticalAlign: 'middle' }}
            />
            Add alias
          </GhostButton>
        </div>

        {/* Header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '80px 120px 140px 1fr 30px',
            gap: 8,
            padding: '0 12px 8px',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10,
            color: '#8a8299',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          <span>Alias</span>
          <span>Agent</span>
          <span>Model</span>
          <span>Extra flags</span>
          <span></span>
        </div>

        <div
          style={{
            background: 'rgba(13,13,28,0.5)',
            border: '1px solid rgba(74,68,79,0.3)',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          {aliases.map((a, i) => (
            <div
              key={a.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '80px 120px 140px 1fr 30px',
                gap: 8,
                alignItems: 'center',
                padding: '10px 12px',
                borderBottom:
                  i === aliases.length - 1
                    ? 'none'
                    : '1px solid rgba(74,68,79,0.15)',
                opacity: shimOn ? 1 : 0.45,
              }}
            >
              <TextInput
                width="100%"
                mono
                placeholder="cc"
                value={a.alias}
                onChange={(v) => update(a.id, 'alias', v)}
              />
              <Select
                width="100%"
                value={a.agent}
                onChange={(v) => update(a.id, 'agent', v)}
                options={[
                  { id: 'claude', label: 'Claude Code' },
                  { id: 'codex', label: 'Codex CLI' },
                  { id: 'gemini', label: 'Gemini CLI' },
                  { id: 'shell', label: 'Shell only' },
                ]}
              />
              <Select
                width="100%"
                value={a.model}
                onChange={(v) => update(a.id, 'model', v)}
                options={[
                  { id: 'sonnet-4', label: 'sonnet-4' },
                  { id: 'opus-4', label: 'opus-4' },
                  { id: 'gpt-5-codex', label: 'gpt-5-codex' },
                  { id: 'gemini-2.5', label: 'gemini-2.5' },
                ]}
              />
              <TextInput
                width="100%"
                mono
                placeholder="--continue"
                value={a.extra}
                onChange={(v) => update(a.id, 'extra', v)}
              />
              <button
                onClick={() => remove(a.id)}
                title="Remove alias"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 4,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#6c7086',
                  display: 'grid',
                  placeItems: 'center',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#ff94a5'
                  e.currentTarget.style.background = 'rgba(255,148,165,0.08)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = '#6c7086'
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <Icon name="delete" size={13} />
              </button>
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: 10,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 10.5,
            color: '#6c7086',
          }}
        >
          Try it: in any pane, type{' '}
          <span style={{ color: '#cba6f7' }}>cc "fix the auth bug"</span> —
          Vimeflow expands it to the full agent invocation before sending to the
          PTY.
        </div>
      </div>

      <div
        style={{
          marginTop: 26,
          padding: '14px 16px',
          background: 'rgba(168,200,255,0.06)',
          border: '1px solid rgba(168,200,255,0.22)',
          borderRadius: 8,
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
        }}
      >
        <Icon
          name="info"
          size={14}
          style={{ color: '#a8c8ff', marginTop: 2 }}
        />
        <div
          style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 12.5,
            color: '#cdc3d1',
            lineHeight: 1.55,
          }}
        >
          <strong style={{ color: '#a8c8ff', fontWeight: 600 }}>
            How this works.
          </strong>{' '}
          Aliases are scoped to Vimeflow's PTY layer. They live in{' '}
          <code style={inlineCode}>~/.config/vimeflow/aliases.toml</code> and
          are injected into each pane's process environment via a tiny shim.
          Your real shell rc files stay untouched, so the aliases don't leak
          into other terminals.
        </div>
      </div>
    </>
  )
}

const inlineCode = {
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 11.5,
  background: 'rgba(13,13,28,0.6)',
  padding: '1px 5px',
  borderRadius: 3,
  color: '#e2c7ff',
}

// ---------- Pane: Placeholder ---------------------------------------------

function PlaceholderPane({ section }) {
  return (
    <>
      <PaneTitle title={section.label} sub="Coming soon" />
      <div
        style={{
          padding: 40,
          textAlign: 'center',
          border: '1px dashed rgba(74,68,79,0.4)',
          borderRadius: 10,
          marginTop: 12,
        }}
      >
        <Icon
          name={section.icon}
          size={32}
          style={{ color: 'rgba(203,166,247,0.4)', marginBottom: 12 }}
        />
        <div
          style={{
            fontFamily: "'Instrument Sans', system-ui",
            fontSize: 14,
            color: '#e3e0f7',
            marginBottom: 6,
          }}
        >
          {section.label} settings haven't been wired yet.
        </div>
        <div
          style={{
            fontFamily: "'Inter', sans-serif",
            fontSize: 12,
            color: '#8a8299',
          }}
        >
          This pane will host the {section.label.toLowerCase()} configuration in
          a future build.
        </div>
      </div>
    </>
  )
}

Object.assign(window, {
  SettingsDialog,
  SettingsSidebar,
  SettingsHeader,
  Row,
  Toggle,
  Select,
  GhostButton,
  TextInput,
  GeneralPane,
  AppearancePane,
  KeymapPane,
  AgentsPane,
  PlaceholderPane,
})

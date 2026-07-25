import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { Dropdown } from 'vibm'

// Dark Lens surface for the white preview card (inline token vars — see NOTES).
const surface = {
  background: 'var(--color-surface)',
  color: 'var(--color-on-surface)',
  fontFamily: 'var(--font-body)',
  padding: 24,
  borderRadius: 12,
  display: 'flex',
  flexWrap: 'wrap' as const,
  alignItems: 'flex-start',
  gap: 24,
}

const noop = (): void => undefined

// Dropdown owns its open state (trigger click toggles it); the preview clicks
// the trigger programmatically after mount so the capture sees the open list.
const ClickOnMount = ({ children }: { children: ReactNode }): ReactElement => {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const timer = setTimeout(() => {
      ref.current?.querySelector<HTMLElement>('button')?.click()
    }, 80)
    return () => clearTimeout(timer)
  }, [])
  return (
    <div ref={ref} style={{ display: 'inline-flex' }}>
      {children}
    </div>
  )
}

const themeOptions = [
  { value: 'catppuccin', label: 'Catppuccin', description: 'Dark · default' },
  { value: 'flexoki', label: 'Flexoki', description: 'Light baseline' },
  { value: 'gruvbox-dark', label: 'Gruvbox Dark' },
  { value: 'tokyo-night', label: 'Tokyo Night' },
  { value: 'dracula', label: 'Dracula' },
]

export const ThemeSelectOpen = (): ReactElement => (
  <div style={{ ...surface, minHeight: 330 }}>
    <ClickOnMount>
      <Dropdown
        label="Theme"
        leadingIcon="palette"
        value="catppuccin"
        options={themeOptions}
        onChange={noop}
        width={230}
      />
    </ClickOnMount>
  </div>
)

const branchOptions = [
  { value: 'main', label: 'main', description: 'origin/main · up to date' },
  {
    value: 'feat/vim-362-kimi-resume',
    label: 'feat/vim-362-kimi-resume',
    description: 'ahead 2',
  },
  {
    value: 'fix/vim-359-diff-scroll',
    label: 'fix/vim-359-diff-scroll',
    description: 'merged',
  },
  { value: 'umbrella/ghostty-panes', label: 'umbrella/ghostty-panes' },
]

export const BranchPickerCustomTrigger = (): ReactElement => (
  <div style={{ ...surface, minHeight: 330 }}>
    <ClickOnMount>
      <Dropdown
        value="feat/vim-362-kimi-resume"
        options={branchOptions}
        onChange={noop}
        width={280}
        placement="bottom-start"
        renderTrigger={({ ref, props, open, current }): ReactElement => (
          <button
            type="button"
            ref={ref}
            {...props}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 10px',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
              background: 'var(--color-surface-container-high)',
              color: 'var(--color-on-surface)',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 15, color: 'var(--color-primary)' }}
              aria-hidden
            >
              alt_route
            </span>
            {current?.label}
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 15, opacity: 0.7 }}
              aria-hidden
            >
              {open ? 'expand_less' : 'expand_more'}
            </span>
          </button>
        )}
      />
    </ClickOnMount>
  </div>
)

export const ToolbarSelectsResting = (): ReactElement => (
  <div style={{ ...surface, alignItems: 'center', minHeight: 120 }}>
    <Dropdown
      label="Agent"
      leadingIcon="smart_toy"
      value="kimi"
      options={[
        { value: 'claude', label: 'Claude Code' },
        { value: 'kimi', label: 'Kimi Code' },
        { value: 'codex', label: 'Codex CLI' },
        { value: 'opencode', label: 'OpenCode' },
      ]}
      onChange={noop}
      width={200}
    />
    <Dropdown
      label="Layout"
      leadingIcon="grid_view"
      value="two-column"
      options={[
        { value: 'single', label: 'Single pane' },
        { value: 'two-column', label: 'Two column' },
        { value: 'main-stack', label: 'Main + stack' },
      ]}
      onChange={noop}
      width={200}
    />
  </div>
)

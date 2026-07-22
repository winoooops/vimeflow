import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { IconButton, Menu, ToolbarButton } from 'vibm'

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
  gap: 16,
}

const noop = (): void => undefined

// Menu owns its open state (trigger click toggles it); the preview clicks the
// trigger programmatically after mount so the capture sees the open panel.
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

export const SessionActions = (): ReactElement => (
  <div style={{ ...surface, minHeight: 380 }}>
    <ClickOnMount>
      <Menu
        aria-label="Session actions"
        placement="bottom-start"
        trigger={
          <IconButton
            icon="more_horiz"
            label="Session actions"
            showTooltip={false}
          />
        }
      >
        <Menu.Section label="Session">
          <Menu.Item icon="edit" shortcut={['Mod', 'R']} onSelect={noop}>
            Rename session
          </Menu.Item>
          <Menu.Item icon="content_copy" onSelect={noop}>
            Duplicate layout
          </Menu.Item>
          <Menu.Item icon="ios_share" disabled onSelect={noop}>
            Export transcript
          </Menu.Item>
        </Menu.Section>
        <Menu.Section label="Agent">
          <Menu.Item
            icon="restart_alt"
            shortcut={['Mod', 'Shift', 'R']}
            onSelect={noop}
          >
            Restart kimi
          </Menu.Item>
          <Menu.Item icon="stop_circle" onSelect={noop}>
            Stop agent
          </Menu.Item>
        </Menu.Section>
      </Menu>
    </ClickOnMount>
  </div>
)

export const ViewOptions = (): ReactElement => (
  <div style={{ ...surface, minHeight: 340 }}>
    <ClickOnMount>
      <Menu
        aria-label="View options"
        placement="bottom-start"
        trigger={
          <ToolbarButton label="View" icon="tune" trailingIcon="expand_more" />
        }
      >
        <Menu.Section label="Panels">
          <Menu.Checkbox checked icon="folder" onChange={noop}>
            File explorer
          </Menu.Checkbox>
          <Menu.Checkbox checked={false} icon="difference" onChange={noop}>
            Diff panel
          </Menu.Checkbox>
          <Menu.Checkbox checked icon="terminal" onChange={noop}>
            Terminal dock
          </Menu.Checkbox>
        </Menu.Section>
        <Menu.Section label="Layout">
          <Menu.Submenu
            label="Split layout"
            icon="grid_view"
            value="two-column"
            options={[
              { value: 'single', label: 'Single pane' },
              { value: 'two-column', label: 'Two column' },
              { value: 'main-stack', label: 'Main + stack' },
              { value: 'grid', label: '2×2 grid' },
            ]}
            onChange={noop}
          />
        </Menu.Section>
      </Menu>
    </ClickOnMount>
  </div>
)

export const TerminalContextMenu = (): ReactElement => (
  <div style={{ ...surface, minHeight: 360, position: 'relative' }}>
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        color: 'var(--color-on-surface-variant)',
      }}
    >
      ~/projects/vimeflow · kimi pane (right-click)
    </span>
    <Menu.Context
      position={{ x: 140, y: 130 }}
      open
      onOpenChange={noop}
      aria-label="Terminal context menu"
    >
      <Menu.Item icon="content_copy" shortcut={['Mod', 'C']} onSelect={noop}>
        Copy
      </Menu.Item>
      <Menu.Item icon="content_paste" shortcut={['Mod', 'V']} onSelect={noop}>
        Paste
      </Menu.Item>
      <Menu.Item icon="select_all" onSelect={noop}>
        Select all
      </Menu.Item>
      <Menu.Item icon="mop" onSelect={noop}>
        Clear scrollback
      </Menu.Item>
      <Menu.Item icon="splitscreen" disabled onSelect={noop}>
        Split pane
      </Menu.Item>
    </Menu.Context>
  </div>
)

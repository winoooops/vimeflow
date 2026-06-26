import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SidebarTabs, type SidebarTabItem } from './SidebarTabs'

type Tab = 'sessions' | 'files'

const TABS: readonly SidebarTabItem<Tab>[] = [
  { id: 'sessions', label: 'SESSIONS', icon: 'view_agenda' },
  { id: 'files', label: 'FILES', icon: 'folder_open' },
]

describe('SidebarTabs', () => {
  test('renders one toggle button per tab, in order', () => {
    render(
      <SidebarTabs<Tab> tabs={TABS} activeId="sessions" onChange={vi.fn()} />
    )

    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]).toHaveTextContent('SESSIONS')
    expect(buttons[1]).toHaveTextContent('FILES')
  })

  test('active button has aria-pressed=true; inactive has aria-pressed=false', () => {
    render(
      <SidebarTabs<Tab> tabs={TABS} activeId="sessions" onChange={vi.fn()} />
    )

    expect(screen.getByRole('button', { name: 'SESSIONS' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    expect(screen.getByRole('button', { name: 'FILES' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  test('uses roving tabIndex with the active button as the entry point', () => {
    render(
      <SidebarTabs<Tab> tabs={TABS} activeId="sessions" onChange={vi.fn()} />
    )

    expect(screen.getByRole('button', { name: 'SESSIONS' })).toHaveAttribute(
      'tabindex',
      '0'
    )

    expect(screen.getByRole('button', { name: 'FILES' })).toHaveAttribute(
      'tabindex',
      '-1'
    )
  })

  test('ArrowRight moves focus and calls onChange with the next id', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(
      <SidebarTabs<Tab> tabs={TABS} activeId="sessions" onChange={onChange} />
    )

    screen.getByRole('button', { name: 'SESSIONS' }).focus()
    await user.keyboard('{ArrowRight}')

    expect(onChange).toHaveBeenCalledWith('files')
    expect(screen.getByRole('button', { name: 'FILES' })).toHaveFocus()
  })

  test('clicking a non-active button calls onChange with that id', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(
      <SidebarTabs<Tab> tabs={TABS} activeId="sessions" onChange={onChange} />
    )
    await user.click(screen.getByRole('button', { name: 'FILES' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('files')
  })

  test('Enter on a focused button fires onChange', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(
      <SidebarTabs<Tab> tabs={TABS} activeId="sessions" onChange={onChange} />
    )
    const filesButton = screen.getByRole('button', { name: 'FILES' })
    filesButton.focus()
    await user.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledWith('files')
  })

  test('Space on a focused button fires onChange', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(
      <SidebarTabs<Tab> tabs={TABS} activeId="sessions" onChange={onChange} />
    )
    const filesButton = screen.getByRole('button', { name: 'FILES' })
    filesButton.focus()
    await user.keyboard(' ')

    expect(onChange).toHaveBeenCalledWith('files')
  })

  test('clicking the already-active button still fires onChange', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()

    render(
      <SidebarTabs<Tab> tabs={TABS} activeId="sessions" onChange={onChange} />
    )
    await user.click(screen.getByRole('button', { name: 'SESSIONS' }))

    expect(onChange).toHaveBeenCalledWith('sessions')
  })

  test('container has role="group" and default aria-label', () => {
    render(
      <SidebarTabs<Tab> tabs={TABS} activeId="sessions" onChange={vi.fn()} />
    )

    expect(screen.getByRole('group')).toHaveAttribute(
      'aria-label',
      'Sidebar tabs'
    )
  })

  test('shows a tooltip with the keyboard shortcut when an item provides one', async () => {
    const user = userEvent.setup()

    const tabsWithTips: readonly SidebarTabItem<Tab>[] = [
      {
        id: 'sessions',
        label: 'SESSIONS',
        icon: 'view_agenda',
        tooltip: 'Sessions',
        shortcut: ['Mod', 'Shift', 'S'],
      },
      {
        id: 'files',
        label: 'FILES',
        icon: 'folder_open',
        tooltip: 'Files',
        shortcut: ['Mod', 'Shift', 'F'],
      },
    ]

    render(
      <SidebarTabs<Tab>
        tabs={tabsWithTips}
        activeId="sessions"
        onChange={vi.fn()}
      />
    )

    // Buttons still render as two direct, individually-labelled controls.
    expect(screen.getAllByRole('button')).toHaveLength(2)

    await user.hover(screen.getByRole('button', { name: 'FILES' }))

    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('Files')
  })

  test('uses the default sidebar width instead of flexing with the sidebar', () => {
    render(
      <SidebarTabs<Tab> tabs={TABS} activeId="sessions" onChange={vi.fn()} />
    )

    const tabs = screen.getByTestId('sidebar-tabs')
    expect(tabs).toHaveStyle({ width: '202px' })
    expect(tabs).toHaveClass('shrink-0')
    expect(tabs).not.toHaveClass('flex-1')
  })

  test('aria-label can be overridden', () => {
    render(
      <SidebarTabs<Tab>
        tabs={TABS}
        activeId="sessions"
        onChange={vi.fn()}
        aria-label="Project navigation"
      />
    )

    expect(screen.getByRole('group')).toHaveAttribute(
      'aria-label',
      'Project navigation'
    )
  })

  test('renders each tab icon as an aria-hidden material symbol', () => {
    render(
      <SidebarTabs<Tab> tabs={TABS} activeId="sessions" onChange={vi.fn()} />
    )

    for (const [name, glyph] of [
      ['SESSIONS', 'view_agenda'],
      ['FILES', 'folder_open'],
    ] as const) {
      const button = screen.getByRole('button', { name })
      // eslint-disable-next-line testing-library/no-node-access -- verify decorative icon glyph
      const icon = button.querySelector('.material-symbols-outlined')
      expect(icon).toHaveTextContent(glyph)
      expect(icon).toHaveAttribute('aria-hidden', 'true')
    }
  })

  test('no longer renders the legacy underline accent bar', () => {
    render(
      <SidebarTabs<Tab> tabs={TABS} activeId="sessions" onChange={vi.fn()} />
    )

    expect(screen.queryAllByTestId('sidebar-tabs-accent')).toHaveLength(0)
  })

  test('renders a single decorative active thumb', () => {
    render(
      <SidebarTabs<Tab> tabs={TABS} activeId="sessions" onChange={vi.fn()} />
    )

    const thumbs = screen.getAllByTestId('sidebar-tabs-thumb')
    expect(thumbs).toHaveLength(1)
    expect(thumbs[0]).toHaveAttribute('aria-hidden', 'true')
  })

  test('default data-testid is sidebar-tabs; can be overridden', () => {
    const { rerender } = render(
      <SidebarTabs<Tab> tabs={TABS} activeId="sessions" onChange={vi.fn()} />
    )

    expect(screen.getByTestId('sidebar-tabs')).toBeInTheDocument()

    rerender(
      <SidebarTabs<Tab>
        tabs={TABS}
        activeId="sessions"
        onChange={vi.fn()}
        data-testid="my-tabs"
      />
    )

    expect(screen.getByTestId('my-tabs')).toBeInTheDocument()
  })
})

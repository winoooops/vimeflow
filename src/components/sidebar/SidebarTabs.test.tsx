import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SidebarTabs, type SidebarTabItem } from './SidebarTabs'

type Tab = 'sessions' | 'files'

const TABS: readonly SidebarTabItem<Tab>[] = [
  { id: 'sessions', label: 'SESSIONS' },
  { id: 'files', label: 'FILES' },
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

  test('every button has the default tabIndex', () => {
    render(
      <SidebarTabs<Tab> tabs={TABS} activeId="sessions" onChange={vi.fn()} />
    )

    for (const button of screen.getAllByRole('button')) {
      expect(button).not.toHaveAttribute('tabindex', '-1')
    }
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

  test('active button shows the accent bar; inactive does not', () => {
    render(
      <SidebarTabs<Tab> tabs={TABS} activeId="sessions" onChange={vi.fn()} />
    )

    const accents = screen.getAllByTestId('sidebar-tabs-accent')
    expect(accents).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'SESSIONS' })).toContainElement(
      accents[0]
    )
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

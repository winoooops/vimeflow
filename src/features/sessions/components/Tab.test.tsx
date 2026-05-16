import { describe, test, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tab } from './Tab'
import type { Session } from '../types'
import { AGENTS } from '../../../agents/registry'

const session = (id: string, status: Session['status'] = 'running'): Session =>
  ({
    id,
    projectId: 'p',
    name: id,
    status,
    agentType: 'claude-code',
  }) as Session

const renderTab = (
  overrides: Partial<React.ComponentProps<typeof Tab>> = {}
): ReturnType<typeof render> =>
  render(
    <Tab
      session={session('a')}
      agent={AGENTS.claude}
      onSelect={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />
  )

describe('Tab — ARIA', () => {
  test('role=tab + aria-controls + id', () => {
    renderTab({ session: session('X') })
    const tab = screen.getByRole('tab')
    expect(tab).toHaveAttribute('id', 'session-tab-X')
    expect(tab).toHaveAttribute('aria-controls', 'session-panel-X')
  })

  test('aria-label = session.name when running/paused', () => {
    renderTab({ session: session('A', 'running') })
    expect(screen.getByRole('tab')).toHaveAttribute('aria-label', 'A')
  })

  test('aria-label appended with " (ended)" when completed', () => {
    renderTab({ session: session('A', 'completed') })
    expect(screen.getByRole('tab')).toHaveAttribute('aria-label', 'A (ended)')
  })

  test('aria-label appended with " (ended)" when errored', () => {
    renderTab({ session: session('A', 'errored') })
    expect(screen.getByRole('tab')).toHaveAttribute('aria-label', 'A (ended)')
  })

  test('aria-selected reflects isActive', () => {
    const { rerender } = renderTab({ isActive: true })

    expect(screen.getByRole('tab')).toHaveAttribute('aria-selected', 'true')

    rerender(
      <Tab
        session={session('a')}
        agent={AGENTS.claude}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByRole('tab')).toHaveAttribute('aria-selected', 'false')
  })

  test('tabIndex = 0 when isFocusEntryPoint, -1 otherwise', () => {
    const { rerender } = renderTab({ isFocusEntryPoint: true })

    expect(screen.getByRole('tab')).toHaveAttribute('tabindex', '0')

    rerender(
      <Tab
        session={session('a')}
        agent={AGENTS.claude}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.getByRole('tab')).toHaveAttribute('tabindex', '-1')
  })

  test('close button is always tabIndex=-1', () => {
    renderTab()
    const close = screen.getByRole('button', { name: 'Close a' })
    expect(close).toHaveAttribute('tabindex', '-1')
    expect(close).toHaveAttribute('aria-label', 'Close a')
  })
})

describe('Tab — keyboard', () => {
  test('Enter on inactive focused tab calls onSelect', async () => {
    const onSelect = vi.fn()
    renderTab({ session: session('X'), onSelect })
    const tab = screen.getByRole('tab')
    tab.focus()
    await userEvent.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith('X')
  })

  test('Space on inactive focused tab calls onSelect', async () => {
    const onSelect = vi.fn()
    renderTab({ session: session('X'), onSelect })
    screen.getByRole('tab').focus()
    await userEvent.keyboard(' ')
    expect(onSelect).toHaveBeenCalledWith('X')
  })

  test('Enter on already-active tab does NOT call onSelect (active-no-op guard)', async () => {
    const onSelect = vi.fn()
    renderTab({ isActive: true, onSelect })
    screen.getByRole('tab').focus()
    await userEvent.keyboard('{Enter}')
    expect(onSelect).not.toHaveBeenCalled()
  })

  test('Delete on focused tab calls onClose', async () => {
    const onClose = vi.fn()
    renderTab({ session: session('X'), onClose })
    screen.getByRole('tab').focus()
    await userEvent.keyboard('{Delete}')
    expect(onClose).toHaveBeenCalledWith('X')
  })

  test('Backspace on focused tab calls onClose', async () => {
    const onClose = vi.fn()
    renderTab({ session: session('X'), onClose })
    screen.getByRole('tab').focus()
    await userEvent.keyboard('{Backspace}')
    expect(onClose).toHaveBeenCalledWith('X')
  })

  test('keys bubbled from descendants are ignored', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    renderTab({ onSelect, onClose })
    const close = screen.getByTestId('close-tab-button')
    close.focus()
    await userEvent.keyboard('{Enter}')
    // The onClose IS called via the close button's own click (bubble),
    // but onSelect is not.
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('Tab — click', () => {
  test('clicking inactive tab calls onSelect', async () => {
    const onSelect = vi.fn()
    renderTab({ session: session('X'), onSelect })
    await userEvent.click(screen.getByRole('tab'))
    expect(onSelect).toHaveBeenCalledWith('X')
  })

  test('clicking already-active tab does NOT call onSelect', async () => {
    const onSelect = vi.fn()
    renderTab({ isActive: true, onSelect })
    await userEvent.click(screen.getByRole('tab'))
    expect(onSelect).not.toHaveBeenCalled()
  })

  test('close button calls onClose with stopPropagation (does not also fire onSelect)', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    renderTab({ session: session('X'), onSelect, onClose })
    // The close button has pointer-events-none by default (it's only
    // interactive on hover/focus-within). userEvent.click respects
    // pointer-events; fireEvent.click bypasses it and dispatches the
    // DOM click event directly — sufficient to assert the handler wires
    // correctly. The actual hover+click path is verified visually in
    // electron:dev.
    fireEvent.click(screen.getByTestId('close-tab-button'))
    expect(onClose).toHaveBeenCalledWith('X')
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('Tab — visual', () => {
  test('renders agent glyph from the registry', () => {
    renderTab({ agent: AGENTS.claude })
    expect(screen.getByText(AGENTS.claude.glyph)).toBeInTheDocument()
  })

  test('active tab uses bg-surface (no agent-color gradient — handoff §4.3)', () => {
    renderTab({ isActive: true, agent: AGENTS.codex })
    const tab = screen.getByRole('tab')
    // The active state uses plain `bg-surface` — agent identity comes
    // through via the chip + the 2px top stripe, NOT a gradient bg
    // washing the whole tab in agent color.
    expect(tab.className).toContain('bg-surface')
    expect(tab.style.background).toBe('')
  })

  test('active accent stripe rendered iff isActive', () => {
    const { container, rerender } = renderTab({
      isActive: true,
      agent: AGENTS.claude,
    })
    // The stripe is a decorative aria-hidden span with no semantic role.
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    expect(container.querySelector('span.rounded-b-sm')).toBeInTheDocument()

    rerender(
      <Tab
        session={session('a')}
        agent={AGENTS.claude}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    expect(container.querySelector('span.rounded-b-sm')).not.toBeInTheDocument()
  })

  test('StatusDot rendered ONLY for running/paused (not completed/errored)', () => {
    const { rerender } = renderTab({ session: session('a', 'running') })

    expect(screen.getByLabelText('Status running')).toBeInTheDocument()

    rerender(
      <Tab
        session={session('a', 'completed')}
        agent={AGENTS.claude}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.queryByLabelText(/^Status/)).not.toBeInTheDocument()
  })

  test('close button starts visually hidden on inactive tabs but keeps its accessible name', () => {
    renderTab({ isActive: false })
    const close = screen.getByTestId('close-tab-button')
    expect(close.className).toContain('opacity-0')
    expect(close.className).toContain('pointer-events-none')
    expect(close.getAttribute('aria-label')).toMatch(/Close /i)
  })

  test('close button starts hidden on active tabs too (revealed only on hover/focus)', () => {
    // Active tabs no longer always show the close button. Mouse users
    // see it on hover; keyboard users see it on group-focus-within when
    // they navigate to the tab itself; screen-reader users use
    // Delete/Backspace on the focused tab.
    renderTab({ isActive: true })
    const close = screen.getByTestId('close-tab-button')
    expect(close.className).toContain('opacity-0')
    expect(close.className).toContain('pointer-events-none')
    expect(close.getAttribute('aria-label')).toMatch(/Close /i)
  })

  test('hover + focus-within reveal class strings on close button (visual verification covers the actual hover)', () => {
    // jsdom does not drive :hover natively; verify the Tailwind selectors
    // are wired so a electron:dev visual check is the source of truth.
    renderTab({ isActive: false })
    const close = screen.getByTestId('close-tab-button')
    expect(close.className).toContain('group-hover:opacity-100')
    expect(close.className).toContain('group-hover:pointer-events-auto')
    expect(close.className).toContain('group-focus-within:opacity-100')
    expect(close.className).toContain('group-focus-within:pointer-events-auto')
  })

  test('title is rendered at 12.5px per handoff §4.3', () => {
    renderTab({ session: session('hello') })
    const title = screen.getByText('hello')
    expect(title.className).toContain('text-[12.5px]')
  })
})

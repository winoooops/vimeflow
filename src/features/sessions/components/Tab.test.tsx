import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tab } from './Tab'
import type { Session } from '../../workspace/types'
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
    const close = screen.getByRole('button', { name: /Close /i })
    expect(close).toHaveAttribute('tabindex', '-1')
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
    const close = screen.getByRole('button', { name: /Close /i })
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

  test('close button calls onClose with stopPropagation (does not also fire onSelect)', async () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    renderTab({ session: session('X'), onSelect, onClose })
    await userEvent.click(screen.getByRole('button', { name: /Close /i }))
    expect(onClose).toHaveBeenCalledWith('X')
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('Tab — visual', () => {
  test('renders agent glyph from the registry', () => {
    renderTab({ agent: AGENTS.claude })
    expect(screen.getByText(AGENTS.claude.glyph)).toBeInTheDocument()
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
})

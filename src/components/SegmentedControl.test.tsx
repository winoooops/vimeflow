import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { SegmentedControl } from './SegmentedControl'

const OPTIONS = [
  { value: 'split', label: 'Split' },
  { value: 'unified', label: 'Unified' },
] as const

describe('SegmentedControl', () => {
  test('renders options as pressed buttons inside a named group', () => {
    render(
      <SegmentedControl
        aria-label="Diff view"
        value="split"
        options={OPTIONS}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByRole('group', { name: 'Diff view' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Split' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    expect(screen.getByRole('button', { name: 'Unified' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
  })

  test('clicking an option fires onChange with that value', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(
      <SegmentedControl
        aria-label="Diff view"
        value="split"
        options={OPTIONS}
        onChange={handleChange}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Unified' }))

    expect(handleChange).toHaveBeenCalledWith('unified')
  })

  test('can suppress active reselect callbacks', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(
      <SegmentedControl
        aria-label="Diff view"
        value="split"
        options={OPTIONS}
        onChange={handleChange}
        skipActiveReselect
      />
    )

    await user.click(screen.getByRole('button', { name: 'Split' }))

    expect(handleChange).not.toHaveBeenCalled()
  })

  test('arrow keys move through options with roving focus', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(
      <SegmentedControl
        aria-label="Diff view"
        value="split"
        options={OPTIONS}
        onChange={handleChange}
      />
    )

    const split = screen.getByRole('button', { name: 'Split' })
    split.focus()

    await user.keyboard('{ArrowRight}')

    expect(handleChange).toHaveBeenCalledWith('unified')
    expect(screen.getByRole('button', { name: 'Unified' })).toHaveFocus()
  })

  test('toolbar icon uses absolute font size when no iconClassName is supplied', () => {
    render(
      <SegmentedControl
        aria-label="Toolbar"
        variant="toolbar"
        value="split"
        options={[
          { value: 'split', label: 'Split', icon: 'terminal' },
          { value: 'unified', label: 'Unified', icon: 'folder' },
        ]}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByText('terminal')).toHaveClass('text-[16px]')
  })

  test('skipActiveReselect suppresses keyboard navigation callbacks for the active option', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(
      <SegmentedControl
        aria-label="Diff view"
        value="split"
        options={OPTIONS}
        onChange={handleChange}
        skipActiveReselect
      />
    )

    const split = screen.getByRole('button', { name: 'Split' })
    split.focus()

    await user.keyboard('{Home}')

    expect(handleChange).not.toHaveBeenCalled()
  })

  test('sidebar variant renders the active thumb', () => {
    render(
      <SegmentedControl
        aria-label="Sidebar tabs"
        data-testid="sidebar-tabs"
        thumbTestId="sidebar-tabs-thumb"
        variant="sidebar"
        value="sessions"
        options={[
          { value: 'sessions', label: 'Sessions', icon: 'terminal' },
          { value: 'files', label: 'Files', icon: 'folder' },
        ]}
        onChange={vi.fn()}
        fillActiveIcon
      />
    )

    const group = screen.getByTestId('sidebar-tabs')
    expect(within(group).getByTestId('sidebar-tabs-thumb')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sessions' })).toHaveClass(
      'text-primary'
    )
  })

  test('a disabled option does not fire onChange when clicked and is aria-disabled', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(
      <SegmentedControl
        aria-label="Diff view"
        value="split"
        options={[
          { value: 'split', label: 'Split' },
          { value: 'unified', label: 'Unified', disabled: true },
        ]}
        onChange={handleChange}
      />
    )

    const unified = screen.getByRole('button', { name: 'Unified' })
    expect(unified).toHaveAttribute('aria-disabled', 'true')
    expect(unified).toHaveAttribute('data-disabled', 'true')

    await user.click(unified)

    expect(handleChange).not.toHaveBeenCalled()
  })

  test('a disabled option still renders its tooltip trigger so the hint is reachable', async () => {
    const user = userEvent.setup()
    render(
      <SegmentedControl
        aria-label="Diff view"
        value="split"
        options={[
          { value: 'split', label: 'Split' },
          {
            value: 'unified',
            label: 'Unified',
            disabled: true,
            tooltip: 'Reduce panes to switch to Unified',
          },
        ]}
        onChange={vi.fn()}
      />
    )

    await user.hover(screen.getByRole('button', { name: 'Unified' }))

    expect(
      await screen.findByRole('tooltip', {
        name: 'Reduce panes to switch to Unified',
      })
    ).toBeInTheDocument()
  })

  test('arrow-key navigation skips a disabled option', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(
      <SegmentedControl
        aria-label="Diff view"
        value="split"
        options={[
          { value: 'split', label: 'Split' },
          { value: 'unified', label: 'Unified', disabled: true },
          { value: 'inline', label: 'Inline' },
        ]}
        onChange={handleChange}
      />
    )

    const split = screen.getByRole('button', { name: 'Split' })
    split.focus()

    await user.keyboard('{ArrowRight}')

    // The disabled middle option is skipped, landing on the next enabled one.
    expect(handleChange).toHaveBeenCalledWith('inline')
    expect(screen.getByRole('button', { name: 'Inline' })).toHaveFocus()
  })

  test('unmatched value does not render thumb and keeps first option tabbable', () => {
    render(
      <SegmentedControl
        aria-label="Sidebar tabs"
        data-testid="sidebar-tabs"
        thumbTestId="sidebar-tabs-thumb"
        variant="sidebar"
        value="missing"
        options={[
          { value: 'sessions', label: 'Sessions', icon: 'terminal' },
          { value: 'files', label: 'Files', icon: 'folder' },
        ]}
        onChange={vi.fn()}
      />
    )

    const group = screen.getByTestId('sidebar-tabs')
    expect(
      within(group).queryByTestId('sidebar-tabs-thumb')
    ).not.toBeInTheDocument()

    const sessions = screen.getByRole('button', { name: 'Sessions' })
    const files = screen.getByRole('button', { name: 'Files' })

    expect(sessions).toHaveAttribute('tabindex', '0')
    expect(files).toHaveAttribute('tabindex', '-1')
    expect(sessions).toHaveAttribute('aria-pressed', 'false')
    expect(files).toHaveAttribute('aria-pressed', 'false')
  })
})

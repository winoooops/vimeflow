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
})

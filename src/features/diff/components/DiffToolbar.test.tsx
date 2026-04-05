import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DiffToolbar from './DiffToolbar'
import type { DiffViewMode } from '../types'

describe('DiffToolbar', () => {
  const defaultProps = {
    viewMode: 'split' as DiffViewMode,
    currentHunkIndex: 0,
    totalHunks: 5,
    onViewModeChange: vi.fn(),
    onPreviousHunk: vi.fn(),
    onNextHunk: vi.fn(),
    onDiscard: vi.fn(),
    onStageHunk: vi.fn(),
  }

  test('renders view mode toggle with both options', () => {
    render(<DiffToolbar {...defaultProps} />)

    expect(
      screen.getByRole('button', { name: /side-by-side/i })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /unified/i })).toBeInTheDocument()
  })

  test('highlights active view mode', () => {
    const { rerender } = render(
      <DiffToolbar {...defaultProps} viewMode="split" />
    )

    const sideBySideButton = screen.getByRole('button', {
      name: /side-by-side/i,
    })
    const unifiedButton = screen.getByRole('button', { name: /unified/i })

    // Split mode active
    expect(sideBySideButton).toHaveClass('bg-surface-container-highest')
    expect(unifiedButton).not.toHaveClass('bg-surface-container-highest')

    // Switch to unified mode
    rerender(<DiffToolbar {...defaultProps} viewMode="unified" />)

    expect(sideBySideButton).not.toHaveClass('bg-surface-container-highest')
    expect(unifiedButton).toHaveClass('bg-surface-container-highest')
  })

  test('calls onViewModeChange when clicking view mode buttons', async () => {
    const user = userEvent.setup()
    const onViewModeChange = vi.fn()

    render(
      <DiffToolbar {...defaultProps} onViewModeChange={onViewModeChange} />
    )

    await user.click(screen.getByRole('button', { name: /unified/i }))
    expect(onViewModeChange).toHaveBeenCalledWith('unified')

    await user.click(screen.getByRole('button', { name: /side-by-side/i }))
    expect(onViewModeChange).toHaveBeenCalledWith('split')
  })

  test('renders hunk navigation arrows', () => {
    render(<DiffToolbar {...defaultProps} />)

    const prevButton = screen.getByRole('button', { name: /previous hunk/i })
    const nextButton = screen.getByRole('button', { name: /next hunk/i })

    expect(prevButton).toBeInTheDocument()
    expect(nextButton).toBeInTheDocument()
  })

  test('displays hunk counter with correct format', () => {
    const { rerender } = render(
      <DiffToolbar {...defaultProps} currentHunkIndex={0} totalHunks={5} />
    )

    expect(screen.getByText('1 of 5 changes')).toBeInTheDocument()

    rerender(
      <DiffToolbar {...defaultProps} currentHunkIndex={2} totalHunks={5} />
    )

    expect(screen.getByText('3 of 5 changes')).toBeInTheDocument()
  })

  test('calls onPreviousHunk when clicking up arrow', async () => {
    const user = userEvent.setup()
    const onPreviousHunk = vi.fn()

    render(<DiffToolbar {...defaultProps} onPreviousHunk={onPreviousHunk} />)

    await user.click(screen.getByRole('button', { name: /previous hunk/i }))
    expect(onPreviousHunk).toHaveBeenCalledTimes(1)
  })

  test('calls onNextHunk when clicking down arrow', async () => {
    const user = userEvent.setup()
    const onNextHunk = vi.fn()

    render(<DiffToolbar {...defaultProps} onNextHunk={onNextHunk} />)

    await user.click(screen.getByRole('button', { name: /next hunk/i }))
    expect(onNextHunk).toHaveBeenCalledTimes(1)
  })

  test('renders Discard button with outline styling', () => {
    render(<DiffToolbar {...defaultProps} />)

    const discardButton = screen.getByRole('button', { name: /discard/i })

    expect(discardButton).toBeInTheDocument()
    expect(discardButton).toHaveClass('border')
    expect(discardButton).toHaveClass('border-outline-variant')
  })

  test('renders Stage Hunk button with filled styling', () => {
    render(<DiffToolbar {...defaultProps} />)

    const stageButton = screen.getByRole('button', { name: /stage hunk/i })

    expect(stageButton).toBeInTheDocument()
    expect(stageButton).toHaveClass('bg-primary')
  })

  test('calls onDiscard when clicking Discard button', async () => {
    const user = userEvent.setup()
    const onDiscard = vi.fn()

    render(<DiffToolbar {...defaultProps} onDiscard={onDiscard} />)

    await user.click(screen.getByRole('button', { name: /discard/i }))
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  test('calls onStageHunk when clicking Stage Hunk button', async () => {
    const user = userEvent.setup()
    const onStageHunk = vi.fn()

    render(<DiffToolbar {...defaultProps} onStageHunk={onStageHunk} />)

    await user.click(screen.getByRole('button', { name: /stage hunk/i }))
    expect(onStageHunk).toHaveBeenCalledTimes(1)
  })

  test('applies glassmorphism styling to toolbar container', () => {
    const { container } = render(<DiffToolbar {...defaultProps} />)

    // eslint-disable-next-line testing-library/no-node-access
    const toolbar = container.firstChild as HTMLElement

    expect(toolbar).toHaveClass('bg-surface-container-low/50')
    expect(toolbar).toHaveClass('backdrop-blur-sm')
    expect(toolbar).toHaveClass('border')
    expect(toolbar).toHaveClass('border-outline-variant/10')
  })

  test('displays vertical divider between left and right sections', () => {
    const { container } = render(<DiffToolbar {...defaultProps} />)

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const dividers = container.querySelectorAll('.h-6.w-px')

    expect(dividers.length).toBeGreaterThan(0)
  })

  test('handles zero hunks gracefully', () => {
    render(
      <DiffToolbar {...defaultProps} currentHunkIndex={0} totalHunks={0} />
    )

    expect(screen.getByText('0 of 0 changes')).toBeInTheDocument()
  })
})

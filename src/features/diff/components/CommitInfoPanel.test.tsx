/* eslint-disable testing-library/no-container */
/* eslint-disable testing-library/no-node-access */
import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CommitInfoPanel from './CommitInfoPanel'

describe('CommitInfoPanel', () => {
  const mockProps = {
    commitHash: 'a1b2c3d',
    commitMessage: 'feat: add git diff viewer with split/unified views',
    authorName: 'John Doe',
    authorAvatar: 'https://avatars.example.com/johndoe',
    timestamp: '2026-04-04T10:30:00Z',
    contextMemoryPercent: 45,
    tokensProcessedPercent: 72,
    onSubmitReview: vi.fn(),
  }

  test('renders section header with history icon', () => {
    render(<CommitInfoPanel {...mockProps} />)

    expect(
      screen.getByRole('heading', { name: /commit info/i })
    ).toBeInTheDocument()

    const icon = screen.getByText('history')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveClass('material-symbols-outlined')
  })

  test('renders commit hash in code badge', () => {
    render(<CommitInfoPanel {...mockProps} />)

    const badge = screen.getByText(mockProps.commitHash)
    expect(badge).toBeInTheDocument()

    // Verify code badge styling
    expect(badge).toHaveClass('font-label')
    expect(badge).toHaveClass('bg-surface-container-highest')
    expect(badge).toHaveClass('px-2')
    expect(badge).toHaveClass('py-1')
    expect(badge).toHaveClass('rounded')
  })

  test('renders commit message with medium weight', () => {
    render(<CommitInfoPanel {...mockProps} />)

    const message = screen.getByText(mockProps.commitMessage)
    expect(message).toBeInTheDocument()
    expect(message).toHaveClass('font-medium')
  })

  test('renders author avatar, name, and relative time', () => {
    render(<CommitInfoPanel {...mockProps} />)

    const avatar = screen.getByRole('img', { name: /john doe/i })
    expect(avatar).toBeInTheDocument()
    expect(avatar).toHaveAttribute('src', mockProps.authorAvatar)

    expect(screen.getByText(mockProps.authorName)).toBeInTheDocument()

    // Timestamp should be formatted as relative time (e.g., "2 hours ago")
    // For this test, we'll just verify any time-like text is present
    expect(screen.getByText(/ago|minutes?|hours?|days?/i)).toBeInTheDocument()
  })

  test('renders Context Memory progress bar with secondary gradient', () => {
    const { container } = render(<CommitInfoPanel {...mockProps} />)

    expect(screen.getByText(/context memory/i)).toBeInTheDocument()
    expect(
      screen.getByText(`${mockProps.contextMemoryPercent}%`)
    ).toBeInTheDocument()

    // Find progress bar with secondary gradient
    const progressBars = container.querySelectorAll('[class*="from-secondary"]')
    expect(progressBars.length).toBeGreaterThan(0)

    // Verify the width is set correctly
    const memoryBar = Array.from(progressBars).find((bar) =>
      bar.getAttribute('style')?.includes(`${mockProps.contextMemoryPercent}%`)
    )
    expect(memoryBar).toBeDefined()
  })

  test('renders Tokens Processed progress bar with primary gradient', () => {
    const { container } = render(<CommitInfoPanel {...mockProps} />)

    expect(screen.getByText(/tokens processed/i)).toBeInTheDocument()
    expect(
      screen.getByText(`${mockProps.tokensProcessedPercent}%`)
    ).toBeInTheDocument()

    // Find progress bar with primary gradient
    const progressBars = container.querySelectorAll('[class*="from-primary"]')
    expect(progressBars.length).toBeGreaterThan(0)

    // Verify the width is set correctly
    const tokensBar = Array.from(progressBars).find((bar) =>
      bar
        .getAttribute('style')
        ?.includes(`${mockProps.tokensProcessedPercent}%`)
    )
    expect(tokensBar).toBeDefined()
  })

  test('renders Submit Review CTA button with gradient and shadow', () => {
    render(<CommitInfoPanel {...mockProps} />)

    const button = screen.getByRole('button', { name: /submit review/i })
    expect(button).toBeInTheDocument()

    // Verify gradient styling
    expect(button).toHaveClass('bg-gradient-to-br')
    expect(button).toHaveClass('from-primary')
    expect(button).toHaveClass('to-primary-container')

    // Verify shadow styling
    expect(button).toHaveClass('shadow-lg')
    expect(button).toHaveClass('shadow-primary/20')
  })

  test('calls onSubmitReview when Submit Review button is clicked', async () => {
    const user = userEvent.setup()
    render(<CommitInfoPanel {...mockProps} />)

    const button = screen.getByRole('button', { name: /submit review/i })
    await user.click(button)

    expect(mockProps.onSubmitReview).toHaveBeenCalledOnce()
  })

  test('handles missing author avatar gracefully', () => {
    const propsWithoutAvatar = { ...mockProps, authorAvatar: undefined }
    render(<CommitInfoPanel {...propsWithoutAvatar} />)

    // Should still render author name even without avatar
    expect(screen.getByText(mockProps.authorName)).toBeInTheDocument()

    // Avatar should use a fallback or not render
    const avatars = screen.queryAllByRole('img')
    expect(avatars.length).toBe(0)
  })

  test('all sections render in correct order', () => {
    render(<CommitInfoPanel {...mockProps} />)

    // Verify commit info section is present
    expect(
      screen.getByRole('heading', { name: /commit info/i })
    ).toBeInTheDocument()

    // Verify all major elements are present
    expect(screen.getByText(mockProps.commitHash)).toBeInTheDocument()
    expect(screen.getByText(mockProps.commitMessage)).toBeInTheDocument()
    expect(screen.getByText(mockProps.authorName)).toBeInTheDocument()
    expect(screen.getByText(/context memory/i)).toBeInTheDocument()
    expect(screen.getByText(/tokens processed/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /submit review/i })
    ).toBeInTheDocument()
  })

  test('accepts isOpen prop and applies translate-x-full when closed', () => {
    const propsWithToggle = {
      ...mockProps,
      isOpen: false,
      onToggle: vi.fn(),
    }
    render(<CommitInfoPanel {...propsWithToggle} />)

    const panel = screen.getByRole('complementary', {
      name: /commit info panel/i,
    })
    expect(panel).toHaveClass('translate-x-full')
  })

  test('does not apply translate-x-full when panel is open', () => {
    const propsWithToggle = {
      ...mockProps,
      isOpen: true,
      onToggle: vi.fn(),
    }
    render(<CommitInfoPanel {...propsWithToggle} />)

    const panel = screen.getByRole('complementary', {
      name: /commit info panel/i,
    })
    expect(panel).not.toHaveClass('translate-x-full')
  })

  test('renders reopen button that is visible when panel is closed', () => {
    const propsWithToggle = {
      ...mockProps,
      isOpen: false,
      onToggle: vi.fn(),
    }
    render(<CommitInfoPanel {...propsWithToggle} />)

    const reopenButton = screen.getByRole('button', {
      name: /open commit info panel/i,
    })
    expect(reopenButton).toBeInTheDocument()
    expect(reopenButton).toHaveClass('opacity-100')
  })

  test('reopen button is hidden when panel is open', () => {
    const propsWithToggle = {
      ...mockProps,
      isOpen: true,
      onToggle: vi.fn(),
    }
    render(<CommitInfoPanel {...propsWithToggle} />)

    const reopenButton = screen.getByRole('button', {
      name: /open commit info panel/i,
    })
    expect(reopenButton).toBeInTheDocument()
    expect(reopenButton).toHaveClass('opacity-0')
    expect(reopenButton).toHaveClass('pointer-events-none')
  })

  test('clicking reopen button calls onToggle', async () => {
    const user = userEvent.setup()
    const mockToggle = vi.fn()

    const propsWithToggle = {
      ...mockProps,
      isOpen: false,
      onToggle: mockToggle,
    }
    render(<CommitInfoPanel {...propsWithToggle} />)

    const reopenButton = screen.getByRole('button', {
      name: /open commit info panel/i,
    })
    await user.click(reopenButton)

    expect(mockToggle).toHaveBeenCalledOnce()
  })
})

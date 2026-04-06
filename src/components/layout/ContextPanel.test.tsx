import { render, screen, within } from '@testing-library/react'
import { describe, test, expect, vi } from 'vitest'
import ContextPanel from './ContextPanel'

describe('ContextPanel', () => {
  test('renders fixed right sidebar as complementary region', () => {
    render(<ContextPanel />)
    const aside = screen.getByRole('complementary')

    expect(aside).toBeInTheDocument()
    expect(aside).toHaveClass('w-[280px]', 'h-screen', 'fixed', 'right-0')
  })

  test('renders with correct background and border styling', () => {
    render(<ContextPanel />)
    const aside = screen.getByRole('complementary')

    expect(aside).toHaveClass('bg-[#1a1a2a]')
    expect(aside).toHaveClass('border-l', 'border-[#4a444f]/15')
  })

  test('renders with correct z-index for stacking', () => {
    render(<ContextPanel />)
    const aside = screen.getByRole('complementary')

    expect(aside).toHaveClass('z-40')
  })

  test('renders "AGENT STATUS" header with correct styling', () => {
    render(<ContextPanel />)
    const header = screen.getByRole('heading', { name: /agent status/i })
    expect(header).toBeInTheDocument()
    expect(header).toHaveClass(
      'font-headline',
      'text-xs',
      'font-bold',
      'tracking-widest',
      'uppercase'
    )
  })

  test('renders model info card with model name', () => {
    render(<ContextPanel />)
    expect(screen.getByText(/claude 3\.5 sonnet/i)).toBeInTheDocument()
  })

  test('renders token usage progress bar with percentage', () => {
    render(<ContextPanel />)
    expect(screen.getByText(/token usage/i)).toBeInTheDocument()
    expect(screen.getByText(/67%/)).toBeInTheDocument()
  })

  test('renders latency stat', () => {
    render(<ContextPanel />)
    const stats = screen.getByLabelText('Model statistics')

    expect(within(stats).getByText('Latency')).toBeInTheDocument()
    expect(within(stats).getByText(/142ms/)).toBeInTheDocument()
  })

  test('renders tokens stat', () => {
    render(<ContextPanel />)
    const stats = screen.getByLabelText('Model statistics')

    expect(within(stats).getByText('Tokens')).toBeInTheDocument()
    expect(within(stats).getByText(/12,847/)).toBeInTheDocument()
  })

  test('renders "Recent Actions" section with heading', () => {
    render(<ContextPanel />)
    const heading = screen.getByRole('heading', { name: /recent actions/i })

    expect(heading).toBeInTheDocument()
    expect(heading).toHaveClass('uppercase')
  })

  test('renders recent action items from mock data', () => {
    render(<ContextPanel />)
    expect(screen.getByText(/code generation/i)).toBeInTheDocument()
    expect(screen.getByText(/type checking/i)).toBeInTheDocument()
    expect(screen.getByText(/file analysis/i)).toBeInTheDocument()
    expect(screen.getByText(/syntax validation/i)).toBeInTheDocument()
  })

  test('renders with proper flex layout', () => {
    render(<ContextPanel />)
    const aside = screen.getByRole('complementary')

    expect(aside).toHaveClass('flex', 'flex-col')
  })

  test('renders visible (no translate) when isOpen is true', () => {
    render(<ContextPanel isOpen />)
    const aside = screen.getByRole('complementary')

    expect(aside).not.toHaveClass('translate-x-full')
  })

  test('renders visible (no translate) when isOpen is undefined (default)', () => {
    render(<ContextPanel />)
    const aside = screen.getByRole('complementary')

    expect(aside).not.toHaveClass('translate-x-full')
  })

  test('renders off-screen (translate-x-full) when isOpen is false', () => {
    // eslint-disable-next-line react/jsx-boolean-value
    render(<ContextPanel isOpen={false} />)
    const aside = screen.getByRole('complementary')

    expect(aside).toHaveClass('translate-x-full')
  })

  test('renders with transition classes for smooth animation', () => {
    render(<ContextPanel />)
    const aside = screen.getByRole('complementary')

    expect(aside).toHaveClass('transition-all', 'duration-300')
  })

  test('accepts onToggle prop without error', () => {
    const handleToggle = (): void => {
      // Mock toggle handler
    }

    expect(() => {
      render(<ContextPanel onToggle={handleToggle} />)
    }).not.toThrow()
  })

  // Feature 23: Redesigned layout tests

  test('renders psychology icon in header', () => {
    render(<ContextPanel />)

    const icon = screen.getByText('psychology')

    expect(icon).toBeInTheDocument()
    expect(icon).toHaveClass('material-symbols-outlined')
  })

  test('renders dock_to_right toggle button in header', () => {
    render(<ContextPanel />)

    const toggleButton = screen.getByRole('button', {
      name: /dock to right/i,
    })

    expect(toggleButton).toBeInTheDocument()
    expect(within(toggleButton).getByText('dock_to_right')).toBeInTheDocument()
  })

  test('calls onToggle when dock_to_right button is clicked', () => {
    const handleToggle = vi.fn()

    render(<ContextPanel onToggle={handleToggle} />)

    const toggleButton = screen.getByRole('button', {
      name: /dock to right/i,
    })
    toggleButton.click()

    expect(handleToggle).toHaveBeenCalledTimes(1)
  })

  test('renders navigation items: Model Info, Context, Activity', () => {
    render(<ContextPanel />)

    expect(
      screen.getByRole('button', { name: /model info/i })
    ).toBeInTheDocument()

    expect(
      screen.getAllByRole('button', { name: /context/i }).length
    ).toBeGreaterThan(0)

    expect(
      screen.getByRole('button', { name: /activity/i })
    ).toBeInTheDocument()
  })

  test('Model Info navigation item is active by default', () => {
    render(<ContextPanel />)
    const modelInfoButton = screen.getByRole('button', { name: /model info/i })

    expect(modelInfoButton).toHaveClass('bg-primary/10')
  })

  test('renders Live Insights card', () => {
    render(<ContextPanel />)

    expect(
      screen.getByRole('heading', { name: /live insights/i })
    ).toBeInTheDocument()
  })

  test('renders APPLY FIX button in Live Insights card', () => {
    render(<ContextPanel />)

    const applyFixButton = screen.getByRole('button', { name: /apply fix/i })
    expect(applyFixButton).toBeInTheDocument()
  })

  test('renders Collapse Panel footer button', () => {
    render(<ContextPanel />)

    const collapseButton = screen.getByRole('button', {
      name: /collapse panel/i,
    })
    expect(collapseButton).toBeInTheDocument()
  })

  test('calls onToggle when Collapse Panel button is clicked', () => {
    const handleToggle = vi.fn()
    render(<ContextPanel onToggle={handleToggle} />)

    const collapseButton = screen.getByRole('button', {
      name: /collapse panel/i,
    })
    collapseButton.click()

    expect(handleToggle).toHaveBeenCalledTimes(1)
  })

  test('scrollable content has no-scrollbar class', () => {
    const { container } = render(<ContextPanel />)

    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const scrollableDiv = container.querySelector('.overflow-y-auto')
    expect(scrollableDiv).toHaveClass('no-scrollbar')
  })

  // Bug 4: Reopen button tests

  test('renders reopen button when panel is collapsed', () => {
    // eslint-disable-next-line react/jsx-boolean-value
    render(<ContextPanel isOpen={false} />)

    const reopenButton = screen.getByRole('button', {
      name: /open context panel/i,
    })
    expect(reopenButton).toBeInTheDocument()
    expect(reopenButton).toHaveClass('opacity-100')
    expect(reopenButton).not.toHaveClass('pointer-events-none')
  })

  test('hides reopen button when panel is open', () => {
    render(<ContextPanel isOpen />)

    const reopenButton = screen.getByRole('button', {
      name: /open context panel/i,
    })
    expect(reopenButton).toHaveClass('opacity-0')
    expect(reopenButton).toHaveClass('pointer-events-none')
  })

  test('reopen button has correct positioning and styling', () => {
    // eslint-disable-next-line react/jsx-boolean-value
    render(<ContextPanel isOpen={false} />)

    const reopenButton = screen.getByRole('button', {
      name: /open context panel/i,
    })
    expect(reopenButton).toHaveClass('fixed', 'right-0', 'top-14', 'z-30')
    expect(reopenButton).toHaveClass('w-8', 'h-12')
    expect(reopenButton).toHaveClass('bg-surface-container')
    expect(reopenButton).toHaveClass('rounded-l-lg')
    expect(reopenButton).toHaveClass('border-l', 'border-y')
  })

  test('reopen button displays chevron_left icon', () => {
    // eslint-disable-next-line react/jsx-boolean-value
    render(<ContextPanel isOpen={false} />)

    const reopenButton = screen.getByRole('button', {
      name: /open context panel/i,
    })
    expect(within(reopenButton).getByText('chevron_left')).toBeInTheDocument()
  })

  test('calls onToggle when reopen button is clicked', () => {
    const handleToggle = vi.fn()
    // eslint-disable-next-line react/jsx-boolean-value
    render(<ContextPanel isOpen={false} onToggle={handleToggle} />)

    const reopenButton = screen.getByRole('button', {
      name: /open context panel/i,
    })
    reopenButton.click()

    expect(handleToggle).toHaveBeenCalledTimes(1)
  })

  test('reopen button has smooth transition classes', () => {
    // eslint-disable-next-line react/jsx-boolean-value
    render(<ContextPanel isOpen={false} />)

    const reopenButton = screen.getByRole('button', {
      name: /open context panel/i,
    })
    expect(reopenButton).toHaveClass('transition-all', 'duration-300')
  })
})

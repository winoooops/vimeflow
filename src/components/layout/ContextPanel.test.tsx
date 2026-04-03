import { render, screen, within } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
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

  test('renders context usage progress bar with percentage', () => {
    render(<ContextPanel />)
    expect(screen.getByText(/context usage/i)).toBeInTheDocument()
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

  test('renders AI Strategy section with heading', () => {
    render(<ContextPanel />)

    const heading = screen.getByRole('heading', { name: /ai strategy/i })
    expect(heading).toBeInTheDocument()
    expect(screen.getByText(/current priority/i)).toBeInTheDocument()
    expect(screen.getByText(/code quality/i)).toBeInTheDocument()
  })

  test('renders system health footer with online status', () => {
    render(<ContextPanel />)
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/system online/i)
  })

  test('renders system health with online status and version', () => {
    render(<ContextPanel />)

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/system online/i)
    expect(status).toHaveTextContent(/v0\.1\.0-alpha/i)
  })

  test('renders with proper flex layout', () => {
    render(<ContextPanel />)
    const aside = screen.getByRole('complementary')

    expect(aside).toHaveClass('flex', 'flex-col')
  })
})

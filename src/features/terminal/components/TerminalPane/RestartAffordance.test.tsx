import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { AGENTS } from '../../../../agents/registry'
import { RestartAffordance } from './RestartAffordance'

const baseProps = {
  agent: AGENTS.claude,
  sessionId: 's1',
  exitedAt: '2026-05-08T11:00:00Z',
  onRestart: vi.fn(),
}

describe('RestartAffordance', () => {
  test('renders Session exited title', () => {
    render(<RestartAffordance {...baseProps} />)

    expect(screen.getByText('Session exited.')).toBeInTheDocument()
  })

  test('renders restart button with aria-label', () => {
    render(<RestartAffordance {...baseProps} />)

    expect(
      screen.getByRole('button', { name: /restart session s1/i })
    ).toBeInTheDocument()
  })

  test('clicking restart fires onRestart with sessionId', () => {
    const onRestart = vi.fn()

    render(<RestartAffordance {...baseProps} onRestart={onRestart} />)
    fireEvent.click(screen.getByRole('button', { name: /restart session/i }))

    expect(onRestart).toHaveBeenCalledWith('s1')
  })

  test('renders relative-time string', () => {
    render(<RestartAffordance {...baseProps} />)

    expect(screen.getByText(/ended/i)).toBeInTheDocument()
  })
})

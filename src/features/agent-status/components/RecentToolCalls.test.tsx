import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RecentToolCalls } from './RecentToolCalls'
import type { RecentToolCall } from '../types'

const mockCalls: RecentToolCall[] = [
  {
    id: '1',
    tool: 'Read',
    args: 'src/main.ts',
    status: 'done',
    durationMs: 1200,
    timestamp: '2026-04-12T10:00:00Z',
  },
  {
    id: '2',
    tool: 'Bash',
    args: 'npm run build',
    status: 'failed',
    durationMs: 5400,
    timestamp: '2026-04-12T10:01:00Z',
  },
]

describe('RecentToolCalls', () => {
  test('starts collapsed by default', () => {
    render(<RecentToolCalls calls={mockCalls} />)

    expect(screen.queryByText('Read')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /recent/i })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  test('expands on click and shows tool calls', async () => {
    const user = userEvent.setup()
    render(<RecentToolCalls calls={mockCalls} />)

    await user.click(screen.getByRole('button', { name: /recent/i }))

    expect(screen.getByText('Read')).toBeInTheDocument()
    expect(screen.getByText('Bash')).toBeInTheDocument()
  })

  test('shows success icon for done calls', async () => {
    const user = userEvent.setup()
    render(<RecentToolCalls calls={mockCalls} />)

    await user.click(screen.getByRole('button', { name: /recent/i }))

    expect(screen.getByLabelText('success')).toBeInTheDocument()
  })

  test('shows failed icon for failed calls', async () => {
    const user = userEvent.setup()
    render(<RecentToolCalls calls={mockCalls} />)

    await user.click(screen.getByRole('button', { name: /recent/i }))

    expect(screen.getByLabelText('failed')).toBeInTheDocument()
  })

  test('formats duration in seconds', async () => {
    const user = userEvent.setup()
    render(<RecentToolCalls calls={mockCalls} />)

    await user.click(screen.getByRole('button', { name: /recent/i }))

    expect(screen.getByText('1.2s')).toBeInTheDocument()
    expect(screen.getByText('5.4s')).toBeInTheDocument()
  })

  test('shows count badge', () => {
    render(<RecentToolCalls calls={mockCalls} />)

    expect(screen.getByText('2')).toBeInTheDocument()
  })
})

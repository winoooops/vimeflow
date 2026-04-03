import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import AgentMessage from './AgentMessage'

describe('AgentMessage', () => {
  test('renders agent avatar with psychology icon', () => {
    render(
      <AgentMessage
        message={{
          id: '1',
          sender: 'agent',
          content: 'Test message',
          timestamp: '2026-03-31T10:00:00Z',
        }}
      />
    )

    const avatar = screen.getByLabelText('Agent avatar')
    expect(avatar).toBeInTheDocument()
    expect(avatar).toHaveClass('w-10', 'h-10', 'rounded-full')
    // eslint-disable-next-line testing-library/no-node-access -- verifying icon CSS class
    const icon = avatar.querySelector('.material-symbols-outlined')
    expect(icon).toBeInTheDocument()
  })

  test('renders VIBM Agent name', () => {
    render(
      <AgentMessage
        message={{
          id: '1',
          sender: 'agent',
          content: 'Test message',
          timestamp: '2026-03-31T10:00:00Z',
        }}
      />
    )

    expect(screen.getByText('VIBM Agent')).toBeInTheDocument()
  })

  test('renders StatusBadge when status provided', () => {
    render(
      <AgentMessage
        message={{
          id: '1',
          sender: 'agent',
          content: 'Test message',
          timestamp: '2026-03-31T10:00:00Z',
          status: 'thinking',
        }}
      />
    )

    const badge = screen.getByRole('status')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent('THINKING')
  })

  test('does not render StatusBadge when status not provided', () => {
    render(
      <AgentMessage
        message={{
          id: '1',
          sender: 'agent',
          content: 'Test message',
          timestamp: '2026-03-31T10:00:00Z',
        }}
      />
    )

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  test('renders message content as thinking text when status is thinking', () => {
    render(
      <AgentMessage
        message={{
          id: '1',
          sender: 'agent',
          content: 'Analyzing current middleware architecture...',
          timestamp: '2026-03-31T10:00:00Z',
          status: 'thinking',
        }}
      />
    )

    const content = screen.getByText(
      'Analyzing current middleware architecture...'
    )
    expect(content).toBeInTheDocument()
    expect(content).toHaveClass('italic')
  })

  test('renders message content normally when status is not thinking', () => {
    render(
      <AgentMessage
        message={{
          id: '1',
          sender: 'agent',
          content: 'Analysis complete.',
          timestamp: '2026-03-31T10:00:00Z',
          status: 'completed',
        }}
      />
    )

    const content = screen.getByText('Analysis complete.')
    expect(content).toBeInTheDocument()
    expect(content).not.toHaveClass('italic')
  })

  test('renders code blocks when codeSnippets provided', () => {
    render(
      <AgentMessage
        message={{
          id: '1',
          sender: 'agent',
          content: 'Here is the refactored code:',
          timestamp: '2026-03-31T10:00:00Z',
          codeSnippets: [
            {
              filename: 'auth_middleware.py',
              language: 'python',
              code: 'import redis_client\nfrom vibm.sessions import SessionStore',
            },
          ],
        }}
      />
    )

    const codeBlock = screen.getByRole('figure', {
      name: 'auth_middleware.py',
    })
    expect(codeBlock).toBeInTheDocument()
    expect(screen.getByText('PYTHON')).toBeInTheDocument()
  })

  test('renders multiple code blocks', () => {
    render(
      <AgentMessage
        message={{
          id: '1',
          sender: 'agent',
          content: 'Multiple files updated:',
          timestamp: '2026-03-31T10:00:00Z',
          codeSnippets: [
            {
              filename: 'file1.ts',
              language: 'typescript',
              code: 'const x = 1',
            },
            {
              filename: 'file2.ts',
              language: 'typescript',
              code: 'const y = 2',
            },
          ],
        }}
      />
    )

    const codeBlocks = screen.getAllByRole('figure')
    expect(codeBlocks).toHaveLength(2)
  })

  test('applies correct Tailwind classes to message bubble', () => {
    render(
      <AgentMessage
        message={{
          id: '1',
          sender: 'agent',
          content: 'Test message',
          timestamp: '2026-03-31T10:00:00Z',
        }}
      />
    )

    const bubble = screen.getByTestId('agent-message-bubble')
    expect(bubble).toHaveClass(
      'bg-surface-container-low/40',
      'border',
      'border-outline-variant/10',
      'p-5',
      'rounded-xl',
      'rounded-tl-none'
    )
  })

  test('renders container with proper structure', () => {
    render(
      <AgentMessage
        message={{
          id: '1',
          sender: 'agent',
          content: 'Test message',
          timestamp: '2026-03-31T10:00:00Z',
        }}
      />
    )

    const container = screen.getByRole('article', {
      name: /vibm agent/i,
    })
    expect(container).toHaveClass('flex', 'gap-4', 'max-w-3xl', 'mx-auto')
  })
})

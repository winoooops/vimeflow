import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import MessageThread from './MessageThread'

describe('MessageThread', () => {
  test('renders scrollable container with correct Tailwind classes', () => {
    render(<MessageThread messages={[]} />)
    const section = screen.getByTestId('message-thread')
    expect(section).toBeInTheDocument()
    expect(section).toHaveClass(
      'flex-1',
      'overflow-y-auto',
      'p-8',
      'space-y-8',
      'no-scrollbar'
    )
  })

  test('renders UserMessage components for user messages', () => {
    render(
      <MessageThread
        messages={[
          {
            id: 'msg-1',
            sender: 'user',
            content: 'Test user message',
            timestamp: '2026-03-31T10:00:00Z',
          },
        ]}
      />
    )
    expect(screen.getByTestId('user-message-container')).toBeInTheDocument()
    expect(screen.getByText('Test user message')).toBeInTheDocument()
  })

  test('renders AgentMessage components for agent messages', () => {
    render(
      <MessageThread
        messages={[
          {
            id: 'msg-2',
            sender: 'agent',
            content: 'Test agent response',
            timestamp: '2026-03-31T10:01:00Z',
            status: 'thinking',
          },
        ]}
      />
    )
    expect(screen.getByTestId('agent-message-container')).toBeInTheDocument()
    expect(screen.getByText('Test agent response')).toBeInTheDocument()
  })

  test('renders multiple messages in order', () => {
    render(
      <MessageThread
        messages={[
          {
            id: 'msg-1',
            sender: 'user',
            content: 'First message',
            timestamp: '2026-03-31T10:00:00Z',
          },
          {
            id: 'msg-2',
            sender: 'agent',
            content: 'Second message',
            timestamp: '2026-03-31T10:01:00Z',
            status: 'completed',
          },
          {
            id: 'msg-3',
            sender: 'user',
            content: 'Third message',
            timestamp: '2026-03-31T10:02:00Z',
          },
        ]}
      />
    )
    expect(screen.getByTestId('message-container-msg-1')).toBeInTheDocument()
    expect(screen.getByTestId('message-container-msg-2')).toBeInTheDocument()
    expect(screen.getByTestId('message-container-msg-3')).toBeInTheDocument()
    expect(screen.getByText('First message')).toBeInTheDocument()
    expect(screen.getByText('Second message')).toBeInTheDocument()
    expect(screen.getByText('Third message')).toBeInTheDocument()
  })

  test('handles empty messages array', () => {
    render(<MessageThread messages={[]} />)
    const section = screen.getByTestId('message-thread')
    expect(section).toBeInTheDocument()
    expect(screen.queryByTestId(/^message-container-/)).not.toBeInTheDocument()
  })

  test('wraps messages in max-w-3xl mx-auto container', () => {
    render(
      <MessageThread
        messages={[
          {
            id: 'msg-1',
            sender: 'user',
            content: 'Test message',
            timestamp: '2026-03-31T10:00:00Z',
          },
        ]}
      />
    )
    const container = screen.getByTestId('message-container-msg-1')
    expect(container).toBeInTheDocument()
    expect(container).toHaveClass('max-w-3xl', 'mx-auto')
  })

  test('renders agent messages with code snippets', () => {
    render(
      <MessageThread
        messages={[
          {
            id: 'msg-4',
            sender: 'agent',
            content: 'Here is the refactored code:',
            timestamp: '2026-03-31T10:03:00Z',
            status: 'completed',
            codeSnippets: [
              {
                language: 'typescript',
                filename: 'test.ts',
                code: 'const foo = "bar"',
              },
            ],
          },
        ]}
      />
    )
    expect(screen.getByTestId('agent-message-container')).toBeInTheDocument()
    expect(screen.getByText('Here is the refactored code:')).toBeInTheDocument()
    expect(screen.getByText('test.ts')).toBeInTheDocument()
  })

  test('uses message id as key for rendering', () => {
    render(
      <MessageThread
        messages={[
          {
            id: 'unique-id-1',
            sender: 'user',
            content: 'Message 1',
            timestamp: '2026-03-31T10:00:00Z',
          },
          {
            id: 'unique-id-2',
            sender: 'agent',
            content: 'Message 2',
            timestamp: '2026-03-31T10:01:00Z',
          },
        ]}
      />
    )

    expect(
      screen.getByTestId('message-container-unique-id-1')
    ).toBeInTheDocument()

    expect(
      screen.getByTestId('message-container-unique-id-2')
    ).toBeInTheDocument()
  })

  test('renders section element with semantic HTML', () => {
    render(<MessageThread messages={[]} />)

    const section = screen.getByTestId('message-thread')

    expect(section.tagName).toBe('SECTION')
  })
})

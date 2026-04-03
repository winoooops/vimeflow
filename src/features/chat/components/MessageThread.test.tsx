import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import MessageThread from './MessageThread'

describe('MessageThread', () => {
  test('renders scrollable container with correct Tailwind classes', () => {
    render(<MessageThread messages={[]} />)
    const section = screen.getByRole('region', { name: /message thread/i })
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

    expect(
      screen.getByRole('article', { name: /message from you/i })
    ).toBeInTheDocument()
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

    expect(
      screen.getByRole('article', { name: /vibm agent/i })
    ).toBeInTheDocument()
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
    const articles = screen.getAllByRole('article')
    expect(articles).toHaveLength(3)
    expect(screen.getByText('First message')).toBeInTheDocument()
    expect(screen.getByText('Second message')).toBeInTheDocument()
    expect(screen.getByText('Third message')).toBeInTheDocument()
  })

  test('handles empty messages array', () => {
    render(<MessageThread messages={[]} />)
    const section = screen.getByRole('region', { name: /message thread/i })
    expect(section).toBeInTheDocument()
    expect(screen.queryByRole('article')).not.toBeInTheDocument()
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
    const article = screen.getByRole('article', { name: /message from you/i })

    // eslint-disable-next-line testing-library/no-node-access -- traversing to wrapper container
    const wrapper = article.closest('[data-testid="message-container-msg-1"]')
    expect(wrapper).toHaveClass('max-w-3xl', 'mx-auto')
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

    expect(
      screen.getByRole('article', { name: /vibm agent/i })
    ).toBeInTheDocument()

    expect(screen.getByText('Here is the refactored code:')).toBeInTheDocument()
    expect(screen.getByRole('figure', { name: 'test.ts' })).toBeInTheDocument()
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

    const articles = screen.getAllByRole('article')
    expect(articles).toHaveLength(2)
  })

  test('renders section element with semantic HTML', () => {
    render(<MessageThread messages={[]} />)

    const section = screen.getByRole('region', { name: /message thread/i })
    expect(section.tagName).toBe('SECTION')
  })
})

import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import UserMessage from './UserMessage'
import type { Message } from '../types'

describe('UserMessage', () => {
  const mockMessage: Message = {
    id: '1',
    sender: 'user',
    content: 'Can you help me with the auth_middleware.py file?',
    timestamp: '2026-03-31T10:42:00Z',
  }

  test('renders user message with all elements', () => {
    render(<UserMessage message={mockMessage} />)

    expect(screen.getByText('You')).toBeInTheDocument()
    expect(
      screen.getByText('Can you help me with the auth_middleware.py file?')
    ).toBeInTheDocument()
    expect(screen.getByAltText('User avatar')).toBeInTheDocument()
  })

  test('displays formatted timestamp', () => {
    render(<UserMessage message={mockMessage} />)

    // Timestamp should be rendered (exact format will depend on implementation)
    const timestamp = screen.getByText(/10:42/i)
    expect(timestamp).toBeInTheDocument()
    expect(timestamp).toHaveClass('uppercase')
  })

  test('applies correct Tailwind classes to container', () => {
    render(<UserMessage message={mockMessage} />)

    // Use data-testid to select the container
    const messageContainer = screen.getByTestId('user-message-container')

    expect(messageContainer).toHaveClass('flex')
    expect(messageContainer).toHaveClass('gap-4')
    expect(messageContainer).toHaveClass('max-w-3xl')
    expect(messageContainer).toHaveClass('mx-auto')
  })

  test('applies correct Tailwind classes to avatar container', () => {
    render(<UserMessage message={mockMessage} />)

    // Avatar container has specific classes
    const avatarContainer = screen.getByTestId('user-avatar-container')

    expect(avatarContainer).toHaveClass('w-10')
    expect(avatarContainer).toHaveClass('h-10')
    expect(avatarContainer).toHaveClass('rounded-full')
    expect(avatarContainer).toHaveClass('border-2')
  })

  test('applies correct Tailwind classes to message bubble', () => {
    render(<UserMessage message={mockMessage} />)

    const messageBubble = screen.getByTestId('user-message-bubble')

    expect(messageBubble).toHaveClass('bg-surface-container')
    expect(messageBubble).toHaveClass('p-4')
    expect(messageBubble).toHaveClass('rounded-xl')
    expect(messageBubble).toHaveClass('rounded-tl-none')
    expect(messageBubble).toHaveClass('text-sm')
  })

  test('renders inline code with special styling', () => {
    render(
      <UserMessage
        message={{
          id: '2',
          sender: 'user',
          content: 'Can you refactor `auth_middleware.py` to use async?',
          timestamp: '2026-03-31T10:42:00Z',
        }}
      />
    )

    const codeElement = screen.getByText('auth_middleware.py')
    expect(codeElement.tagName).toBe('CODE')
    expect(codeElement).toHaveClass('font-label')
    expect(codeElement).toHaveClass('bg-surface-container-highest')
    expect(codeElement).toHaveClass('px-1.5')
    expect(codeElement).toHaveClass('py-0.5')
    expect(codeElement).toHaveClass('rounded')
    expect(codeElement).toHaveClass('text-secondary')
  })

  test('handles message without inline code', () => {
    render(<UserMessage message={mockMessage} />)

    // Message without backticks should not have code elements
    const codeElements = screen.queryAllByRole('code')
    expect(codeElements).toHaveLength(0)
  })

  test('renders sender name as "You"', () => {
    render(<UserMessage message={mockMessage} />)

    const senderName = screen.getByText('You')
    expect(senderName).toHaveClass('text-sm')
    expect(senderName).toHaveClass('font-semibold')
    expect(senderName).toHaveClass('text-on-surface')
  })

  test('uses placeholder avatar image', () => {
    render(<UserMessage message={mockMessage} />)

    const avatar = screen.getByAltText('User avatar')
    expect(avatar).toHaveAttribute('src')
    expect(avatar.getAttribute('src')).toContain('https://')
  })
})

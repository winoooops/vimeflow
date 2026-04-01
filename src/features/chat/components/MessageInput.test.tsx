import { render, screen } from '@testing-library/react'
import { describe, test, expect } from 'vitest'
import MessageInput from './MessageInput'

describe('MessageInput', () => {
  test('renders textarea with correct placeholder', () => {
    render(<MessageInput />)

    const textarea = screen.getByPlaceholderText(
      /Ask anything or '.*' for commands.../
    )
    expect(textarea).toBeInTheDocument()
  })

  test('textarea has correct attributes', () => {
    render(<MessageInput />)
    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveAttribute('rows', '3')
  })

  test('textarea has correct Tailwind classes', () => {
    render(<MessageInput />)
    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveClass(
      'w-full',
      'bg-surface-container-highest/30',
      'border-none',
      'rounded-2xl',
      'p-4',
      'pr-16',
      'focus:ring-2',
      'focus:ring-primary/20',
      'text-sm',
      'placeholder:text-on-surface-variant/40',
      'resize-none',
      'glass-panel'
    )
  })

  test('renders send button', () => {
    render(<MessageInput />)
    const button = screen.getByRole('button', { name: /send/i })
    expect(button).toBeInTheDocument()
  })

  test('send button has correct Tailwind classes', () => {
    render(<MessageInput />)
    const button = screen.getByRole('button', { name: /send/i })
    expect(button).toHaveClass(
      'p-2',
      'rounded-lg',
      'bg-primary-container',
      'text-on-primary-container',
      'shadow-lg',
      'shadow-primary-container/20',
      'hover:scale-105',
      'active:scale-95',
      'transition-all'
    )
  })

  test('send button contains Material Symbols icon', () => {
    render(<MessageInput />)
    const button = screen.getByRole('button', { name: /send/i })
    // eslint-disable-next-line testing-library/no-node-access -- checking icon CSS class requires DOM traversal
    const icon = button.querySelector('.material-symbols-outlined')
    expect(icon).toBeInTheDocument()
  })

  test('button is positioned absolutely within relative container', () => {
    render(<MessageInput />)
    const container = screen.getByTestId('message-input-container')
    expect(container).toHaveClass('relative')

    const buttonWrapper = screen.getByTestId('button-wrapper')
    expect(buttonWrapper).toHaveClass(
      'absolute',
      'right-4',
      'bottom-4',
      'flex',
      'gap-2'
    )
  })

  test('renders with correct container structure', () => {
    render(<MessageInput />)
    const footer = screen.getByRole('contentinfo')
    expect(footer).toHaveClass('p-6')

    const container = screen.getByTestId('message-input-container')
    expect(container).toHaveClass('max-w-3xl', 'mx-auto', 'relative')
  })

  test('textarea is resizable: none', () => {
    render(<MessageInput />)
    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveClass('resize-none')
  })
})

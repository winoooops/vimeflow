import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewSessionButton } from './NewSessionButton'

describe('NewSessionButton', () => {
  test('renders a button with the accessible name "New session"', () => {
    render(
      <NewSessionButton
        onClick={vi.fn()}
        shortcutHint="⌘N"
        ariaKeyshortcuts="Meta+N"
      />
    )

    expect(
      screen.getByRole('button', { name: 'New session' })
    ).toBeInTheDocument()
    expect(screen.getByText('New session')).toBeInTheDocument()
  })

  test('keeps the compact icon size while allowing the button to expand', () => {
    render(
      <NewSessionButton
        onClick={vi.fn()}
        shortcutHint="⌘N"
        ariaKeyshortcuts="Meta+N"
      />
    )

    expect(screen.getByTestId('sidebar-new-session')).toHaveClass(
      'min-w-[38px]',
      'max-w-[150px]',
      'flex-1',
      'vf-new-session-button'
    )
  })

  test('clicking calls onClick', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()

    render(
      <NewSessionButton
        onClick={onClick}
        shortcutHint="⌘N"
        ariaKeyshortcuts="Meta+N"
      />
    )
    await user.click(screen.getByRole('button', { name: 'New session' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  test('exposes the platform shortcut via aria-keyshortcuts', () => {
    render(
      <NewSessionButton
        onClick={vi.fn()}
        shortcutHint="Ctrl+N"
        ariaKeyshortcuts="Control+N"
      />
    )

    expect(screen.getByRole('button', { name: 'New session' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+N'
    )
  })

  test('renders the add icon as an aria-hidden material symbol', () => {
    render(
      <NewSessionButton
        onClick={vi.fn()}
        shortcutHint="⌘N"
        ariaKeyshortcuts="Meta+N"
      />
    )

    const button = screen.getByRole('button', { name: 'New session' })
    // eslint-disable-next-line testing-library/no-node-access -- verify decorative icon glyph
    const icon = button.querySelector('.material-symbols-outlined')
    expect(icon).toHaveTextContent('add')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })
})

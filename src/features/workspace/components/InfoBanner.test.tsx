import { describe, test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InfoBanner } from './InfoBanner'

describe('InfoBanner', () => {
  test('null message renders nothing', () => {
    render(<InfoBanner message={null} onDismiss={vi.fn()} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  test('non-null message renders banner with role=status', () => {
    render(<InfoBanner message="Test message" onDismiss={vi.fn()} />)

    const banner = screen.getByRole('status')
    expect(banner).toBeInTheDocument()
    expect(banner).toHaveTextContent('Test message')
  })

  test('dismiss button clears message', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()

    render(<InfoBanner message="Test message" onDismiss={onDismiss} />)

    const dismissButton = screen.getByRole('button', { name: /dismiss/i })
    await user.click(dismissButton)

    expect(onDismiss).toHaveBeenCalledOnce()
  })
})

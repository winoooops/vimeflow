import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsHeader } from './SettingsHeader'

describe('SettingsHeader', () => {
  const baseProps = {
    scope: 'User' as const,
    onScope: vi.fn(),
  }

  test('renders User and vimeflow scope tabs', () => {
    render(<SettingsHeader {...baseProps} />)

    expect(screen.getByRole('button', { name: 'User' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'vimeflow' })).toBeInTheDocument()
  })

  test('active scope has accent underline styling', () => {
    render(<SettingsHeader {...baseProps} scope="vimeflow" />)

    expect(screen.getByRole('button', { name: 'vimeflow' })).toHaveClass(
      'border-primary-container'
    )
  })

  test('calls onScope when a tab is clicked', async () => {
    const user = userEvent.setup()
    const onScope = vi.fn()
    render(<SettingsHeader {...baseProps} onScope={onScope} />)

    await user.click(screen.getByRole('button', { name: 'vimeflow' }))

    expect(onScope).toHaveBeenCalledWith('vimeflow')
  })

  test('renders the Edit in settings.json ghost button', () => {
    render(<SettingsHeader {...baseProps} />)

    expect(
      screen.getByRole('button', { name: 'Edit in settings.json' })
    ).toBeInTheDocument()
  })
})

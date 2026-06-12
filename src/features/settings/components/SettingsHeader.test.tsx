import { describe, expect, test, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsHeader } from './SettingsHeader'

describe('SettingsHeader', () => {
  const baseProps = {
    scope: 'User' as const,
    onScope: vi.fn(),
  }

  test('renders User and vimeflow scope radios', () => {
    render(<SettingsHeader {...baseProps} />)

    expect(screen.getByRole('radio', { name: 'User' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'vimeflow' })).toBeInTheDocument()
  })

  test('active scope has aria-checked and accent underline styling', () => {
    render(<SettingsHeader {...baseProps} scope="vimeflow" />)

    expect(screen.getByRole('radio', { name: 'vimeflow' })).toHaveAttribute(
      'aria-checked',
      'true'
    )

    expect(screen.getByRole('radio', { name: 'User' })).toHaveAttribute(
      'aria-checked',
      'false'
    )

    expect(screen.getByRole('radio', { name: 'vimeflow' })).toHaveClass(
      'border-primary-container'
    )
  })

  test('calls onScope when a tab is clicked', async () => {
    const user = userEvent.setup()
    const onScope = vi.fn()
    render(<SettingsHeader {...baseProps} onScope={onScope} />)

    await user.click(screen.getByRole('radio', { name: 'vimeflow' }))

    expect(onScope).toHaveBeenCalledWith('vimeflow')
  })

  test('renders the Edit in settings.json ghost button', () => {
    render(<SettingsHeader {...baseProps} />)

    expect(
      screen.getByRole('button', { name: 'Edit in settings.json' })
    ).toBeInTheDocument()
  })

  test('clicking Edit in settings.json calls window.vimeflow.settings.openFile()', async () => {
    const user = userEvent.setup()
    const openFile = vi.fn().mockResolvedValue(undefined)

    window.vimeflow = {
      settings: {
        load: vi.fn(),
        save: vi.fn(),
        openFile,
      },
    } as unknown as Window['vimeflow']

    render(<SettingsHeader {...baseProps} />)

    await user.click(
      screen.getByRole('button', { name: 'Edit in settings.json' })
    )

    expect(openFile).toHaveBeenCalledTimes(1)
  })

  afterEach(() => {
    delete window.vimeflow
  })
})

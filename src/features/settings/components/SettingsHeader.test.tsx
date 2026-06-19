import { describe, expect, test, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsHeader } from './SettingsHeader'

describe('SettingsHeader', () => {
  test('renders a single Settings title without scope radios', () => {
    render(<SettingsHeader />)

    expect(
      screen.getByRole('heading', { name: 'Settings' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'User' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'vimeflow' })).toBeNull()
  })

  test('renders the Edit in settings.json ghost button', () => {
    render(<SettingsHeader />)

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

    render(<SettingsHeader />)

    await user.click(
      screen.getByRole('button', { name: 'Edit in settings.json' })
    )

    expect(openFile).toHaveBeenCalledTimes(1)
  })

  test('shows an error message when opening settings.json fails', async () => {
    const user = userEvent.setup()
    const openFile = vi.fn().mockRejectedValue(new Error('failed'))

    window.vimeflow = {
      settings: {
        load: vi.fn(),
        save: vi.fn(),
        openFile,
      },
    } as unknown as Window['vimeflow']

    render(<SettingsHeader />)

    await user.click(
      screen.getByRole('button', { name: 'Edit in settings.json' })
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not open settings.json'
    )
  })

  afterEach(() => {
    delete window.vimeflow
  })
})

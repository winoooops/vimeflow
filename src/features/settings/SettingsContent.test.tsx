import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { render as rtlRender, screen } from '@testing-library/react'
import { type ReactElement } from 'react'
import { SettingsContent } from './SettingsContent'
import { SettingsProvider } from './SettingsProvider'
import { DEFAULT_SETTINGS } from './store/settingsDefaults'

const render = (ui: ReactElement): ReturnType<typeof rtlRender> =>
  rtlRender(ui, { wrapper: SettingsProvider })

describe('SettingsContent', () => {
  beforeEach(() => {
    window.vimeflow = {
      settings: {
        load: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
        save: vi.fn().mockResolvedValue(undefined),
        openFile: vi.fn(),
      },
    } as unknown as Window['vimeflow']
  })

  afterEach(() => {
    delete window.vimeflow
  })

  test('renders the settings body without modal chrome', () => {
    render(<SettingsContent />)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByTestId('settings-dialog-backdrop')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    expect(
      screen.getByRole('heading', { name: 'Appearance' })
    ).toBeInTheDocument()

    expect(screen.getByRole('option', { name: 'Appearance' })).toHaveClass(
      'text-primary'
    )
  })

  test('does not handle navigation shortcuts from a nested dialog', () => {
    render(<SettingsContent />)
    const nestedDialog = document.createElement('div')
    const nestedButton = document.createElement('button')
    nestedDialog.dataset.dialogLayer = 'true'
    nestedDialog.appendChild(nestedButton)
    document.body.appendChild(nestedDialog)

    const event = new KeyboardEvent('keydown', {
      key: 'j',
      bubbles: true,
      cancelable: true,
    })
    nestedButton.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    nestedDialog.remove()
  })
})

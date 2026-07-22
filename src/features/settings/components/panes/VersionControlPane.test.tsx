import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { SettingsProvider } from '../../SettingsProvider'
import { DEFAULT_SETTINGS } from '../../store/settingsDefaults'
import { VersionControlPane } from './VersionControlPane'

describe('VersionControlPane', () => {
  afterEach(() => {
    delete window.vimeflow
  })

  test('persists hunk view settings', async () => {
    const user = userEvent.setup()
    const save = vi.fn().mockResolvedValue(undefined)
    window.vimeflow = {
      settings: {
        load: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
        save,
        openFile: vi.fn(),
      },
    } as unknown as Window['vimeflow']

    render(
      <SettingsProvider>
        <VersionControlPane />
      </SettingsProvider>
    )

    await user.selectOptions(screen.getByLabelText('Diff layout'), 'unified')
    await user.click(screen.getByRole('switch', { name: 'Line numbers' }))

    await waitFor(() => {
      expect(save).toHaveBeenLastCalledWith(
        expect.objectContaining({
          diffViewStyle: 'unified',
          diffShowLineNumbers: false,
        })
      )
    })
  })
})

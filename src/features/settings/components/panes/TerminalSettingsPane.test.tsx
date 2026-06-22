import { afterEach, describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement, ReactNode } from 'react'
import type { SystemFont } from '../../../../bindings/SystemFont'
import { SettingsProvider } from '../../SettingsProvider'
import { DEFAULT_SETTINGS } from '../../store/settingsDefaults'
import { TerminalSettingsPane } from './TerminalSettingsPane'

interface TestWrapperProps {
  children: ReactNode
}

const TestWrapper = ({ children }: TestWrapperProps): ReactElement => (
  <SettingsProvider>{children}</SettingsProvider>
)

const renderPane = (): ReturnType<typeof render> =>
  render(
    <TestWrapper>
      <TerminalSettingsPane />
    </TestWrapper>
  )

const installBridge = (
  fonts: SystemFont[] = []
): {
  save: ReturnType<typeof vi.fn>
  listSystemFonts: ReturnType<typeof vi.fn>
} => {
  const save = vi.fn().mockResolvedValue(undefined)
  const listSystemFonts = vi.fn().mockResolvedValue(fonts)

  window.vimeflow = {
    settings: {
      load: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      save,
      listSystemFonts,
      openFile: vi.fn(),
    },
  } as unknown as Window['vimeflow']

  return { save, listSystemFonts }
}

describe('TerminalSettingsPane', () => {
  afterEach(() => {
    delete window.vimeflow
  })

  test('renders the terminal font setting with the default family', () => {
    renderPane()

    expect(
      screen.getByRole('heading', { name: 'Terminal' })
    ).toBeInTheDocument()
    expect(screen.getByText('Shell · Typography')).toBeInTheDocument()
    expect(screen.getByLabelText('Terminal font family')).toHaveValue(
      'JetBrains Mono'
    )
  })

  test('loads installed system fonts into the selector', async () => {
    const { listSystemFonts } = installBridge([
      { family: 'Iosevka' },
      { family: 'Menlo' },
    ])

    renderPane()

    await waitFor(() => {
      expect(listSystemFonts).toHaveBeenCalled()
      expect(
        screen.getByRole('option', { name: 'Iosevka' })
      ).toBeInTheDocument()
    })

    expect(screen.getByRole('option', { name: 'Menlo' })).toBeInTheDocument()
  })

  test('persists font family changes through the settings store', async () => {
    const user = userEvent.setup()
    const { save } = installBridge([{ family: 'Iosevka' }])

    renderPane()

    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: 'Iosevka' })
      ).toBeInTheDocument()
    })

    await user.selectOptions(screen.getByLabelText('Terminal font family'), [
      'Iosevka',
    ])

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ terminalFontFamily: 'Iosevka' })
      )
    })
  })
})

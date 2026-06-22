import { type ReactElement } from 'react'
import { describe, expect, test } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsDialog } from './SettingsDialog'
import { SettingsProvider } from './SettingsProvider'
import { useSettingsDialog } from './hooks/useSettingsDialog'
import { SidebarSettingsFooter } from '../workspace/components/SidebarSettingsFooter'

const SettingsIntegration = (): ReactElement => {
  const settings = useSettingsDialog()

  return (
    <>
      <SidebarSettingsFooter onSettings={settings.open} />
      <SettingsDialog open={settings.isOpen} onClose={settings.close} />
    </>
  )
}

describe('SettingsDialog integration', () => {
  test('opens from sidebar footer trigger and closes via Escape', async () => {
    const user = userEvent.setup()
    render(
      <SettingsProvider>
        <SettingsIntegration />
      </SettingsProvider>
    )

    await user.click(screen.getByRole('button', { name: 'Settings' }))

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  test('closes when backdrop is clicked', async () => {
    const user = userEvent.setup()
    render(
      <SettingsProvider>
        <SettingsIntegration />
      </SettingsProvider>
    )

    await user.click(screen.getByRole('button', { name: 'Settings' }))

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()

    await user.click(screen.getByTestId('settings-dialog-backdrop'))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})

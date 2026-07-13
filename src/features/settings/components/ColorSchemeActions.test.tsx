import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { ColorSchemeActions } from '@/features/settings/components/ColorSchemeActions'
import type { ThemeJsonEditorMode } from '@/features/settings/components/ThemeJsonEditor'

test('reports the requested editor mode', async () => {
  const user = userEvent.setup()
  const selectedModes: ThemeJsonEditorMode[] = []

  const onSelectMode = (mode: ThemeJsonEditorMode): void => {
    selectedModes.push(mode)
  }

  render(<ColorSchemeActions onSelectMode={onSelectMode} />)

  await user.click(screen.getByRole('button', { name: 'New color scheme' }))
  await user.click(screen.getByRole('button', { name: 'Import theme...' }))
  await user.click(screen.getByRole('button', { name: 'Export current' }))
  await user.click(screen.getByRole('button', { name: 'Edit current' }))

  expect(selectedModes).toEqual(['create', 'import', 'export', 'edit'])
})

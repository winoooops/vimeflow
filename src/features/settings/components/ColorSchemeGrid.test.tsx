import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ColorSchemeGrid } from '@/features/settings/components/ColorSchemeGrid'
import { flexoki, obsidianLens } from '@/theme'

test('renders schemes and reports the selected theme id', async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()

  render(
    <ColorSchemeGrid
      activeThemeId="obsidian-lens"
      themes={[obsidianLens, flexoki]}
      onSelect={onSelect}
    />
  )

  expect(
    screen.getByRole('button', { name: 'Catppuccin', pressed: true })
  ).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Flexoki' }))

  expect(onSelect).toHaveBeenCalledWith('flexoki')
})

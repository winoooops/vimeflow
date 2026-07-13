import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { serializeTheme, themeService, themeToScheme } from '@/theme'
import { obsidianLens } from '@/theme/themes/obsidian-lens'
import { ThemeJsonEditor } from './ThemeJsonEditor'

beforeEach(() => {
  themeService._resetCustomThemesForTest()
  themeService.apply('obsidian-lens')
})

afterEach(() => {
  vi.restoreAllMocks()
})

test('exports the current theme as readable JSON', () => {
  render(
    <ThemeJsonEditor mode="export" theme={obsidianLens} onClose={vi.fn()} />
  )

  expect(
    screen.getByRole('dialog', { name: 'Export theme' })
  ).toBeInTheDocument()

  expect(screen.getByLabelText('Theme JSON')).toHaveValue(
    serializeTheme(obsidianLens)
  )
  expect(screen.getByLabelText('Theme JSON')).toHaveAttribute('readonly')
})

test('imports and applies valid theme JSON', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()

  render(<ThemeJsonEditor mode="import" onClose={onClose} />)

  fireEvent.change(screen.getByLabelText('Theme JSON'), {
    target: {
      value: JSON.stringify({
        ...themeToScheme(obsidianLens),
        id: 'imported-theme',
        label: 'Imported Theme',
      }),
    },
  })
  await user.click(screen.getByRole('button', { name: 'Import theme' }))

  expect(themeService.current().id).toBe('imported-theme')
  expect(
    themeService.list().some((theme) => theme.id === 'imported-theme')
  ).toBe(true)
  expect(onClose).toHaveBeenCalled()
})

test('blocks import when theme JSON collides with a custom theme id', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  themeService.install({
    ...themeToScheme(obsidianLens),
    id: 'existing-theme',
    label: 'Existing Theme',
  })

  render(<ThemeJsonEditor mode="import" onClose={onClose} />)

  fireEvent.change(screen.getByLabelText('Theme JSON'), {
    target: {
      value: JSON.stringify({
        ...themeToScheme(obsidianLens),
        id: 'existing-theme',
        label: 'Imported Replacement',
      }),
    },
  })
  await user.click(screen.getByRole('button', { name: 'Import theme' }))

  expect(screen.getByRole('alert')).toHaveTextContent(
    'A custom theme with this id already exists'
  )

  expect(
    themeService.list().find((candidate) => candidate.id === 'existing-theme')
      ?.label
  ).toBe('Existing Theme')
  expect(onClose).not.toHaveBeenCalled()
})

test('keeps the editor open and reports invalid JSON', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()

  render(<ThemeJsonEditor mode="import" onClose={onClose} />)

  fireEvent.change(screen.getByLabelText('Theme JSON'), {
    target: { value: '{bad' },
  })
  await user.click(screen.getByRole('button', { name: 'Import theme' }))

  expect(screen.getByRole('alert')).toHaveTextContent('Invalid JSON')
  expect(onClose).not.toHaveBeenCalled()
})

test('editing a built-in theme creates a custom fork', async () => {
  const user = userEvent.setup()

  render(<ThemeJsonEditor mode="edit" theme={obsidianLens} onClose={vi.fn()} />)

  const editor = screen.getByLabelText<HTMLTextAreaElement>('Theme JSON')
  const scheme = JSON.parse(editor.value) as { id: string; label: string }

  expect(scheme).toMatchObject({
    id: 'obsidian-lens-custom',
    label: 'Catppuccin Custom',
  })

  await user.click(screen.getByRole('button', { name: 'Apply changes' }))

  expect(themeService.current().id).toBe('obsidian-lens-custom')
  expect(themeService.list()[0]).toBe(obsidianLens)
})

test('editing a custom theme replaces it without allowing its id to change', async () => {
  const user = userEvent.setup()
  themeService.install({
    ...themeToScheme(obsidianLens),
    id: 'custom-theme',
    label: 'Custom Theme',
  })
  const customTheme = themeService.current()

  render(<ThemeJsonEditor mode="edit" theme={customTheme} onClose={vi.fn()} />)

  const editor = screen.getByLabelText('Theme JSON')
  fireEvent.change(editor, {
    target: {
      value: JSON.stringify({
        ...themeToScheme(customTheme),
        id: 'different-theme',
      }),
    },
  })
  await user.click(screen.getByRole('button', { name: 'Apply changes' }))

  expect(screen.getByRole('alert')).toHaveTextContent('Theme id cannot change')
  expect(themeService.current().id).toBe('custom-theme')
})

test('creates a new scheme from a palette-only starter', async () => {
  const user = userEvent.setup()

  render(
    <ThemeJsonEditor mode="create" theme={obsidianLens} onClose={vi.fn()} />
  )

  const text = screen.getByLabelText<HTMLTextAreaElement>('Theme JSON').value
  const scheme = JSON.parse(text) as Record<string, unknown>

  expect(Object.keys(scheme)).toEqual(['id', 'label', 'kind', 'palette'])

  await user.click(screen.getByRole('button', { name: 'Create color scheme' }))

  expect(themeService.current().id).toBe('new-color-scheme')
})

test('blocks create when edited JSON collides with a custom theme id', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()
  themeService.install({
    ...themeToScheme(obsidianLens),
    id: 'existing-theme',
    label: 'Existing Theme',
  })

  render(
    <ThemeJsonEditor mode="create" theme={obsidianLens} onClose={onClose} />
  )

  const editor = screen.getByLabelText<HTMLTextAreaElement>('Theme JSON')
  fireEvent.change(editor, {
    target: {
      value: JSON.stringify({
        ...JSON.parse(editor.value),
        id: 'existing-theme',
        label: 'Created Replacement',
      }),
    },
  })
  await user.click(screen.getByRole('button', { name: 'Create color scheme' }))

  expect(screen.getByRole('alert')).toHaveTextContent(
    'A custom theme with this id already exists'
  )

  expect(
    themeService.list().find((candidate) => candidate.id === 'existing-theme')
      ?.label
  ).toBe('Existing Theme')
  expect(onClose).not.toHaveBeenCalled()
})

import { describe, expect, test } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderPalette } from './CommandPalette.testUtils'
import type { Command } from './registry/types'

const sampleCommand: Command = {
  id: 'help',
  label: ':help',
  description: 'Show command reference',
  icon: 'help',
}

describe('CommandPalette', () => {
  test('does not render the dialog when state.isOpen is false', () => {
    renderPalette({ state: { isOpen: false } })

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('renders the dialog when state.isOpen is true', () => {
    renderPalette({ state: { isOpen: true } })

    expect(
      screen.getByRole('dialog', { name: 'Command palette' })
    ).toBeInTheDocument()
  })

  test('calls close when the backdrop is clicked', async () => {
    const user = userEvent.setup()
    const { close } = renderPalette({ state: { isOpen: true } })

    await user.click(screen.getByTestId('command-palette-backdrop'))

    expect(close).toHaveBeenCalledTimes(1)
  })

  test('renders the controlled query value and forwards input changes', async () => {
    const user = userEvent.setup()

    const { setQuery } = renderPalette({
      state: { isOpen: true, query: ':open' },
    })

    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })

    expect(input).toHaveValue(':open')

    await user.type(input, 'x')

    expect(setQuery).toHaveBeenLastCalledWith(':open' + 'x')
  })

  test('renders controlled results and selected index', () => {
    renderPalette({
      filteredResults: [sampleCommand],
      clampedSelectedIndex: 0,
    })

    const option = screen.getByRole('option', { name: /:help/i })

    expect(option).toHaveAttribute('aria-selected', 'true')
  })

  test('calls executeAt when a result is clicked', async () => {
    const user = userEvent.setup()

    const { executeAt } = renderPalette({
      filteredResults: [sampleCommand],
      clampedSelectedIndex: 0,
    })

    await user.click(screen.getByRole('option', { name: /:help/i }))

    expect(executeAt).toHaveBeenCalledWith(0)
  })

  test('renders the footer and overlay z-index', () => {
    renderPalette()

    expect(screen.getByText('Navigate')).toBeInTheDocument()
    expect(screen.getByText('Run')).toBeInTheDocument()
    expect(screen.queryByText("Type '?' for help")).toBeNull()
    expect(screen.getByRole('dialog')).toHaveClass('z-[100]')
  })

  test('survives mismatched clampedSelectedIndex without crashing the dialog', () => {
    // A caller wiring CommandPalette without going through
    // useCommandPalette could pass a non-negative index against an
    // empty filteredResults array. The component must NOT crash on
    // `filteredResults[idx].id` — the guard yields no
    // aria-activedescendant instead.
    renderPalette({
      state: { isOpen: true },
      filteredResults: [],
      clampedSelectedIndex: 0,
    })

    const input = screen.getByRole('combobox', {
      name: 'Command palette search',
    })

    expect(input).not.toHaveAttribute('aria-activedescendant')
  })
})

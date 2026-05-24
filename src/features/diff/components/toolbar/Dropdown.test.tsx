import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { Dropdown, type DropdownOption } from './Dropdown'

type Theme = 'pierre-dark' | 'dracula'

const themeOptions: readonly DropdownOption<Theme>[] = [
  { value: 'pierre-dark', label: 'pierre-dark' },
  { value: 'dracula', label: 'dracula', description: 'high-contrast purple' },
]

describe('Dropdown', () => {
  test('renders the label and current option label on the trigger', () => {
    render(
      <Dropdown
        label="theme"
        value="pierre-dark"
        options={themeOptions}
        onChange={vi.fn()}
      />
    )

    expect(screen.getByText('theme')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /pierre-dark/i })
    ).toBeInTheDocument()
    // Menu is not open until the trigger is clicked.
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  test('clicking the trigger portals the menu to document.body', async () => {
    const user = userEvent.setup()

    const { container } = render(
      <Dropdown
        label="theme"
        value="pierre-dark"
        options={themeOptions}
        onChange={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: /pierre-dark/i }))

    const menu = await screen.findByRole('menu')
    expect(menu).toBeInTheDocument()
    // Scope a query into the render root: the menu must NOT be inside it.
    // (FloatingPortal mounts the menu directly under document.body so the
    // popover escapes Pierre's stacking context.)
    expect(within(container).queryByRole('menu')).not.toBeInTheDocument()
    expect(within(document.body).getByRole('menu')).toBe(menu)
  })

  test('selecting an option fires onChange and closes the menu', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn<(value: Theme) => void>()

    render(
      <Dropdown
        label="theme"
        value="pierre-dark"
        options={themeOptions}
        onChange={handleChange}
      />
    )

    await user.click(screen.getByRole('button', { name: /pierre-dark/i }))

    const menu = await screen.findByRole('menu')
    await user.click(within(menu).getByRole('menuitem', { name: /dracula/i }))

    expect(handleChange).toHaveBeenCalledTimes(1)
    expect(handleChange).toHaveBeenCalledWith('dracula')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  test('clicking outside dismisses the menu', async () => {
    const user = userEvent.setup()

    render(
      <div>
        <Dropdown
          label="theme"
          value="pierre-dark"
          options={themeOptions}
          onChange={vi.fn()}
        />
        <button type="button">elsewhere</button>
      </div>
    )

    await user.click(screen.getByRole('button', { name: /pierre-dark/i }))
    expect(await screen.findByRole('menu')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'elsewhere' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  test('the currently selected option carries the text-primary class', async () => {
    const user = userEvent.setup()

    render(
      <Dropdown
        label="theme"
        value="dracula"
        options={themeOptions}
        onChange={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: /dracula/i }))
    const menu = await screen.findByRole('menu')

    const selected = within(menu).getByRole('menuitem', { name: /dracula/i })
    expect(selected.className).toContain('text-primary')

    const unselected = within(menu).getByRole('menuitem', {
      name: /pierre-dark/i,
    })
    expect(unselected.className).not.toContain('text-primary')
    expect(unselected.className).toContain('text-on-surface')
  })

  test('renders option descriptions when provided', async () => {
    const user = userEvent.setup()

    render(
      <Dropdown
        label="theme"
        value="pierre-dark"
        options={themeOptions}
        onChange={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: /pierre-dark/i }))
    expect(await screen.findByText('high-contrast purple')).toBeInTheDocument()
  })

  test('accepts numeric values via the widened generic', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn<(value: number) => void>()

    const options: readonly DropdownOption<number>[] = [
      { value: 12, label: '12 px' },
      { value: 14, label: '14 px' },
    ]

    render(
      <Dropdown
        label="font size"
        value={12}
        options={options}
        onChange={handleChange}
      />
    )

    await user.click(screen.getByRole('button', { name: /12 px/i }))
    const menu = await screen.findByRole('menu')
    await user.click(within(menu).getByRole('menuitem', { name: /14 px/i }))

    expect(handleChange).toHaveBeenCalledWith(14)
  })
})

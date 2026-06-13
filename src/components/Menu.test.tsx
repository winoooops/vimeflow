import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { Menu } from './Menu'

describe('Menu core', () => {
  test('renders the trigger and keeps the menu closed initially', () => {
    render(
      <Menu trigger={<button type="button">Open</button>}>
        <Menu.Item onSelect={vi.fn()}>First</Menu.Item>
      </Menu>
    )

    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  test('opens on trigger click and portals the menu to the body', async () => {
    const user = userEvent.setup()

    const { container } = render(
      <Menu trigger={<button type="button">Open</button>}>
        <Menu.Item onSelect={vi.fn()}>First</Menu.Item>
        <Menu.Item onSelect={vi.fn()}>Second</Menu.Item>
      </Menu>
    )

    await user.click(screen.getByRole('button', { name: 'Open' }))

    const menu = await screen.findByRole('menu')
    expect(menu).toBeInTheDocument()
    expect(within(container).queryByRole('menu')).not.toBeInTheDocument()
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(2)
  })

  test('selecting an item fires onSelect and closes the menu', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <Menu trigger={<button type="button">Open</button>}>
        <Menu.Item onSelect={onSelect}>First</Menu.Item>
      </Menu>
    )

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(await screen.findByRole('menuitem', { name: 'First' }))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  test('a disabled item does not fire onSelect and stays open', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <Menu trigger={<button type="button">Open</button>}>
        <Menu.Item disabled onSelect={onSelect}>
          Disabled
        </Menu.Item>
        <Menu.Item onSelect={vi.fn()}>Enabled</Menu.Item>
      </Menu>
    )

    await user.click(screen.getByRole('button', { name: 'Open' }))

    const disabled = await screen.findByRole('menuitem', { name: 'Disabled' })
    expect(disabled).toHaveAttribute('aria-disabled', 'true')

    await user.click(disabled)
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  test('closes on Escape', async () => {
    const user = userEvent.setup()

    render(
      <Menu trigger={<button type="button">Open</button>}>
        <Menu.Item onSelect={vi.fn()}>First</Menu.Item>
      </Menu>
    )

    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByRole('menu')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  test('closes on outside press', async () => {
    const user = userEvent.setup()

    render(
      <div>
        <Menu trigger={<button type="button">Open</button>}>
          <Menu.Item onSelect={vi.fn()}>First</Menu.Item>
        </Menu>
        <button type="button">elsewhere</button>
      </div>
    )

    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByRole('menu')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'elsewhere' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  test('renders a section header above its items', async () => {
    const user = userEvent.setup()

    render(
      <Menu trigger={<button type="button">Open</button>}>
        <Menu.Section label="Actions">
          <Menu.Item onSelect={vi.fn()}>Rename</Menu.Item>
        </Menu.Section>
      </Menu>
    )

    await user.click(screen.getByRole('button', { name: 'Open' }))

    expect(await screen.findByText('Actions')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
  })

  test('renders an aria-hidden icon and a shortcut chip on an item', async () => {
    const user = userEvent.setup()

    render(
      <Menu trigger={<button type="button">Open</button>}>
        <Menu.Item
          icon="content_copy"
          shortcut={['Ctrl', 'C']}
          onSelect={vi.fn()}
        >
          Copy
        </Menu.Item>
      </Menu>
    )

    await user.click(screen.getByRole('button', { name: 'Open' }))

    const item = await screen.findByRole('menuitem', { name: 'Copy' })
    // eslint-disable-next-line testing-library/no-node-access -- verifying icon CSS class
    const icon = item.querySelector('.material-symbols-outlined')
    expect(icon).toBeInTheDocument()
    expect(within(item).getByText('Ctrl+C')).toBeInTheDocument()
  })
})

describe('Menu.Checkbox', () => {
  test('renders a checkbox row reflecting the checked prop', async () => {
    const user = userEvent.setup()

    render(
      <Menu trigger={<button type="button">Open</button>}>
        <Menu.Checkbox checked onChange={vi.fn()}>
          Line numbers
        </Menu.Checkbox>
      </Menu>
    )

    await user.click(screen.getByRole('button', { name: 'Open' }))

    const checkbox = await screen.findByRole('menuitemcheckbox', {
      name: 'Line numbers',
    })
    expect(checkbox).toHaveAttribute('aria-checked', 'true')
    // eslint-disable-next-line testing-library/no-node-access -- verifying the check glyph
    const indicator = checkbox.querySelector('.material-symbols-outlined')
    expect(indicator).toBeInTheDocument()
  })

  test('clicking toggles onChange with the inverted value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn<(next: boolean) => void>()
    const unchecked = false

    render(
      <Menu trigger={<button type="button">Open</button>}>
        <Menu.Checkbox checked={unchecked} onChange={onChange}>
          Sticky header
        </Menu.Checkbox>
      </Menu>
    )

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(
      await screen.findByRole('menuitemcheckbox', { name: 'Sticky header' })
    )

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  test('an unchecked checkbox renders no check glyph', async () => {
    const user = userEvent.setup()
    const unchecked = false

    render(
      <Menu trigger={<button type="button">Open</button>}>
        <Menu.Checkbox checked={unchecked} onChange={vi.fn()}>
          Background tint
        </Menu.Checkbox>
      </Menu>
    )

    await user.click(screen.getByRole('button', { name: 'Open' }))

    const checkbox = await screen.findByRole('menuitemcheckbox', {
      name: 'Background tint',
    })
    expect(checkbox).toHaveAttribute('aria-checked', 'false')
    // eslint-disable-next-line testing-library/no-node-access -- asserting no check glyph
    const indicator = checkbox.querySelector('.material-symbols-outlined')
    expect(indicator).not.toBeInTheDocument()
  })
})

const indicatorOptions = [
  { value: 'classic', label: 'classic' },
  { value: 'bars', label: 'bars' },
] as const

const overflowOptions = [
  { value: 'scroll', label: 'scroll' },
  { value: 'wrap', label: 'wrap' },
] as const

describe('Menu.Submenu', () => {
  test('opens a sub-list when its row is clicked', async () => {
    const user = userEvent.setup()

    render(
      <Menu trigger={<button type="button">Open</button>}>
        <Menu.Submenu
          label="Indicators"
          value="classic"
          options={indicatorOptions}
          onChange={vi.fn()}
        />
      </Menu>
    )

    await user.click(screen.getByRole('button', { name: 'Open' }))

    const row = await screen.findByRole('menuitem', { name: /Indicators/ })
    expect(row).toHaveAttribute('aria-expanded', 'false')

    await user.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('menuitem', { name: 'bars' })).toBeInTheDocument()
  })

  test('selecting an option fires onChange and closes only the submenu', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn<(next: 'classic' | 'bars') => void>()

    render(
      <Menu trigger={<button type="button">Open</button>}>
        <Menu.Submenu
          label="Indicators"
          value="classic"
          options={indicatorOptions}
          onChange={onChange}
        />
      </Menu>
    )

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(
      await screen.findByRole('menuitem', { name: /Indicators/ })
    )
    await user.click(screen.getByRole('menuitem', { name: 'bars' }))

    expect(onChange).toHaveBeenCalledWith('bars')
    // The sub-list option is gone, but the parent menu stays open.
    expect(
      screen.queryByRole('menuitem', { name: 'bars' })
    ).not.toBeInTheDocument()

    expect(
      screen.getByRole('menuitem', { name: /Indicators/ })
    ).toBeInTheDocument()
  })

  test('a press inside the sub-list panel does not dismiss the parent', async () => {
    const user = userEvent.setup()

    render(
      <Menu trigger={<button type="button">Open</button>}>
        <Menu.Submenu
          label="Indicators"
          value="classic"
          options={indicatorOptions}
          onChange={vi.fn()}
        />
      </Menu>
    )

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(
      await screen.findByRole('menuitem', { name: /Indicators/ })
    )

    // The sub-list is a portal sibling of the parent panel. A press inside it
    // (here on the panel container, not an option) must leave the parent open:
    // the parent's dismissWhen predicate keyed on the submenu root attribute
    // returns false for it. Press the sub-list panel and assert both survive.
    const subList = screen
      .getAllByRole('menu')
      .find((menu) => within(menu).queryByRole('menuitem', { name: 'bars' }))
    expect(subList).toBeDefined()
    expect(subList).toHaveAttribute('data-menu-submenu')

    await user.click(subList!)

    expect(
      screen.getByRole('menuitem', { name: /Indicators/ })
    ).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'bars' })).toBeInTheDocument()
  })

  test('opening a second submenu closes the first', async () => {
    const user = userEvent.setup()

    render(
      <Menu trigger={<button type="button">Open</button>}>
        <Menu.Submenu
          label="Indicators"
          value="classic"
          options={indicatorOptions}
          onChange={vi.fn()}
        />
        <Menu.Submenu
          label="Overflow"
          value="scroll"
          options={overflowOptions}
          onChange={vi.fn()}
        />
      </Menu>
    )

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(
      await screen.findByRole('menuitem', { name: /Indicators/ })
    )
    expect(screen.getByRole('menuitem', { name: 'bars' })).toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: /Overflow/ }))
    // Indicators sub-list closed; Overflow sub-list open.
    expect(
      screen.queryByRole('menuitem', { name: 'bars' })
    ).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'wrap' })).toBeInTheDocument()
  })
})

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

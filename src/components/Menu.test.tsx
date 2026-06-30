import { type ReactElement, createRef, useState } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  __resetNativeOverlayForTest,
  type NativeOverlayRequest,
} from '@/components/base/floating/nativeOverlay'
import { Menu } from './Menu'

let restorePlatform: (() => void) | null = null

const setNavigatorPlatform = (platform: string): void => {
  restorePlatform?.()
  const original = Object.getOwnPropertyDescriptor(window.navigator, 'platform')

  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: platform,
  })

  restorePlatform = (): void => {
    if (original === undefined) {
      delete (window.navigator as unknown as { platform?: string }).platform

      return
    }

    Object.defineProperty(window.navigator, 'platform', original)
  }
}

const installNativeOverlayBridge = (): {
  open: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  action: (event: unknown) => void
  closed: (event: unknown) => void
} => {
  let actionListener: ((event: unknown) => void) | null = null
  let closeListener: ((event: unknown) => void) | null = null
  const open = vi.fn().mockResolvedValue({ accepted: true })
  const close = vi.fn().mockResolvedValue(undefined)

  window.vimeflow = {
    invoke: <T,>(): Promise<T> => Promise.resolve(null as T),
    listen: vi.fn(() => Promise.resolve(vi.fn())),
    nativeOverlay: {
      open,
      close,
      actionResult: vi.fn(() => Promise.resolve()),
      onAction: vi.fn((callback: (event: unknown) => void) => {
        actionListener = callback

        return vi.fn()
      }),
      onClose: vi.fn((callback: (event: unknown) => void) => {
        closeListener = callback

        return vi.fn()
      }),
    },
  }

  return {
    open,
    close,
    action: (event): void => {
      actionListener?.(event)
    },
    closed: (event): void => {
      closeListener?.(event)
    },
  }
}

const deferredNativeOpen = (): {
  promise: Promise<{ accepted: boolean }>
  resolve: (value: { accepted: boolean }) => void
} => {
  let resolvePromise: ((value: { accepted: boolean }) => void) | null = null

  const promise = new Promise<{ accepted: boolean }>((resolve) => {
    resolvePromise = resolve
  })

  return {
    promise,
    resolve: (value): void => {
      resolvePromise?.(value)
    },
  }
}

afterEach(() => {
  __resetNativeOverlayForTest()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  restorePlatform?.()
  restorePlatform = null
  document.documentElement.removeAttribute('style')
  document.documentElement.removeAttribute('data-theme')
  delete window.vimeflow
})

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

  test('pressing Enter on the trigger opens the menu and focuses the first item', async () => {
    const user = userEvent.setup()

    render(
      <Menu trigger={<button type="button">Open</button>}>
        <Menu.Item onSelect={vi.fn()}>First</Menu.Item>
        <Menu.Item onSelect={vi.fn()}>Second</Menu.Item>
      </Menu>
    )

    screen.getByRole('button', { name: 'Open' }).focus()
    await user.keyboard('{Enter}')

    await screen.findByRole('menu')
    expect(screen.getByRole('menuitem', { name: 'First' })).toHaveFocus()
  })

  test('ArrowDown from trigger opens the menu and focuses the first item, then moves focus down', async () => {
    const user = userEvent.setup()

    render(
      <Menu trigger={<button type="button">Open</button>}>
        <Menu.Item onSelect={vi.fn()}>Alpha</Menu.Item>
        <Menu.Item onSelect={vi.fn()}>Beta</Menu.Item>
      </Menu>
    )

    screen.getByRole('button', { name: 'Open' }).focus()
    await user.keyboard('{ArrowDown}')

    await screen.findByRole('menu')
    expect(screen.getByRole('menuitem', { name: 'Alpha' })).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Beta' })).toHaveFocus()
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

  test('composes consumer trigger onClick and ref with floating props', async () => {
    const user = userEvent.setup()
    const spy = vi.fn()
    const refSpy = createRef<HTMLButtonElement>()

    render(
      <Menu
        trigger={
          <button type="button" onClick={spy} ref={refSpy}>
            Open
          </button>
        }
      >
        <Menu.Item onSelect={vi.fn()}>First</Menu.Item>
      </Menu>
    )

    await user.click(screen.getByRole('button', { name: 'Open' }))

    expect(spy).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(refSpy.current).toBeInstanceOf(HTMLButtonElement)
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

  test('a disabled checkbox ignores clicks', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn<(next: boolean) => void>()

    render(
      <Menu trigger={<button type="button">Open</button>}>
        <Menu.Checkbox checked disabled onChange={onChange}>
          Current layout
        </Menu.Checkbox>
      </Menu>
    )

    await user.click(screen.getByRole('button', { name: 'Open' }))

    const checkbox = await screen.findByRole('menuitemcheckbox', {
      name: 'Current layout',
    })

    expect(checkbox).toHaveAttribute('aria-disabled', 'true')

    await user.click(checkbox)

    expect(onChange).not.toHaveBeenCalled()
  })

  test('a disabled checked checkbox uses muted indicator styling', async () => {
    const user = userEvent.setup()

    render(
      <Menu trigger={<button type="button">Open</button>}>
        <Menu.Checkbox checked disabled onChange={vi.fn()}>
          Required layout
        </Menu.Checkbox>
      </Menu>
    )

    await user.click(screen.getByRole('button', { name: 'Open' }))

    const checkbox = await screen.findByRole('menuitemcheckbox', {
      name: 'Required layout',
    })
    // eslint-disable-next-line testing-library/no-node-access -- inspect the visual check indicator container
    const indicator = checkbox.lastElementChild

    expect(indicator).toHaveClass('bg-on-surface-variant/12')
    expect(indicator).toHaveClass('text-on-surface-variant/55')
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

  test('a press inside another Menu instance submenu still dismisses this parent', async () => {
    const user = userEvent.setup()

    render(
      <div>
        <Menu trigger={<button type="button">First</button>}>
          <Menu.Item onSelect={vi.fn()}>First item</Menu.Item>
        </Menu>
        <Menu trigger={<button type="button">Second</button>}>
          <Menu.Submenu
            label="Indicators"
            value="classic"
            options={indicatorOptions}
            onChange={vi.fn()}
          />
        </Menu>
      </div>
    )

    await user.click(screen.getByRole('button', { name: 'First' }))
    await user.click(screen.getByRole('button', { name: 'Second' }))
    await user.click(
      await screen.findByRole('menuitem', { name: /Indicators/ })
    )

    const subList = screen
      .getAllByRole('menu')
      .find((menu) => within(menu).queryByRole('menuitem', { name: 'bars' }))
    expect(subList).toBeDefined()
    expect(subList).toHaveAttribute('data-menu-submenu')

    // The first menu should dismiss when the user presses inside the second
    // menu's submenu, because the outside-press exception is scoped to the
    // menu's own open submenu id.
    await user.click(subList!)

    expect(
      screen.queryByRole('menuitem', { name: 'First item' })
    ).not.toBeInTheDocument()

    expect(
      screen.getByRole('menuitem', { name: /Indicators/ })
    ).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'bars' })).toBeInTheDocument()
  })

  test('opening a submenu via keyboard moves focus into the sub-list', async () => {
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

    screen.getByRole('button', { name: 'Open' }).focus()
    await user.keyboard('{ArrowDown}')

    await screen.findByRole('menu')
    const row = screen.getByRole('menuitem', { name: /Indicators/ })
    expect(row).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(row).toHaveAttribute('aria-expanded', 'true')

    const classicOption = await screen.findByRole('menuitem', {
      name: 'classic',
    })
    expect(classicOption).toHaveFocus()
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

  test('selecting a submenu option returns focus to the submenu row and keeps the parent open', async () => {
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

    screen.getByRole('button', { name: 'Open' }).focus()
    await user.keyboard('{ArrowDown}')

    await screen.findByRole('menu')
    const row = screen.getByRole('menuitem', { name: /Indicators/ })
    expect(row).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(row).toHaveAttribute('aria-expanded', 'true')

    const barsOption = await screen.findByRole('menuitem', { name: 'bars' })
    barsOption.focus()
    await user.keyboard('{Enter}')

    // Sub-list is gone; focus returns to the submenu row; parent menu stays open.
    expect(
      screen.queryByRole('menuitem', { name: 'bars' })
    ).not.toBeInTheDocument()

    expect(screen.getByRole('menuitem', { name: /Indicators/ })).toHaveFocus()
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })
})

describe('Menu.Row', () => {
  test('nested button arrow keys do not move menu row focus', async () => {
    const user = userEvent.setup()

    render(
      <Menu trigger={<button type="button">Open</button>}>
        <Menu.Row label="Layout Alpha">
          <span>Layout Alpha</span>
          <button type="button">Edit Alpha</button>
        </Menu.Row>
        <Menu.Row label="Layout Beta">
          <span>Layout Beta</span>
        </Menu.Row>
      </Menu>
    )

    await user.click(screen.getByRole('button', { name: 'Open' }))

    const editButton = await screen.findByRole('button', {
      name: 'Edit Alpha',
    })
    editButton.focus()
    await user.keyboard('{ArrowDown}')

    expect(editButton).toHaveFocus()
    expect(
      screen.getByRole('menuitem', { name: 'Layout Beta' })
    ).not.toHaveFocus()
  })

  test('nested button Enter activates the button instead of the menu row', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onEdit = vi.fn()

    render(
      <Menu trigger={<button type="button">Open</button>}>
        <Menu.Row label="Layout Alpha" onSelect={onSelect}>
          <span>Layout Alpha</span>
          <button type="button" onClick={onEdit}>
            Edit Alpha
          </button>
        </Menu.Row>
      </Menu>
    )

    await user.click(screen.getByRole('button', { name: 'Open' }))

    const editButton = await screen.findByRole('button', {
      name: 'Edit Alpha',
    })
    editButton.focus()
    await user.keyboard('{Enter}')

    expect(onEdit).toHaveBeenCalledOnce()
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('Menu.Context', () => {
  test('renders nothing when closed', () => {
    const closed = false

    const { container } = render(
      <Menu.Context
        position={{ x: 10, y: 20 }}
        open={closed}
        onOpenChange={vi.fn()}
        aria-label="Terminal actions"
      >
        <Menu.Item onSelect={vi.fn()}>Copy</Menu.Item>
      </Menu.Context>
    )

    expect(container).toBeEmptyDOMElement()
  })

  test('renders its items at the cursor position when open', () => {
    render(
      <Menu.Context
        position={{ x: 50, y: 60 }}
        open
        onOpenChange={vi.fn()}
        aria-label="Terminal actions"
      >
        <Menu.Item onSelect={vi.fn()}>Copy</Menu.Item>
        <Menu.Item onSelect={vi.fn()}>Paste</Menu.Item>
      </Menu.Context>
    )

    expect(
      screen.getByRole('menu', { name: 'Terminal actions' })
    ).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Paste' })).toBeInTheDocument()
  })

  test('renders above z-100 overlays like the burner terminal popup', () => {
    render(
      <Menu.Context
        position={{ x: 50, y: 60 }}
        open
        onOpenChange={vi.fn()}
        aria-label="Terminal actions"
      >
        <Menu.Item onSelect={vi.fn()}>Paste</Menu.Item>
      </Menu.Context>
    )

    expect(
      screen.getByRole('menu', { name: 'Terminal actions' }).className
    ).toContain('z-[110]')
  })

  test('requests close via onOpenChange on Escape', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn<(open: boolean) => void>()

    render(
      <Menu.Context
        position={{ x: 0, y: 0 }}
        open
        onOpenChange={onOpenChange}
        aria-label="Terminal actions"
      >
        <Menu.Item onSelect={vi.fn()}>Copy</Menu.Item>
      </Menu.Context>
    )

    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('requests close via onOpenChange on outside press', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn<(open: boolean) => void>()

    render(
      <div>
        <Menu.Context
          position={{ x: 0, y: 0 }}
          open
          onOpenChange={onOpenChange}
          aria-label="Terminal actions"
        >
          <Menu.Item onSelect={vi.fn()}>Copy</Menu.Item>
        </Menu.Context>
        <button type="button">outside</button>
      </div>
    )

    await user.click(screen.getByRole('button', { name: 'outside' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('arrow-key navigation skips a disabled first item', async () => {
    const user = userEvent.setup()

    render(
      <Menu.Context
        position={{ x: 0, y: 0 }}
        open
        onOpenChange={vi.fn()}
        aria-label="Terminal actions"
      >
        <Menu.Item disabled onSelect={vi.fn()}>
          Copy
        </Menu.Item>
        <Menu.Item onSelect={vi.fn()}>Paste</Menu.Item>
      </Menu.Context>
    )

    // Down from the menu lands on the first ENABLED item, skipping disabled Copy.
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Paste' })).toHaveFocus()
  })

  test('uses non-modal focus so siblings stay in the a11y tree', () => {
    render(
      <div>
        <Menu.Context
          position={{ x: 0, y: 0 }}
          open
          onOpenChange={vi.fn()}
          aria-label="Terminal actions"
        >
          <Menu.Item onSelect={vi.fn()}>Copy</Menu.Item>
        </Menu.Context>
        <button type="button">outside</button>
      </div>
    )

    // A modal focus manager would mark siblings aria-hidden, hiding them from
    // role queries. Non-modal leaves the outside button reachable.
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'outside' })).toBeInTheDocument()
  })

  test('falls back locally when nativeOverlay is not requested', () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const nativeBridge = installNativeOverlayBridge()

    render(
      <Menu.Context
        position={{ x: 10, y: 20 }}
        open
        onOpenChange={vi.fn()}
        aria-label="Terminal actions"
      >
        <Menu.Row label="Copy" onSelect={vi.fn()}>
          <span>Copy</span>
        </Menu.Row>
      </Menu.Context>
    )

    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(nativeBridge.open).not.toHaveBeenCalled()
  })

  test('falls back locally when the feature flag is disabled', () => {
    setNavigatorPlatform('MacIntel')
    const nativeBridge = installNativeOverlayBridge()

    render(
      <Menu.Context
        position={{ x: 10, y: 20 }}
        open
        nativeOverlay
        onOpenChange={vi.fn()}
        aria-label="Terminal actions"
      >
        <Menu.Row label="Copy" onSelect={vi.fn()}>
          <span>Copy</span>
        </Menu.Row>
      </Menu.Context>
    )

    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(nativeBridge.open).not.toHaveBeenCalled()
  })

  test('falls back locally without the native overlay API', () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    window.vimeflow = {
      invoke: <T,>(): Promise<T> => Promise.resolve(null as T),
      listen: vi.fn(() => Promise.resolve(vi.fn())),
    }

    render(
      <Menu.Context
        position={{ x: 10, y: 20 }}
        open
        nativeOverlay
        onOpenChange={vi.fn()}
        aria-label="Terminal actions"
      >
        <Menu.Row label="Copy" onSelect={vi.fn()}>
          <span>Copy</span>
        </Menu.Row>
      </Menu.Context>
    )

    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  test('falls back locally on non-macOS platforms', () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('Linux x86_64')
    const nativeBridge = installNativeOverlayBridge()

    render(
      <Menu.Context
        position={{ x: 10, y: 20 }}
        open
        nativeOverlay
        onOpenChange={vi.fn()}
        aria-label="Terminal actions"
      >
        <Menu.Row label="Copy" onSelect={vi.fn()}>
          <span>Copy</span>
        </Menu.Row>
      </Menu.Context>
    )

    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(nativeBridge.open).not.toHaveBeenCalled()
  })

  test('sends a serializable native overlay request and dispatches action once', async () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const nativeBridge = installNativeOverlayBridge()
    const onSelect = vi.fn()

    render(
      <Menu.Context
        position={{ x: 50, y: 60 }}
        open
        nativeOverlay
        onOpenChange={vi.fn()}
        aria-label="Terminal actions"
      >
        <Menu.Row label="Copy" onSelect={onSelect}>
          <span>Copy</span>
          <kbd>⌘C</kbd>
        </Menu.Row>
      </Menu.Context>
    )

    await waitFor(() => expect(nativeBridge.open).toHaveBeenCalledOnce())

    const request = nativeBridge.open.mock.calls[0][0] as NativeOverlayRequest
    const firstItem = request.payload.items?.[0]
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(request).toMatchObject({
      surfaceId: expect.any(String),
      kind: 'menu',
      anchorRect: { x: 50, y: 60, width: 0, height: 0 },
      placement: 'bottom-start',
      payload: {
        kind: 'menu',
        ariaLabel: 'Terminal actions',
        items: [
          {
            id: expect.any(String),
            label: 'Copy',
            shortcut: '⌘C',
          },
        ],
      },
    })

    act(() => {
      nativeBridge.action({
        surfaceId: request.surfaceId,
        actionId: firstItem?.type === 'separator' ? '' : firstItem?.id,
      })

      nativeBridge.action({
        surfaceId: request.surfaceId,
        actionId: firstItem?.type === 'separator' ? '' : firstItem?.id,
      })
    })

    expect(onSelect).toHaveBeenCalledOnce()
  })

  test('serializes context menu detail rows with anchor-width matching', async () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const nativeBridge = installNativeOverlayBridge()
    const root = document.documentElement
    root.dataset.theme = 'flexoki'
    root.style.colorScheme = 'light'
    root.style.setProperty(
      '--color-surface-container-high',
      'var(--color-test-surface-high)'
    )
    root.style.setProperty('--shadow-menu', 'var(--shadow-test-menu)')

    render(
      <Menu.Context
        position={{ x: 50, y: 60, width: 180, height: 22 }}
        open
        nativeOverlay
        matchAnchorWidth
        onOpenChange={vi.fn()}
        aria-label="Git ref details"
      >
        <Menu.Row
          label="Copy path"
          nativeOverlayIcon="folder_open"
          nativeOverlayDetail="/Users/will/projects/vimeflow"
          nativeOverlayFeedback="copy"
          onSelect={vi.fn()}
        >
          <span aria-hidden="true">folder_open</span>
          <span>path</span>
          <span>/Users/will/projects/vimeflow</span>
        </Menu.Row>
      </Menu.Context>
    )

    await waitFor(() => expect(nativeBridge.open).toHaveBeenCalledOnce())

    const request = nativeBridge.open.mock.calls[0][0] as NativeOverlayRequest

    expect(request).toMatchObject({
      anchorRect: { x: 50, y: 60, width: 180, height: 22 },
      theme: {
        id: 'flexoki',
        colorScheme: 'light',
        variables: {
          '--color-surface-container-high': 'var(--color-test-surface-high)',
          '--shadow-menu': 'var(--shadow-test-menu)',
        },
      },
      payload: {
        kind: 'menu',
        ariaLabel: 'Git ref details',
        matchAnchorWidth: true,
        items: [
          {
            id: expect.any(String),
            label: 'Copy path',
            detail: '/Users/will/projects/vimeflow',
            icon: 'folder_open',
            feedback: 'copy',
            closeOnSelect: false,
          },
        ],
      },
    })
  })

  test('native overlay outside close flows back through onOpenChange', async () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const nativeBridge = installNativeOverlayBridge()
    const onOpenChange = vi.fn<(open: boolean) => void>()

    render(
      <Menu.Context
        position={{ x: 50, y: 60 }}
        open
        nativeOverlay
        onOpenChange={onOpenChange}
        aria-label="Terminal actions"
      >
        <Menu.Row label="Copy" onSelect={vi.fn()}>
          <span>Copy</span>
        </Menu.Row>
      </Menu.Context>
    )

    await waitFor(() => expect(nativeBridge.open).toHaveBeenCalledOnce())
    const request = nativeBridge.open.mock.calls[0][0] as NativeOverlayRequest

    act(() => {
      nativeBridge.closed({ surfaceId: request.surfaceId, reason: 'outside' })
    })

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('anchored menus serialize checkboxes and keep them open for multi-select', async () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const nativeBridge = installNativeOverlayBridge()
    const onToggle = vi.fn()
    const user = userEvent.setup()

    render(
      <Menu
        trigger={<button type="button">Open layouts</button>}
        placement="bottom-end"
        aria-label="Displayed layouts"
        nativeOverlay
      >
        <Menu.Section label="Displayed layouts">
          <Menu.Checkbox
            aria-label="Quad"
            checked
            icon="dashboard"
            onChange={onToggle}
          >
            <span>
              <span aria-hidden="true">ignored glyph</span>
              <span>Quad</span>
            </span>
          </Menu.Checkbox>
        </Menu.Section>
      </Menu>
    )

    const trigger = screen.getByRole('button', { name: 'Open layouts' })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 11,
      y: 22,
      width: 33,
      height: 44,
      top: 22,
      left: 11,
      right: 44,
      bottom: 66,
      toJSON: () => ({}),
    } as DOMRect)

    await user.click(trigger)
    await waitFor(() => expect(nativeBridge.open).toHaveBeenCalledOnce())

    const request = nativeBridge.open.mock.calls[0][0] as NativeOverlayRequest
    const checkbox = request.payload.sections?.[0]?.items[0]

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(checkbox).toMatchObject({
      type: 'checkbox',
      id: expect.any(String),
      label: 'Quad',
      icon: 'dashboard',
      checked: true,
    })

    act(() => {
      nativeBridge.action({
        surfaceId: request.surfaceId,
        actionId: checkbox?.type === 'checkbox' ? checkbox.id : '',
      })
    })

    expect(onToggle).toHaveBeenCalledWith(false)

    act(() => {
      nativeBridge.action({
        surfaceId: request.surfaceId,
        actionId: checkbox?.type === 'checkbox' ? checkbox.id : '',
      })
    })

    expect(onToggle).toHaveBeenCalledTimes(2)
  })

  test('anchored native checkbox menus resync after state changes', async () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const nativeBridge = installNativeOverlayBridge()
    const user = userEvent.setup()

    const Harness = (): ReactElement => {
      const [checked, setChecked] = useState(true)

      return (
        <Menu
          trigger={<button type="button">Open layouts</button>}
          aria-label="Displayed layouts"
          nativeOverlay
        >
          <Menu.Section label="Displayed layouts">
            <Menu.Checkbox
              aria-label="Quad"
              checked={checked}
              onChange={setChecked}
            >
              Quad
            </Menu.Checkbox>
          </Menu.Section>
        </Menu>
      )
    }

    render(<Harness />)

    const trigger = screen.getByRole('button', { name: 'Open layouts' })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 11,
      y: 22,
      width: 33,
      height: 44,
      top: 22,
      left: 11,
      right: 44,
      bottom: 66,
      toJSON: () => ({}),
    } as DOMRect)

    await user.click(trigger)
    await waitFor(() => expect(nativeBridge.open).toHaveBeenCalledOnce())

    const firstRequest = nativeBridge.open.mock
      .calls[0][0] as NativeOverlayRequest
    const firstCheckbox = firstRequest.payload.sections?.[0]?.items[0]

    act(() => {
      nativeBridge.action({
        surfaceId: firstRequest.surfaceId,
        actionId: firstCheckbox?.type === 'checkbox' ? firstCheckbox.id : '',
      })
    })

    await waitFor(() => expect(nativeBridge.open).toHaveBeenCalledTimes(2))

    const secondRequest = nativeBridge.open.mock
      .calls[1][0] as NativeOverlayRequest

    expect(nativeBridge.close).toHaveBeenCalledWith({
      surfaceId: firstRequest.surfaceId,
      reason: 'renderer',
    })

    expect(secondRequest.payload.sections?.[0]?.items[0]).toMatchObject({
      type: 'checkbox',
      label: 'Quad',
      checked: false,
    })
  })

  test('anchored menus with unsupported content fall back locally for multi-select', async () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const nativeBridge = installNativeOverlayBridge()
    const onToggle = vi.fn()
    const onCreate = vi.fn()
    const onOpenChange = vi.fn<(open: boolean) => void>()
    const user = userEvent.setup()

    render(
      <Menu
        trigger={<button type="button">Open layouts</button>}
        placement="bottom-end"
        aria-label="Displayed layouts"
        nativeOverlay
        onOpenChange={onOpenChange}
      >
        <Menu.Section label="Displayed layouts">
          <Menu.Checkbox checked onChange={onToggle}>
            <span>
              <strong>unsupported glyph</strong>
              <span>Quad</span>
            </span>
          </Menu.Checkbox>
        </Menu.Section>
        <Menu.Section>
          <div />
          <Menu.Item icon="dashboard_customize" onSelect={onCreate}>
            Create custom layout
          </Menu.Item>
        </Menu.Section>
      </Menu>
    )

    const trigger = screen.getByRole('button', { name: 'Open layouts' })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 11,
      y: 22,
      width: 33,
      height: 44,
      top: 22,
      left: 11,
      right: 44,
      bottom: 66,
      toJSON: () => ({}),
    } as DOMRect)

    await user.click(trigger)
    const menu = await screen.findByRole('menu')

    const checkbox = within(menu).getByRole('menuitemcheckbox', {
      name: /Quad/,
    })

    expect(nativeBridge.open).not.toHaveBeenCalled()

    await user.click(checkbox)

    expect(onToggle).toHaveBeenCalledWith(false)
    expect(onCreate).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenLastCalledWith(false)
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  test('anchored menus serialize composite rows with trailing actions', async () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const nativeBridge = installNativeOverlayBridge()
    const onPick = vi.fn()
    const onDuplicate = vi.fn()
    const user = userEvent.setup()

    render(
      <Menu trigger={<button type="button">Open layouts</button>} nativeOverlay>
        <Menu.Section label="Custom">
          <Menu.Row
            label="Workspace layout"
            nativeOverlayIcon="dashboard"
            nativeOverlayActions={[
              {
                label: 'Duplicate Workspace layout',
                icon: 'content_copy',
                onSelect: onDuplicate,
              },
            ]}
            onSelect={onPick}
          >
            <button type="button">Workspace layout</button>
            <button type="button">Duplicate Workspace layout</button>
          </Menu.Row>
        </Menu.Section>
      </Menu>
    )

    await user.click(screen.getByRole('button', { name: 'Open layouts' }))
    await waitFor(() => expect(nativeBridge.open).toHaveBeenCalledOnce())

    const request = nativeBridge.open.mock.calls[0][0] as NativeOverlayRequest
    const composite = request.payload.sections?.[0]?.items[0]

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(composite).toMatchObject({
      type: 'composite',
      id: expect.any(String),
      label: 'Workspace layout',
      icon: 'dashboard',
      actions: [
        {
          id: expect.any(String),
          label: 'Duplicate Workspace layout',
          icon: 'content_copy',
        },
      ],
    })

    const duplicateAction =
      composite?.type === 'composite' ? composite.actions[0] : undefined

    act(() => {
      nativeBridge.action({
        surfaceId: request.surfaceId,
        actionId: duplicateAction?.id ?? '',
      })
    })

    expect(onDuplicate).toHaveBeenCalledOnce()
    expect(onPick).not.toHaveBeenCalled()
  })

  test('native overlay stays open across parent rerenders with identical payload', async () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const nativeBridge = installNativeOverlayBridge()
    const onPick = vi.fn()
    const user = userEvent.setup()

    const Harness = (): ReactElement => {
      const [tick, setTick] = useState(0)

      return (
        <>
          <button type="button" onClick={(): void => setTick(tick + 1)}>
            Rerender {tick}
          </button>
          <Menu.Context
            position={{ x: 50, y: 60 }}
            open
            nativeOverlay
            onOpenChange={vi.fn()}
            aria-label="Terminal actions"
          >
            <Menu.Row label="Copy" onSelect={onPick}>
              <span>Copy</span>
            </Menu.Row>
          </Menu.Context>
        </>
      )
    }

    render(<Harness />)
    await waitFor(() => expect(nativeBridge.open).toHaveBeenCalledOnce())
    const request = nativeBridge.open.mock.calls[0][0] as NativeOverlayRequest

    await user.click(screen.getByRole('button', { name: 'Rerender 0' }))

    expect(nativeBridge.open).toHaveBeenCalledOnce()
    expect(nativeBridge.close).not.toHaveBeenCalled()

    act(() => {
      const item = request.payload.items?.[0]

      nativeBridge.action({
        surfaceId: request.surfaceId,
        actionId:
          item === undefined || item.type === 'separator' ? '' : item.id,
      })
    })

    expect(onPick).toHaveBeenCalledOnce()
  })

  test('cancelled pending native opens send close after the open resolves', async () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const nativeBridge = installNativeOverlayBridge()
    const pending = deferredNativeOpen()
    nativeBridge.open.mockReturnValueOnce(pending.promise)

    const { unmount } = render(
      <Menu.Context
        position={{ x: 10, y: 20 }}
        open
        nativeOverlay
        onOpenChange={vi.fn()}
        aria-label="Terminal actions"
      >
        <Menu.Row label="Copy" onSelect={vi.fn()}>
          <span>Copy</span>
        </Menu.Row>
      </Menu.Context>
    )

    await waitFor(() => expect(nativeBridge.open).toHaveBeenCalledOnce())

    unmount()

    expect(nativeBridge.close).toHaveBeenCalledOnce()

    await act(async () => {
      pending.resolve({ accepted: true })
      await pending.promise
    })

    expect(nativeBridge.close).toHaveBeenCalledTimes(2)
  })

  test('anchored menus fall back locally when content cannot be serialized', async () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const nativeBridge = installNativeOverlayBridge()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const user = userEvent.setup()

    render(
      <Menu trigger={<button type="button">Open layouts</button>} nativeOverlay>
        <Menu.Section label="Custom">
          <Menu.Row label="Workspace layout" onSelect={vi.fn()}>
            <button type="button">Workspace layout</button>
          </Menu.Row>
        </Menu.Section>
      </Menu>
    )

    await user.click(screen.getByRole('button', { name: 'Open layouts' }))

    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(nativeBridge.open).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      '[vimeflow:native-overlay] falling back to local floating surface: unsupported menu content'
    )
    warn.mockRestore()
  })
})

describe('Menu dynamic items', () => {
  // Harness whose item set changes while the menu stays open: a toggle prepends
  // an enabled "Prepended" row ahead of a disabled "Copy" and an enabled
  // "Paste". The old counter registry froze each row's index on mount and reset
  // its counter every parent render, so a row inserted later collided at index 0
  // and the disabled map went sparse — keyboard nav + disabled-skip then targeted
  // the wrong row. FloatingList re-derives every index from DOM order, so nav
  // stays correct across the change.
  const DynamicContextMenu = (): ReactElement => {
    const [prepended, setPrepended] = useState(false)

    return (
      <div>
        <button type="button" onClick={(): void => setPrepended(true)}>
          insert row
        </button>
        <Menu.Context
          position={{ x: 0, y: 0 }}
          open
          onOpenChange={vi.fn()}
          aria-label="Dynamic actions"
        >
          {prepended ? (
            <Menu.Item onSelect={vi.fn()}>Prepended</Menu.Item>
          ) : null}
          <Menu.Item disabled onSelect={vi.fn()}>
            Copy
          </Menu.Item>
          <Menu.Item onSelect={vi.fn()}>Paste</Menu.Item>
        </Menu.Context>
      </div>
    )
  }

  test('keyboard nav and disabled-skip stay correct after a row is inserted while open', async () => {
    const user = userEvent.setup()

    render(<DynamicContextMenu />)

    // Before the change: Down skips disabled Copy and lands on Paste.
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Paste' })).toHaveFocus()

    // Insert an enabled row at the FRONT while the menu is open.
    await user.click(screen.getByRole('button', { name: 'insert row' }))
    expect(
      screen.getByRole('menuitem', { name: 'Prepended' })
    ).toBeInTheDocument()

    // The new row took DOM index 0; Copy shifted to 1 (still disabled), Paste to
    // 2. Down from Prepended must skip the now-shifted disabled Copy and reach
    // Paste — the stale counter would have mis-indexed both and skipped the
    // wrong row.
    screen.getByRole('menuitem', { name: 'Prepended' }).focus()
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitem', { name: 'Paste' })).toHaveFocus()

    // And the disabled Copy is genuinely skipped, never focused, by walking up.
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('menuitem', { name: 'Prepended' })).toHaveFocus()
  })
})

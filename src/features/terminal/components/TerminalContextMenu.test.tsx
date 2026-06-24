import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { TerminalContextMenu } from './TerminalContextMenu'

const baseProps = {
  onClose: vi.fn(),
  onCopy: vi.fn(),
  onPaste: vi.fn(),
  onPasteImage: vi.fn(),
  canCopy: true,
  canPasteImage: false,
  showPasteImage: true,
}

const closed = false
const cannotCopy = false

test('renders null when isOpen is false', () => {
  const { container } = render(
    <TerminalContextMenu {...baseProps} isOpen={closed} position={null} />
  )

  expect(container).toBeEmptyDOMElement()
})

test('hides Paste Image outside coding agent sessions', () => {
  render(
    <TerminalContextMenu
      {...baseProps}
      {...{ showPasteImage: false }}
      isOpen
      position={{ x: 50, y: 60 }}
    />
  )

  expect(
    screen.queryByRole('menuitem', { name: 'Paste Image' })
  ).not.toBeInTheDocument()
})

test('renders a menu with Copy and Paste items when isOpen and canCopy', () => {
  render(
    <TerminalContextMenu {...baseProps} isOpen position={{ x: 50, y: 60 }} />
  )

  expect(
    screen.getByRole('menu', { name: 'Terminal actions' })
  ).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Paste' })).toBeInTheDocument()

  expect(
    screen.getByRole('menuitem', { name: 'Paste Image' })
  ).toBeInTheDocument()

  expect(
    screen.queryByRole('menuitem', { name: 'Select All' })
  ).not.toBeInTheDocument()

  expect(
    screen.queryByRole('menuitem', { name: 'Clear' })
  ).not.toBeInTheDocument()
})

test('Paste Image item is disabled when the top clipboard item is not an image', () => {
  render(
    <TerminalContextMenu {...baseProps} isOpen position={{ x: 50, y: 60 }} />
  )

  expect(screen.getByRole('menuitem', { name: 'Paste Image' })).toHaveAttribute(
    'aria-disabled',
    'true'
  )
})

test('clicking Paste Image when enabled fires onPasteImage then onClose', async () => {
  const user = userEvent.setup()
  const order: string[] = []

  const onPasteImage = vi.fn(() => {
    order.push('paste-image')
  })

  const onClose = vi.fn(() => {
    order.push('close')
  })

  render(
    <TerminalContextMenu
      {...baseProps}
      onPasteImage={onPasteImage}
      onClose={onClose}
      canPasteImage
      isOpen
      position={{ x: 0, y: 0 }}
    />
  )

  await user.click(screen.getByRole('menuitem', { name: 'Paste Image' }))

  expect(order).toEqual(['paste-image', 'close'])
})

test('renders shortcut chips beside Copy and Paste', () => {
  render(
    <TerminalContextMenu {...baseProps} isOpen position={{ x: 50, y: 60 }} />
  )

  expect(screen.getByText('Ctrl+Shift+C')).toBeInTheDocument()
  expect(screen.getByText('Ctrl+Shift+V')).toBeInTheDocument()
  expect(screen.getByText('Ctrl+V')).toBeInTheDocument()
})

test('omits duplicate Paste Image shortcut chip on macOS', async () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(
    window.navigator,
    'platform'
  )

  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: 'MacIntel',
  })
  vi.resetModules()

  try {
    const { TerminalContextMenu: MacTerminalContextMenu } =
      await import('./TerminalContextMenu')

    render(
      <MacTerminalContextMenu
        {...baseProps}
        canPasteImage
        isOpen
        position={{ x: 50, y: 60 }}
      />
    )

    const pasteRow = screen.getByRole('menuitem', { name: 'Paste' })
    const pasteImageRow = screen.getByRole('menuitem', { name: 'Paste Image' })

    expect(within(pasteRow).getByText(/V$/)).toBeInTheDocument()
    expect(within(pasteImageRow).queryByText(/V$/)).not.toBeInTheDocument()
  } finally {
    if (originalPlatform === undefined) {
      delete (window.navigator as unknown as { platform?: string }).platform
    } else {
      Object.defineProperty(window.navigator, 'platform', originalPlatform)
    }
    vi.resetModules()
  }
})

test('Copy item has aria-disabled="true" when canCopy is false', () => {
  render(
    <TerminalContextMenu
      {...baseProps}
      isOpen
      position={{ x: 0, y: 0 }}
      canCopy={cannotCopy}
    />
  )

  expect(screen.getByRole('menuitem', { name: 'Copy' })).toHaveAttribute(
    'aria-disabled',
    'true'
  )
})

test('clicking Copy with canCopy=true fires onCopy then onClose', async () => {
  const user = userEvent.setup()
  const order: string[] = []

  const onCopy = vi.fn(() => {
    order.push('copy')
  })

  const onClose = vi.fn(() => {
    order.push('close')
  })

  render(
    <TerminalContextMenu
      {...baseProps}
      onCopy={onCopy}
      onClose={onClose}
      isOpen
      position={{ x: 0, y: 0 }}
    />
  )

  await user.click(screen.getByRole('menuitem', { name: 'Copy' }))

  expect(order).toEqual(['copy', 'close'])
})

test('clicking Copy when canCopy=false does not fire onCopy or onClose', async () => {
  const user = userEvent.setup()
  const onCopy = vi.fn()
  const onClose = vi.fn()

  render(
    <TerminalContextMenu
      {...baseProps}
      onCopy={onCopy}
      onClose={onClose}
      canCopy={cannotCopy}
      isOpen
      position={{ x: 0, y: 0 }}
    />
  )

  await user.click(screen.getByRole('menuitem', { name: 'Copy' }))

  expect(onCopy).not.toHaveBeenCalled()
  expect(onClose).not.toHaveBeenCalled()
})

test('pressing Escape calls onClose', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()

  render(
    <TerminalContextMenu
      {...baseProps}
      onClose={onClose}
      isOpen
      position={{ x: 0, y: 0 }}
    />
  )

  await user.keyboard('{Escape}')

  expect(onClose).toHaveBeenCalledOnce()
})

test('clicking outside the menu calls onClose', async () => {
  const user = userEvent.setup()
  const onClose = vi.fn()

  render(
    <div>
      <button type="button">outside</button>
      <TerminalContextMenu
        {...baseProps}
        onClose={onClose}
        isOpen
        position={{ x: 0, y: 0 }}
      />
    </div>
  )

  await user.click(screen.getByRole('button', { name: 'outside' }))

  expect(onClose).toHaveBeenCalledOnce()
})

test('ArrowDown loops on Paste when disabled Copy is skipped', async () => {
  const user = userEvent.setup()

  render(
    <TerminalContextMenu
      {...baseProps}
      isOpen
      position={{ x: 0, y: 0 }}
      canCopy={cannotCopy}
    />
  )

  expect(screen.getByRole('menuitem', { name: 'Paste' })).toHaveFocus()

  await user.keyboard('{ArrowDown}')
  expect(screen.getByRole('menuitem', { name: 'Paste' })).toHaveFocus()
})

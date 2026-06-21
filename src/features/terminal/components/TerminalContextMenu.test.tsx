import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { TerminalContextMenu } from './TerminalContextMenu'

const baseProps = {
  onClose: vi.fn(),
  onCopy: vi.fn(),
  onPaste: vi.fn(),
  onSelectAll: vi.fn(),
  canCopy: true,
}

const closed = false
const cannotCopy = false

test('renders null when isOpen is false', () => {
  const { container } = render(
    <TerminalContextMenu {...baseProps} isOpen={closed} position={null} />
  )

  expect(container).toBeEmptyDOMElement()
})

test('renders a menu with terminal action items when isOpen and canCopy', () => {
  render(
    <TerminalContextMenu {...baseProps} isOpen position={{ x: 50, y: 60 }} />
  )

  expect(
    screen.getByRole('menu', { name: 'Terminal actions' })
  ).toBeInTheDocument()

  expect(
    screen.getByRole('menuitem', { name: 'Select All' })
  ).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Paste' })).toBeInTheDocument()

  expect(
    screen.queryByRole('menuitem', { name: 'Clear' })
  ).not.toBeInTheDocument()
})

test('renders shortcut chips beside Copy and Paste', () => {
  render(
    <TerminalContextMenu {...baseProps} isOpen position={{ x: 50, y: 60 }} />
  )

  expect(screen.getByText('Ctrl+Shift+C')).toBeInTheDocument()
  expect(screen.getByText('Ctrl+Shift+V')).toBeInTheDocument()
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

test('clicking Select All fires onSelectAll then onClose', async () => {
  const user = userEvent.setup()
  const order: string[] = []

  const onSelectAll = vi.fn(() => {
    order.push('select-all')
  })

  const onClose = vi.fn(() => {
    order.push('close')
  })

  render(
    <TerminalContextMenu
      {...baseProps}
      onClose={onClose}
      onSelectAll={onSelectAll}
      isOpen
      position={{ x: 0, y: 0 }}
    />
  )

  await user.click(screen.getByRole('menuitem', { name: 'Select All' }))

  expect(order).toEqual(['select-all', 'close'])
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

  expect(screen.getByRole('menuitem', { name: 'Select All' })).toHaveFocus()

  await user.keyboard('{ArrowDown}')
  expect(screen.getByRole('menuitem', { name: 'Paste' })).toHaveFocus()

  await user.keyboard('{ArrowDown}')
  expect(screen.getByRole('menuitem', { name: 'Select All' })).toHaveFocus()
})

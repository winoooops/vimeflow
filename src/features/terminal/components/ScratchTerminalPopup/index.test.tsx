import { test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { ScratchTerminalPopup } from './index'
import type { ITerminalService } from '../../services/terminalService'
import type { NotifyPaneReady } from '../../hooks/useTerminal'

// Body owns the xterm instance (canvas/webgl), which jsdom can't render.
// Stub it so the popup's overlay shell — visibility, keep-mounted, prop
// forwarding — is unit-tested in isolation; Body's attach behavior is
// covered in Body.test.tsx.
vi.mock('../TerminalPane/Body', () => ({
  Body: ({
    mode = undefined,
    onPaneReady = undefined,
  }: {
    mode?: string
    onPaneReady?: unknown
  }): ReactElement => (
    <div
      data-testid="body-stub"
      data-body-mode={mode}
      data-has-on-ready={onPaneReady ? 'yes' : 'no'}
    />
  ),
}))

const baseProps = {
  scratchPtyId: 'scratch-pty',
  cwd: '/repo',
  pid: 7,
  service: {} as ITerminalService,
  onHide: vi.fn(),
}

// Element factory so `open` is always a variable — the jsx-boolean-value rule
// rejects a literal `open={false}` under this config.
const popup = (
  open: boolean,
  extra: { onPaneReady?: NotifyPaneReady } = {}
): ReactElement => (
  <ScratchTerminalPopup open={open} {...baseProps} {...extra} />
)

test('renders Body in attach mode for the scratch ptyId', () => {
  render(popup(true))

  expect(screen.getByTestId('scratch-body')).toHaveAttribute(
    'data-mode',
    'attach'
  )

  expect(screen.getByTestId('body-stub')).toHaveAttribute(
    'data-body-mode',
    'attach'
  )
})

test('stays mounted (hidden) when dismissed — not unmounted', () => {
  const { rerender } = render(popup(true))
  const node = screen.getByTestId('scratch-body')

  rerender(popup(false))

  expect(screen.getByTestId('scratch-body')).toBe(node) // same node, still mounted
  expect(screen.getByTestId('scratch-popup')).toHaveAttribute(
    'aria-hidden',
    'true'
  )
})

test('forwards the drain notifier to Body as onPaneReady', () => {
  render(popup(true, { onPaneReady: vi.fn() }))

  expect(screen.getByTestId('body-stub')).toHaveAttribute(
    'data-has-on-ready',
    'yes'
  )
})

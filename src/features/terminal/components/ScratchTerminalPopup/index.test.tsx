import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import type { ReactElement } from 'react'
import { ScratchTerminalPopup } from './index'
import type { ITerminalService } from '../../services/terminalService'
import type { NotifyPaneReady } from '../../hooks/useTerminal'

// Body owns the xterm instance (canvas/webgl), which jsdom can't render. Stub
// it as a forwardRef exposing a focusTerminal spy and capturing the onPaneReady
// it receives, so the popup's focus + drain wiring is unit-tested in isolation;
// Body's attach behavior is covered in Body.test.tsx.
const { focusTerminal, captured } = vi.hoisted(() => ({
  focusTerminal: vi.fn(),
  captured: { onPaneReady: undefined as NotifyPaneReady | undefined },
}))

vi.mock('../TerminalPane/Body', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')

  return {
    Body: forwardRef<
      { focusTerminal: () => void },
      { mode?: string; onPaneReady?: NotifyPaneReady }
    >(function BodyStub(props, ref) {
      captured.onPaneReady = props.onPaneReady
      useImperativeHandle(ref, () => ({ focusTerminal }), [])

      return (
        <div
          data-testid="body-stub"
          data-body-mode={props.mode}
          data-has-on-ready={props.onPaneReady ? 'yes' : 'no'}
        />
      )
    }),
  }
})

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
  extra: { onPaneReady?: NotifyPaneReady; onHide?: () => void } = {}
): ReactElement => (
  <ScratchTerminalPopup open={open} {...baseProps} {...extra} />
)

beforeEach(() => {
  focusTerminal.mockClear()
  captured.onPaneReady = undefined
})

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

test('drains the buffer through the provided onPaneReady when Body attaches', () => {
  const onPaneReady = vi.fn(() => vi.fn())

  render(popup(true, { onPaneReady }))
  const handler = vi.fn()
  act(() => {
    captured.onPaneReady?.('scratch-pty', handler)
  })

  expect(onPaneReady).toHaveBeenCalledWith('scratch-pty', handler)
})

test('focuses the scratch terminal when shown', () => {
  const { rerender } = render(popup(false))
  expect(focusTerminal).not.toHaveBeenCalled()

  rerender(popup(true))

  expect(focusTerminal).toHaveBeenCalled()
})

test('focuses once the terminal attaches on first open', () => {
  render(popup(true))
  focusTerminal.mockClear() // ignore the show-effect's eager focus

  act(() => {
    captured.onPaneReady?.('scratch-pty', vi.fn())
  })

  expect(focusTerminal).toHaveBeenCalled()
})

test('does not focus when Body attaches while the popup is hidden', () => {
  render(popup(false))
  focusTerminal.mockClear()

  act(() => {
    captured.onPaneReady?.('scratch-pty', vi.fn())
  })

  expect(focusTerminal).not.toHaveBeenCalled()
})

test('Escape hides the popup instead of reaching the terminal', () => {
  const onHide = vi.fn()
  render(popup(true, { onHide }))

  // Fire on the terminal stub so the event captures up through the overlay —
  // the capture listener must intercept before the keydown reaches xterm.
  fireEvent.keyDown(screen.getByTestId('body-stub'), { key: 'Escape' })

  expect(onHide).toHaveBeenCalledTimes(1)
})

test('Escape does nothing while the popup is hidden', () => {
  const onHide = vi.fn()
  render(popup(false, { onHide }))

  fireEvent.keyDown(screen.getByTestId('scratch-popup'), { key: 'Escape' })

  expect(onHide).not.toHaveBeenCalled()
})

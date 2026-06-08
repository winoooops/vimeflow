import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import type { ReactElement } from 'react'
import { BurnerTerminalPopup } from './index'
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
      {
        mode?: string
        onPaneReady?: NotifyPaneReady
        onCwdChange?: (cwd: string) => void
      }
    >(function BodyStub(props, ref) {
      captured.onPaneReady = props.onPaneReady
      useImperativeHandle(ref, () => ({ focusTerminal }), [])

      return (
        <div
          data-testid="body-stub"
          data-body-mode={props.mode}
          data-has-on-ready={props.onPaneReady ? 'yes' : 'no'}
          data-has-on-cwd-change={props.onCwdChange ? 'yes' : 'no'}
        >
          {/* xterm renders a textarea for keyboard input; keep one in the stub
              so focus-trap tests can simulate the terminal holding focus. */}
          <textarea data-testid="xterm-textarea" />
        </div>
      )
    }),
  }
})

const baseProps = {
  burnerPtyId: 'burner-pty',
  cwd: '/repo',
  pid: 7,
  service: {} as ITerminalService,
  onHide: vi.fn(),
}

// Element factory so `open` is always a variable — the jsx-boolean-value rule
// rejects a literal `open={false}` under this config.
const popup = (
  open: boolean,
  extra: {
    onPaneReady?: NotifyPaneReady
    onHide?: () => void
    onAlignCwd?: () => void
    alignBusy?: boolean
  } = {}
): ReactElement => <BurnerTerminalPopup open={open} {...baseProps} {...extra} />

beforeEach(() => {
  focusTerminal.mockClear()
  captured.onPaneReady = undefined
})

test('renders Body in attach mode for the burner ptyId', () => {
  render(popup(true))

  expect(screen.getByTestId('burner-body')).toHaveAttribute(
    'data-mode',
    'attach'
  )

  expect(screen.getByTestId('body-stub')).toHaveAttribute(
    'data-body-mode',
    'attach'
  )
})

test('does not wire OSC 7 → updatePaneCwd, so a burner cd stays isolated', () => {
  render(popup(true))

  // The popup never passes onCwdChange to Body, so a `cd` in the burner shell
  // emits OSC 7 but moves nothing in the host pane/session (spec §6, invariant 5).
  expect(screen.getByTestId('body-stub')).toHaveAttribute(
    'data-has-on-cwd-change',
    'no'
  )
})

test('stays mounted (hidden) when dismissed — not unmounted', () => {
  const { rerender } = render(popup(true))
  const node = screen.getByTestId('burner-body')

  rerender(popup(false))

  expect(screen.getByTestId('burner-body')).toBe(node) // same node, still mounted
  expect(screen.getByTestId('burner-popup')).toHaveAttribute(
    'aria-hidden',
    'true'
  )
})

test('drains the buffer through the provided onPaneReady when Body attaches', () => {
  const onPaneReady = vi.fn(() => vi.fn())

  render(popup(true, { onPaneReady }))
  const handler = vi.fn()
  act(() => {
    captured.onPaneReady?.('burner-pty', handler)
  })

  expect(onPaneReady).toHaveBeenCalledWith('burner-pty', handler)
})

test('focuses the burner terminal when shown', () => {
  const { rerender } = render(popup(false))
  expect(focusTerminal).not.toHaveBeenCalled()

  rerender(popup(true))

  expect(focusTerminal).toHaveBeenCalled()
})

test('focuses once the terminal attaches on first open', () => {
  render(popup(true))
  focusTerminal.mockClear() // ignore the show-effect's eager focus

  act(() => {
    captured.onPaneReady?.('burner-pty', vi.fn())
  })

  expect(focusTerminal).toHaveBeenCalled()
})

test('does not focus when Body attaches while the popup is hidden', () => {
  render(popup(false))
  focusTerminal.mockClear()

  act(() => {
    captured.onPaneReady?.('burner-pty', vi.fn())
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

  fireEvent.keyDown(screen.getByTestId('burner-popup'), { key: 'Escape' })

  expect(onHide).not.toHaveBeenCalled()
})

test('renders the align-to-directory button only when onAlignCwd is provided', () => {
  const { rerender } = render(popup(true))

  // No alignment affordance until the host pane's live cwd can be resolved.
  expect(
    screen.queryByRole('button', { name: /align burner to pane directory/i })
  ).toBeNull()

  rerender(popup(true, { onAlignCwd: vi.fn() }))

  expect(
    screen.getByRole('button', { name: /align burner to pane directory/i })
  ).toBeInTheDocument()
})

test('clicking the align button calls onAlignCwd', () => {
  const onAlignCwd = vi.fn()
  render(popup(true, { onAlignCwd }))

  fireEvent.click(
    screen.getByRole('button', { name: /align burner to pane directory/i })
  )

  expect(onAlignCwd).toHaveBeenCalledTimes(1)
})

test('disables the align button while the burner is busy', () => {
  const { rerender } = render(popup(true, { onAlignCwd: vi.fn() }))

  // Idle burner: the align button is available.
  expect(
    screen.getByRole('button', { name: /align burner to pane directory/i })
  ).not.toBeDisabled()

  // A foreground command is running — a `cd` would hit its stdin, so disable.
  rerender(popup(true, { onAlignCwd: vi.fn(), alignBusy: true }))

  expect(
    screen.getByRole('button', { name: /align burner to pane directory/i })
  ).toBeDisabled()
})

test('refocuses the burner terminal after aligning so typing continues there', () => {
  const onAlignCwd = vi.fn()
  render(popup(true, { onAlignCwd }))
  focusTerminal.mockClear() // ignore the eager show-effect focus

  fireEvent.click(
    screen.getByRole('button', { name: /align burner to pane directory/i })
  )

  // The button took focus on click; hand it back to xterm so keys land there.
  expect(onAlignCwd).toHaveBeenCalledTimes(1)
  expect(focusTerminal).toHaveBeenCalled()
})

test('blurs the active element when hidden so focus does not remain on a hidden terminal', () => {
  const { rerender } = render(popup(true))

  const dismissButton = screen.getByRole('button', {
    name: /dismiss burner terminal/i,
  })
  dismissButton.focus()

  expect(dismissButton).toHaveFocus()

  rerender(popup(false))

  expect(dismissButton).not.toHaveFocus()
})

test('exposes aria-modal on the dialog when open', () => {
  const { rerender } = render(popup(true))

  expect(screen.getByTestId('burner-popup')).toHaveAttribute(
    'aria-modal',
    'true'
  )

  rerender(popup(false))

  expect(screen.getByTestId('burner-popup')).toHaveAttribute(
    'aria-modal',
    'false'
  )
})

test('backdrop dismiss button is removed from the tab order', () => {
  render(popup(true))

  expect(
    screen.getByRole('button', { name: /dismiss burner terminal/i })
  ).toHaveAttribute('tabIndex', '-1')
})

test('Tab from terminal traps focus to the first button', () => {
  render(popup(true, { onAlignCwd: vi.fn() }))

  const textarea = screen.getByTestId('xterm-textarea')
  textarea.focus()
  expect(textarea).toHaveFocus()

  fireEvent.keyDown(textarea, { key: 'Tab' })

  expect(
    screen.getByRole('button', { name: /align burner to pane directory/i })
  ).toHaveFocus()
})

test('Tab from last button wraps focus back to the terminal', () => {
  render(popup(true, { onAlignCwd: vi.fn() }))
  focusTerminal.mockClear()

  const hideBtn = screen.getByRole('button', { name: /hide burner terminal/i })
  hideBtn.focus()
  expect(hideBtn).toHaveFocus()

  fireEvent.keyDown(hideBtn, { key: 'Tab' })

  expect(focusTerminal).toHaveBeenCalledTimes(1)
})

test('Shift+Tab from first button wraps focus back to the terminal', () => {
  render(popup(true, { onAlignCwd: vi.fn() }))
  focusTerminal.mockClear()

  const alignBtn = screen.getByRole('button', {
    name: /align burner to pane directory/i,
  })
  alignBtn.focus()
  expect(alignBtn).toHaveFocus()

  fireEvent.keyDown(alignBtn, { key: 'Tab', shiftKey: true })

  expect(focusTerminal).toHaveBeenCalledTimes(1)
})

test('Shift+Tab from terminal traps focus to the last button', () => {
  render(popup(true, { onAlignCwd: vi.fn() }))

  const textarea = screen.getByTestId('xterm-textarea')
  textarea.focus()
  expect(textarea).toHaveFocus()

  fireEvent.keyDown(textarea, { key: 'Tab', shiftKey: true })

  expect(
    screen.getByRole('button', { name: /hide burner terminal/i })
  ).toHaveFocus()
})

test('Tab cycles between terminal and hide button when align is absent', () => {
  render(popup(true))
  focusTerminal.mockClear()

  const textarea = screen.getByTestId('xterm-textarea')
  textarea.focus()

  fireEvent.keyDown(textarea, { key: 'Tab' })

  expect(
    screen.getByRole('button', { name: /hide burner terminal/i })
  ).toHaveFocus()

  fireEvent.keyDown(
    screen.getByRole('button', { name: /hide burner terminal/i }),
    { key: 'Tab' }
  )

  expect(focusTerminal).toHaveBeenCalledTimes(1)
})

test('Tab does nothing while the popup is hidden', () => {
  const onHide = vi.fn()
  render(popup(false, { onHide }))

  fireEvent.keyDown(screen.getByTestId('burner-popup'), { key: 'Tab' })

  expect(onHide).not.toHaveBeenCalled()
})

test('Tab from a disabled align button traps focus to the next valid target', () => {
  const { rerender } = render(popup(true, { onAlignCwd: vi.fn() }))

  const alignBtn = screen.getByRole('button', {
    name: /align burner to pane directory/i,
  })
  alignBtn.focus()
  expect(alignBtn).toHaveFocus()

  // Simulate alignBusy becoming true while the button still holds focus.
  rerender(popup(true, { onAlignCwd: vi.fn(), alignBusy: true }))

  fireEvent.keyDown(alignBtn, { key: 'Tab' })

  expect(
    screen.getByRole('button', { name: /hide burner terminal/i })
  ).toHaveFocus()
})

test('Shift+Tab from a disabled align button traps focus to the last valid target', () => {
  const { rerender } = render(popup(true, { onAlignCwd: vi.fn() }))

  const alignBtn = screen.getByRole('button', {
    name: /align burner to pane directory/i,
  })
  alignBtn.focus()
  expect(alignBtn).toHaveFocus()

  // Simulate alignBusy becoming true while the button still holds focus.
  rerender(popup(true, { onAlignCwd: vi.fn(), alignBusy: true }))

  fireEvent.keyDown(alignBtn, { key: 'Tab', shiftKey: true })

  // When the previously-focused element is no longer in the focusable list,
  // Shift+Tab falls back to the last valid focus target.
  expect(
    screen.getByRole('button', { name: /hide burner terminal/i })
  ).toHaveFocus()
})

import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import type { ReactElement } from 'react'
import { BurnerTerminalPopup } from './index'
import type { ITerminalService } from '../../services/terminalService'
import type { NotifyPaneReady } from '../../hooks/useTerminal'

// Body owns the terminal renderer instance, which jsdom can't render. Stub it
// as a forwardRef exposing a focusTerminal spy and capturing the onPaneReady it
// receives, so the popup's focus + drain wiring is unit-tested in isolation;
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
          {/* Terminal renderers typically own an input element; keep one in the
              stub so focus-trap tests can simulate the terminal holding focus. */}
          <textarea data-testid="terminal-input" />
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
    onCwdChange?: (cwd: string) => void
    outOfSync?: boolean
  } = {}
): ReactElement => <BurnerTerminalPopup open={open} {...baseProps} {...extra} />

const dispatchTabFrom = (
  target: HTMLElement,
  init: KeyboardEventInit = {}
): {
  terminalKeyDown: ReturnType<typeof vi.fn>
  preventDefaultSpy: ReturnType<typeof vi.spyOn>
  stopPropagationSpy: ReturnType<typeof vi.spyOn>
} => {
  const terminalKeyDown = vi.fn()
  target.addEventListener('keydown', terminalKeyDown)

  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    bubbles: true,
    cancelable: true,
    ...init,
  })
  const preventDefaultSpy = vi.spyOn(event, 'preventDefault')
  const stopPropagationSpy = vi.spyOn(event, 'stopPropagation')

  target.dispatchEvent(event)

  return { terminalKeyDown, preventDefaultSpy, stopPropagationSpy }
}

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

test('forwards onCwdChange to Body for burner cwd tracking (isolation stays hook-level)', () => {
  // No onCwdChange wired by default.
  const { rerender } = render(popup(true))
  expect(screen.getByTestId('body-stub')).toHaveAttribute(
    'data-has-on-cwd-change',
    'no'
  )

  // With onCwdChange the popup forwards it to Body so the burner's own cwd can
  // be tracked (VIM-94). The hook routes it to the burner's `currentCwd`, never
  // to updatePaneCwd, so a `cd` in the burner still moves nothing in the host
  // pane/session (spec §6, invariant 5).
  rerender(popup(true, { onCwdChange: vi.fn() }))
  expect(screen.getByTestId('body-stub')).toHaveAttribute(
    'data-has-on-cwd-change',
    'yes'
  )
})

test('highlights the align button amber when the burner is out of sync', () => {
  // In sync (default): muted, no amber.
  const { rerender } = render(popup(true, { onAlignCwd: vi.fn() }))

  const inSync = screen.getByRole('button', {
    name: /align burner to pane directory/i,
  })
  expect(inSync.className).toContain('text-on-surface-muted')
  expect(inSync.className).not.toContain('agent-shell-accent')

  // Out of sync: amber tint signals the burner wandered from its host pane.
  rerender(popup(true, { onAlignCwd: vi.fn(), outOfSync: true }))

  const drift = screen.getByRole('button', {
    name: /align burner to pane directory/i,
  })
  expect(drift.className).toContain('var(--color-agent-shell-accent)')
  expect(drift.className).toContain('text-[var(--color-agent-shell-accent)]')
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
  // the capture listener must intercept before the keydown reaches the renderer.
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

  // The button took focus on click; hand it back to the terminal so keys land there.
  expect(onAlignCwd).toHaveBeenCalledTimes(1)
  expect(focusTerminal).toHaveBeenCalled()
})

test('restores focus to the previously focused element when hidden', () => {
  // Simulate a workspace pane holding focus before the popup opens.
  const prior = document.createElement('button')
  prior.setAttribute('data-testid', 'prior-focus')
  document.body.appendChild(prior)
  prior.focus()
  expect(prior).toHaveFocus()

  const { rerender } = render(popup(true))

  // Opening the popup saved the prior focus and moved focus into the terminal.
  expect(focusTerminal).toHaveBeenCalled()

  rerender(popup(false))

  // Closing restores focus to the element that had it before the popup opened.
  expect(prior).toHaveFocus()

  document.body.removeChild(prior)
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

test('Tab from terminal passes through for shell autocomplete', () => {
  render(popup(true, { onAlignCwd: vi.fn() }))

  const textarea = screen.getByTestId('terminal-input')
  textarea.focus()
  expect(textarea).toHaveFocus()

  const { terminalKeyDown, preventDefaultSpy, stopPropagationSpy } =
    dispatchTabFrom(textarea)

  expect(terminalKeyDown).toHaveBeenCalledTimes(1)
  expect(preventDefaultSpy).not.toHaveBeenCalled()
  expect(stopPropagationSpy).not.toHaveBeenCalled()
  expect(textarea).toHaveFocus()
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

test('Shift+Tab from terminal passes through to the renderer', () => {
  render(popup(true, { onAlignCwd: vi.fn() }))

  const textarea = screen.getByTestId('terminal-input')
  textarea.focus()
  expect(textarea).toHaveFocus()

  const { terminalKeyDown, preventDefaultSpy, stopPropagationSpy } =
    dispatchTabFrom(textarea, { shiftKey: true })

  expect(terminalKeyDown).toHaveBeenCalledTimes(1)
  expect(preventDefaultSpy).not.toHaveBeenCalled()
  expect(stopPropagationSpy).not.toHaveBeenCalled()
  expect(textarea).toHaveFocus()
})

test('Tab from hide button wraps focus back to the terminal when align is absent', () => {
  render(popup(true))
  focusTerminal.mockClear()

  const hideBtn = screen.getByRole('button', { name: /hide burner terminal/i })
  hideBtn.focus()
  expect(hideBtn).toHaveFocus()

  fireEvent.keyDown(hideBtn, { key: 'Tab' })

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

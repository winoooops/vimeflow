import { test, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { ScratchTerminalPopup } from './index'
import type { ITerminalService } from '../../services/terminalService'
import type { NotifyPaneReady } from '../../hooks/useTerminal'
import type { ScratchPanePill } from '../../hooks/useScratchTerminals'

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

test('does not wire OSC 7 → updatePaneCwd, so a scratch cd stays isolated', () => {
  render(popup(true))

  // The popup never passes onCwdChange to Body, so a `cd` in the scratch shell
  // emits OSC 7 but moves nothing in the host pane/session (spec §6, invariant 5).
  expect(screen.getByTestId('body-stub')).toHaveAttribute(
    'data-has-on-cwd-change',
    'no'
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

const makePill = (
  label: string,
  paneId: string,
  running = false
): ScratchPanePill => ({
  key: `s1:${paneId}`,
  target: { sessionId: 's1', paneId, cwd: '/repo' },
  label,
  running,
})

test('renders pane-switcher pills and selects a pane on click', () => {
  const onSelectPane = vi.fn()

  render(
    <ScratchTerminalPopup
      open
      {...baseProps}
      panes={[makePill('1', 'p0', true), makePill('2', 'p1')]}
      activeKey="s1:p0"
      onSelectPane={onSelectPane}
    />
  )

  const pills = within(screen.getByTestId('scratch-pane-pills')).getAllByRole(
    'button'
  )
  expect(pills).toHaveLength(2)
  // The active pane's pill is pressed; the running pane's pill reads "running".
  expect(
    screen.getByRole('button', { name: /scratch pane 1 \(running\)/i })
  ).toHaveAttribute('aria-pressed', 'true')

  fireEvent.click(screen.getByRole('button', { name: 'scratch pane 2' }))

  expect(onSelectPane).toHaveBeenCalledWith({
    sessionId: 's1',
    paneId: 'p1',
    cwd: '/repo',
  })
})

test('omits the pills row for a single-pane session', () => {
  render(
    <ScratchTerminalPopup open {...baseProps} panes={[makePill('1', 'p0')]} />
  )

  expect(screen.queryByTestId('scratch-pane-pills')).toBeNull()
})

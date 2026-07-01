// cspell:ignore ghostty Ghostty
import { act, render, screen, waitFor } from '@testing-library/react'
import {
  forwardRef,
  useImperativeHandle,
  type ForwardedRef,
  type ReactElement,
} from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { NativeGhosttyShortcutContext } from '../../nativeGhosttyClient'
import type { ITerminalService } from '../../services/terminalService'
import { TerminalBody } from './TerminalBody'

const nativeMocks = vi.hoisted(() => ({
  focusNativeGhostty: vi.fn(() => Promise.resolve()),
  shouldUseNativeGhostty: vi.fn(),
}))

const bodyMocks = vi.hoisted(() => ({
  ghosttyProps: null as {
    onUnavailable?: () => void
    onRequestFocus?: () => void
    shortcutContext?: NativeGhosttyShortcutContext
  } | null,
  xtermFocus: vi.fn(),
}))

vi.mock('../../nativeGhosttyClient', () => nativeMocks)

vi.mock('./GhosttyBody', () => {
  const MockGhosttyBody = ({
    onUnavailable = undefined,
    onRequestFocus = undefined,
    shortcutContext = undefined,
  }: {
    onUnavailable?: () => void
    onRequestFocus?: () => void
    shortcutContext?: NativeGhosttyShortcutContext
  }): ReactElement => {
    bodyMocks.ghosttyProps = {
      onUnavailable,
      onRequestFocus,
      shortcutContext,
    }

    return <div data-testid="ghostty-body" />
  }
  MockGhosttyBody.displayName = 'MockGhosttyBody'

  return { GhosttyBody: MockGhosttyBody }
})

vi.mock('./Body', () => {
  const MockBody = forwardRef(
    (
      _props: unknown,
      ref: ForwardedRef<{ focusTerminal: () => void }>
    ): ReactElement => {
      useImperativeHandle(ref, () => ({
        focusTerminal: bodyMocks.xtermFocus,
      }))

      return <div data-testid="xterm-body" />
    }
  )
  MockBody.displayName = 'MockBody'

  return { Body: MockBody }
})

const createService = (): ITerminalService => ({}) as ITerminalService
const deferFit = false
const enableImagePaste = false

describe('TerminalBody', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    bodyMocks.ghosttyProps = null
    nativeMocks.shouldUseNativeGhostty.mockReturnValue(true)
  })

  test('falls back to xterm when native Ghostty is unavailable', async () => {
    render(
      <TerminalBody
        paneId="pane-1"
        ptyId="pty-1"
        cwd="/tmp"
        active
        service={createService()}
        mode="attach"
        deferFit={deferFit}
        enableImagePaste={enableImagePaste}
      />
    )

    expect(screen.getByTestId('ghostty-body')).toBeInTheDocument()

    act(() => {
      bodyMocks.ghosttyProps?.onUnavailable?.()
    })

    await waitFor(() => {
      expect(screen.getByTestId('xterm-body')).toBeInTheDocument()
    })
  })

  test('passes shortcut context to native Ghostty body', () => {
    const shortcutContext = { paneIds: ['p0', 'p1'], activePaneId: 'p0' }
    const onRequestFocus = vi.fn()

    render(
      <TerminalBody
        paneId="pane-1"
        ptyId="pty-1"
        cwd="/tmp"
        active
        service={createService()}
        onRequestFocus={onRequestFocus}
        shortcutContext={shortcutContext}
        mode="attach"
        deferFit={deferFit}
        enableImagePaste={enableImagePaste}
      />
    )

    expect(bodyMocks.ghosttyProps?.shortcutContext).toEqual(shortcutContext)
    expect(bodyMocks.ghosttyProps?.onRequestFocus).toBe(onRequestFocus)
  })

  test('falls back to xterm when imperative native focus rejects', async () => {
    nativeMocks.focusNativeGhostty.mockRejectedValueOnce(
      new Error('ipc unavailable')
    )
    const ref = { current: null as { focusTerminal: () => void } | null }

    render(
      <TerminalBody
        ref={ref}
        paneId="pane-1"
        ptyId="pty-1"
        cwd="/tmp"
        active
        service={createService()}
        mode="attach"
        deferFit={deferFit}
        enableImagePaste={enableImagePaste}
      />
    )

    act(() => {
      ref.current?.focusTerminal()
    })

    await waitFor(() => {
      expect(screen.getByTestId('xterm-body')).toBeInTheDocument()
    })
  })
})

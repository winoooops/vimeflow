import { act, render, screen, waitFor } from '@testing-library/react'
import { forwardRef, useImperativeHandle } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ITerminalService } from '../../services/terminalService'
import { TerminalBody } from './TerminalBody'

const nativeMocks = vi.hoisted(() => ({
  focusNativeGhostty: vi.fn(() => Promise.resolve()),
  shouldUseNativeGhostty: vi.fn(),
}))

const bodyMocks = vi.hoisted(() => ({
  ghosttyProps: null as { onUnavailable?: () => void } | null,
  xtermFocus: vi.fn(),
}))

vi.mock('../../nativeGhosttyClient', () => nativeMocks)

vi.mock('./GhosttyBody', () => ({
  GhosttyBody: (props: { onUnavailable?: () => void }) => {
    bodyMocks.ghosttyProps = props

    return <div data-testid="ghostty-body" />
  },
}))

vi.mock('./Body', () => ({
  Body: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => ({
      focusTerminal: bodyMocks.xtermFocus,
    }))

    return <div data-testid="xterm-body" />
  }),
}))

const createService = (): ITerminalService => ({}) as ITerminalService

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
        deferFit={false}
        enableImagePaste={false}
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
})

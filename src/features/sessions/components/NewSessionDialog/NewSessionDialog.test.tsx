import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { BUILTIN_PANE_LAYOUT_REGISTRY } from '../../../terminal/layout-registry'
import { NewSessionDialog } from './NewSessionDialog'

interface CapturedNativeOverlayRequest {
  surfaceId: string
  payload: Record<string, unknown>
}

const setup = (
  overrides: Partial<Parameters<typeof NewSessionDialog>[0]> = {}
): {
  onCreate: ReturnType<typeof vi.fn>
  onOpenChange: ReturnType<typeof vi.fn>
} => {
  const onCreate = vi.fn()
  const onOpenChange = vi.fn()

  render(
    <NewSessionDialog
      open
      onOpenChange={onOpenChange}
      onCreate={onCreate}
      defaultCwd="~/code/vimeflow-core"
      layoutRegistry={BUILTIN_PANE_LAYOUT_REGISTRY}
      {...overrides}
    />
  )

  return { onCreate, onOpenChange }
}

const renderWithOpen = (
  open: boolean,
  cwd: string
): ReturnType<typeof render> =>
  render(
    <NewSessionDialog
      open={open}
      onOpenChange={vi.fn()}
      onCreate={vi.fn()}
      defaultCwd={cwd}
      layoutRegistry={BUILTIN_PANE_LAYOUT_REGISTRY}
    />
  )

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
  resume: ReturnType<typeof vi.fn>
  emitAction: (event: unknown) => void
} => {
  let actionListener: ((event: unknown) => void) | null = null
  const open = vi.fn(() => Promise.resolve({ accepted: true }))
  const resume = vi.fn(() => Promise.resolve())

  window.vimeflow = {
    invoke: <T,>(): Promise<T> => Promise.resolve(null as T),
    listen: vi.fn(() => Promise.resolve(vi.fn())),
    nativeOverlay: {
      open,
      close: vi.fn(() => Promise.resolve()),
      actionResult: vi.fn(() => Promise.resolve()),
      resume,
      onAction: vi.fn((callback: (event: unknown) => void) => {
        actionListener = callback

        return vi.fn()
      }),
      onClose: vi.fn(() => vi.fn()),
    },
  }

  return {
    open,
    resume,
    emitAction: (event): void => {
      actionListener?.(event)
    },
  }
}

const isCapturedNativeOverlayRequest = (
  value: unknown
): value is CapturedNativeOverlayRequest =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  typeof (value as { surfaceId?: unknown }).surfaceId === 'string' &&
  typeof (value as { payload?: unknown }).payload === 'object' &&
  (value as { payload?: unknown }).payload !== null &&
  !Array.isArray((value as { payload?: unknown }).payload)

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  restorePlatform?.()
  restorePlatform = null
  delete window.vimeflow
})

describe('NewSessionDialog', () => {
  test('opens as a dialog named "New session"', () => {
    setup()
    expect(
      screen.getByRole('dialog', { name: /new session/i })
    ).toBeInTheDocument()
  })

  test('name prefills from the default folder basename', () => {
    setup()
    expect(screen.getByRole('textbox', { name: /session name/i })).toHaveValue(
      'vimeflow-core'
    )
  })

  test('reopening with a new defaultCwd refreshes path + name', () => {
    const closed = false
    const opened = true
    const { rerender } = renderWithOpen(closed, '~/code/alpha')

    rerender(
      <NewSessionDialog
        open={opened}
        onOpenChange={vi.fn()}
        onCreate={vi.fn()}
        defaultCwd="~/code/beta"
        layoutRegistry={BUILTIN_PANE_LAYOUT_REGISTRY}
      />
    )

    expect(screen.getByRole('textbox', { name: /session name/i })).toHaveValue(
      'beta'
    )
  })

  test('Create emits onCreate with name, cwd, layout and panes', async () => {
    const { onCreate } = setup()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /create session/i }))
    expect(onCreate).toHaveBeenCalledWith({
      name: 'vimeflow-core',
      cwd: '~/code/vimeflow-core',
      layout: 'single',
      panes: [{ command: 'claude' }],
    })
  })

  test('Cancel closes without creating', async () => {
    const { onCreate, onOpenChange } = setup()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onCreate).not.toHaveBeenCalled()
  })

  test('typing a name then reset restores the folder basename', async () => {
    setup()
    const user = userEvent.setup()
    const input = screen.getByRole('textbox', { name: /session name/i })
    await user.clear(input)
    await user.type(input, 'custom')
    await user.click(screen.getByRole('button', { name: /reset/i }))
    expect(input).toHaveValue('vimeflow-core')
  })

  // Regression guard for the z-index bug: a pane's command Menu must be
  // reachable from inside the popover. Open the dialog, pick a command for a
  // pane, and confirm the assignment lands in the created session. (jsdom does
  // not evaluate z-index, but this proves the click wiring is intact.)
  test('a pane command is selectable end-to-end', async () => {
    const { onCreate } = setup()
    const user = userEvent.setup()

    const paneButton = screen.getByRole('button', {
      name: /choose command for pane 1/i,
    })
    await user.click(paneButton)
    await user.click(screen.getByRole('menuitem', { name: /codex cli/i }))

    // The chosen command is reflected on the pane button label.
    expect(within(paneButton).getByText(/codex cli/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /create session/i }))
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        panes: [{ command: 'codex' }],
      })
    )
  })

  test('Create falls back to the path basename when the name is blank', async () => {
    const { onCreate } = setup()
    const user = userEvent.setup()
    const input = screen.getByRole('textbox', { name: /session name/i })

    await user.clear(input)
    await user.type(input, '   ')
    await user.click(screen.getByRole('button', { name: /create session/i }))

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'vimeflow-core',
      })
    )
  })

  test('does not reset edited fields when defaultCwd changes while open', async () => {
    const user = userEvent.setup()
    const { rerender } = renderWithOpen(true, '~/code/alpha')
    const input = screen.getByRole('textbox', { name: /session name/i })

    await user.clear(input)
    await user.type(input, 'custom name')

    rerender(
      <NewSessionDialog
        open
        onOpenChange={vi.fn()}
        onCreate={vi.fn()}
        defaultCwd="~/code/beta"
        layoutRegistry={BUILTIN_PANE_LAYOUT_REGISTRY}
      />
    )

    expect(input).toHaveValue('custom name')
  })

  test('serializes native overlay state and handles overlay actions', async () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const bridge = installNativeOverlayBridge()
    const { onCreate } = setup({ nativeOverlay: true })

    await waitFor(() => {
      expect(bridge.open).toHaveBeenCalled()
    })

    const initialRequest = bridge.open.mock.calls[0]?.[0]
    if (!isCapturedNativeOverlayRequest(initialRequest)) {
      throw new Error('expected native overlay request')
    }

    expect(initialRequest.payload).toMatchObject({
      kind: 'dialog',
      dialog: 'new-session',
      name: 'vimeflow-core',
      path: '~/code/vimeflow-core',
      selectedLayoutId: 'single',
    })

    const surfaceId = initialRequest.surfaceId

    act(() => {
      bridge.emitAction({
        surfaceId,
        actionId: 'new-session:pick-layout:vsplit',
      })
    })

    await waitFor(() => {
      const latestRequest =
        bridge.open.mock.calls[bridge.open.mock.calls.length - 1]?.[0]
      expect(latestRequest).toMatchObject({
        payload: { selectedLayoutId: 'vsplit' },
      })
    })

    act(() => {
      bridge.emitAction({
        surfaceId,
        actionId: 'new-session:pick-command:1:codex',
      })
    })

    await waitFor(() => {
      const latestRequest =
        bridge.open.mock.calls[bridge.open.mock.calls.length - 1]?.[0]
      expect(latestRequest).toMatchObject({
        payload: {
          panes: [{ commandId: 'claude' }, { commandId: 'codex' }],
        },
      })
    })

    act(() => {
      bridge.emitAction({
        surfaceId,
        actionId: 'new-session:browse',
      })
    })

    await waitFor(() => {
      expect(bridge.resume).toHaveBeenCalledWith({ surfaceId })
    })

    act(() => {
      bridge.emitAction({
        surfaceId,
        actionId: 'new-session:create',
      })
    })

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith({
        name: 'vimeflow-core',
        cwd: '~/code/vimeflow-core',
        layout: 'vsplit',
        panes: [{ command: 'claude' }, { command: 'codex' }],
      })
    })
  })
})

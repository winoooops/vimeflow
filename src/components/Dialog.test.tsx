import { createRef, useState, type ReactElement } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { __resetNativeOverlayForTest } from '@/components/base/floating/nativeOverlay'
import { Dialog, type NativeOverlayCommandPaletteDialogPayload } from './Dialog'

const nativeDialogPayload: NativeOverlayCommandPaletteDialogPayload = {
  kind: 'dialog',
  dialog: 'command-palette',
  ariaLabel: 'Command palette',
  query: ':',
  selectedIndex: 0,
  results: [
    {
      id: 'help',
      label: ':help',
      description: 'Show help',
      icon: 'help',
    },
  ],
  actions: {
    selectIndex: 'command-palette:select-index',
    executeIndex: 'command-palette:execute-index',
  },
}

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

const installNativeOverlayBridge = (
  accepted: boolean
): {
  open: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
} => {
  const open = vi.fn(() => Promise.resolve({ accepted }))
  const close = vi.fn(() => Promise.resolve())

  window.vimeflow = {
    invoke: <T,>(): Promise<T> => Promise.resolve(null as T),
    listen: vi.fn(() => Promise.resolve(vi.fn())),
    nativeOverlay: {
      open,
      close,
      actionResult: vi.fn(() => Promise.resolve()),
      onAction: vi.fn(() => vi.fn()),
      onClose: vi.fn(() => vi.fn()),
    },
  }

  return { open, close }
}

afterEach(() => {
  __resetNativeOverlayForTest()
  vi.unstubAllEnvs()
  restorePlatform?.()
  restorePlatform = null
  delete window.vimeflow
})

describe('Dialog', () => {
  test('renders nothing when open is false', () => {
    const open = false

    render(
      <Dialog open={open} onOpenChange={vi.fn()} aria-label="Settings">
        <p>Hidden body</p>
      </Dialog>
    )

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText('Hidden body')).not.toBeInTheDocument()
  })

  test('renders children with modal dialog aria wiring', () => {
    render(
      <Dialog open onOpenChange={vi.fn()} aria-label="Settings">
        <p>Dialog body</p>
      </Dialog>
    )

    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('Dialog body')).toBeInTheDocument()
  })

  test('hides local dialog while native overlay is active and closes on unmount', async () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const bridge = installNativeOverlayBridge(true)

    const { unmount } = render(
      <Dialog
        open
        nativeOverlay
        nativeOverlayPayload={nativeDialogPayload}
        onOpenChange={vi.fn()}
        aria-label="Command palette"
      >
        <p>Local body</p>
      </Dialog>
    )

    const dialog = screen.getByRole('dialog', { name: 'Command palette' })

    await waitFor(() => {
      expect(bridge.open).toHaveBeenCalledOnce()
      expect(dialog).toHaveClass('opacity-0')
    })

    const request = bridge.open.mock.calls[0]?.[0] as
      | { surfaceId: string }
      | undefined

    if (request === undefined) {
      throw new Error('expected native overlay open request')
    }

    const surfaceId = request.surfaceId
    unmount()

    expect(bridge.close).toHaveBeenCalledWith({
      surfaceId,
      reason: 'renderer',
    })
  })

  test('keeps local dialog visible when native overlay is rejected', async () => {
    vi.stubEnv('VITE_NATIVE_OVERLAY', '1')
    setNavigatorPlatform('MacIntel')
    const bridge = installNativeOverlayBridge(false)

    render(
      <Dialog
        open
        nativeOverlay
        nativeOverlayPayload={nativeDialogPayload}
        onOpenChange={vi.fn()}
        aria-label="Command palette"
      >
        <p>Local body</p>
      </Dialog>
    )

    const dialog = screen.getByRole('dialog', { name: 'Command palette' })

    await waitFor(() => {
      expect(bridge.open).toHaveBeenCalledOnce()
      expect(dialog).not.toHaveClass('opacity-0')
      expect(screen.getByText('Local body')).toBeInTheDocument()
    })
  })

  test('supports aria-labelledby and aria-describedby wiring', () => {
    render(
      <Dialog
        open
        onOpenChange={vi.fn()}
        aria-labelledby="dialog-title"
        aria-describedby="dialog-description"
      >
        <Dialog.Header>
          <h2 id="dialog-title">Unsaved Changes</h2>
        </Dialog.Header>
        <Dialog.Body>
          <p id="dialog-description">example.ts has unsaved changes.</p>
        </Dialog.Body>
      </Dialog>
    )

    expect(
      screen.getByRole('dialog', {
        name: 'Unsaved Changes',
        description: /example\.ts/,
      })
    ).toBeInTheDocument()
  })

  test('calls onOpenChange(false) when backdrop is clicked', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    render(
      <Dialog
        open
        onOpenChange={onOpenChange}
        aria-label="Command palette"
        backdropTestId="dialog-backdrop"
      >
        <button type="button">Inside</button>
      </Dialog>
    )

    const backdrop = screen.getByTestId('dialog-backdrop')
    expect(backdrop).toHaveClass('bg-scrim/40')

    await user.click(backdrop)

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('does not dismiss from backdrop when closeOnBackdrop is false', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const closeOnBackdrop = false

    render(
      <Dialog
        open
        closeOnBackdrop={closeOnBackdrop}
        onOpenChange={onOpenChange}
        aria-label="Command palette"
        backdropTestId="dialog-backdrop"
      >
        <button type="button">Inside</button>
      </Dialog>
    )

    await user.click(screen.getByTestId('dialog-backdrop'))

    expect(onOpenChange).not.toHaveBeenCalled()
  })

  test('calls onOpenChange(false) when Escape is pressed', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    render(
      <Dialog open onOpenChange={onOpenChange} aria-label="Settings">
        <button type="button">Inside</button>
      </Dialog>
    )

    await user.keyboard('{Escape}')

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  test('does not dismiss from Escape while dismiss is disabled', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()

    render(
      <Dialog
        open
        dismissDisabled
        onOpenChange={onOpenChange}
        aria-label="Settings"
      >
        <button type="button">Inside</button>
      </Dialog>
    )

    await user.keyboard('{Escape}')

    expect(onOpenChange).not.toHaveBeenCalled()
  })

  test('closes only the topmost dialog when multiple dialogs are open', async () => {
    const user = userEvent.setup()
    const onCloseBottom = vi.fn()
    const onCloseTop = vi.fn()

    render(
      <>
        <Dialog open onOpenChange={onCloseBottom} aria-label="Bottom">
          <button type="button">Bottom</button>
        </Dialog>
        <Dialog open onOpenChange={onCloseTop} aria-label="Top">
          <button type="button">Top</button>
        </Dialog>
      </>
    )

    await user.keyboard('{Escape}')

    expect(onCloseTop).toHaveBeenCalledWith(false)
    expect(onCloseBottom).not.toHaveBeenCalled()
  })

  test('does not propagate Escape to a lower dialog when topmost is dismiss-disabled', async () => {
    const user = userEvent.setup()
    const onCloseBottom = vi.fn()
    const onCloseTop = vi.fn()

    render(
      <>
        <Dialog open onOpenChange={onCloseBottom} aria-label="Bottom">
          <button type="button">Bottom</button>
        </Dialog>
        <Dialog open dismissDisabled onOpenChange={onCloseTop} aria-label="Top">
          <button type="button">Top</button>
        </Dialog>
      </>
    )

    await user.keyboard('{Escape}')

    expect(onCloseTop).not.toHaveBeenCalled()
    expect(onCloseBottom).not.toHaveBeenCalled()
  })

  test('does not propagate Escape to a lower dialog when topmost has closeOnEscape disabled', async () => {
    const user = userEvent.setup()
    const onCloseBottom = vi.fn()
    const onCloseTop = vi.fn()

    render(
      <>
        <Dialog open onOpenChange={onCloseBottom} aria-label="Bottom">
          <button type="button">Bottom</button>
        </Dialog>
        <Dialog
          open
          // eslint-disable-next-line react/jsx-boolean-value -- closeOnEscape defaults to true; explicit false is required for this regression test
          closeOnEscape={false}
          onOpenChange={onCloseTop}
          aria-label="Top"
        >
          <button type="button">Top</button>
        </Dialog>
      </>
    )

    await user.keyboard('{Escape}')

    expect(onCloseTop).not.toHaveBeenCalled()
    expect(onCloseBottom).not.toHaveBeenCalled()
  })

  test('moves focus to initialFocusRef on open', async () => {
    const initialFocusRef = createRef<HTMLButtonElement>()

    render(
      <Dialog
        open
        onOpenChange={vi.fn()}
        initialFocusRef={initialFocusRef}
        aria-label="Unsaved Changes"
      >
        <button type="button">Save</button>
        <button ref={initialFocusRef} type="button">
          Cancel
        </button>
      </Dialog>
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    )
  })

  test('moves focus to first focusable child when no initialFocusRef is supplied', async () => {
    render(
      <Dialog open onOpenChange={vi.fn()} aria-label="Unsaved Changes">
        <button type="button">Save</button>
        <button type="button">Cancel</button>
      </Dialog>
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
    )
  })

  test('traps Tab navigation inside the dialog', async () => {
    const user = userEvent.setup()
    const outside = document.createElement('button')
    outside.textContent = 'Outside'
    document.body.appendChild(outside)

    try {
      render(
        <Dialog open onOpenChange={vi.fn()} aria-label="Settings">
          <button type="button">First</button>
          <button type="button">Second</button>
        </Dialog>
      )

      const dialog = screen.getByRole('dialog', { name: 'Settings' })
      await waitFor(() =>
        expect(
          within(dialog).getByRole('button', { name: 'First' })
        ).toHaveFocus()
      )

      await user.tab()
      expect(
        within(dialog).getByRole('button', { name: 'Second' })
      ).toHaveFocus()

      await user.tab()
      expect(
        within(dialog).getByRole('button', { name: 'First' })
      ).toHaveFocus()
      expect(outside).not.toHaveFocus()
    } finally {
      outside.remove()
    }
  })

  test('includes contenteditable elements in Tab focus trap', async () => {
    const user = userEvent.setup()
    const outside = document.createElement('button')
    outside.textContent = 'Outside'
    document.body.appendChild(outside)

    try {
      render(
        <Dialog open onOpenChange={vi.fn()} aria-label="Settings">
          <button type="button">First</button>
          <div contentEditable role="textbox" aria-label="Editor" />
          <button type="button">Last</button>
        </Dialog>
      )

      const dialog = screen.getByRole('dialog', { name: 'Settings' })
      await waitFor(() =>
        expect(
          within(dialog).getByRole('button', { name: 'First' })
        ).toHaveFocus()
      )

      await user.tab()
      expect(
        within(dialog).getByRole('textbox', { name: 'Editor' })
      ).toHaveFocus()

      await user.tab()
      expect(within(dialog).getByRole('button', { name: 'Last' })).toHaveFocus()

      await user.tab()
      expect(
        within(dialog).getByRole('button', { name: 'First' })
      ).toHaveFocus()
      expect(outside).not.toHaveFocus()
    } finally {
      outside.remove()
    }
  })

  test('restores focus when an open Dialog unmounts', async () => {
    const prior = document.createElement('button')
    prior.textContent = 'Prior'
    document.body.appendChild(prior)
    prior.focus()

    const { unmount } = render(
      <Dialog open onOpenChange={vi.fn()} aria-label="Settings">
        <button type="button">Inside</button>
      </Dialog>
    )

    try {
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Inside' })).toHaveFocus()
      )

      unmount()

      await waitFor(() => expect(prior).toHaveFocus())
    } finally {
      prior.remove()
    }
  })

  test('preserves dialog stack order when a parent re-renders', async () => {
    const user = userEvent.setup()
    const onCloseBottom = vi.fn()
    const onCloseTop = vi.fn()

    const Harness = (): ReactElement => {
      const [, setTick] = useState(0)

      return (
        <>
          <button
            type="button"
            onClick={(): void => setTick((value) => value + 1)}
          >
            Re-render
          </button>
          <Dialog open onOpenChange={onCloseBottom} aria-label="Bottom">
            <button type="button">Bottom</button>
          </Dialog>
          <Dialog open onOpenChange={onCloseTop} aria-label="Top">
            <button type="button">Top</button>
          </Dialog>
        </>
      )
    }

    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Re-render' }))
    await user.keyboard('{Escape}')

    expect(onCloseTop).toHaveBeenCalledWith(false)
    expect(onCloseBottom).not.toHaveBeenCalled()
  })

  test('skips display:none elements when choosing initial focus', async () => {
    render(
      <Dialog open onOpenChange={vi.fn()} aria-label="Settings">
        <button style={{ display: 'none' }} type="button">
          Hidden
        </button>
        <button type="button">Visible</button>
      </Dialog>
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Visible' })).toHaveFocus()
    )
  })

  test('skips visibility:hidden elements when choosing initial focus', async () => {
    render(
      <Dialog open onOpenChange={vi.fn()} aria-label="Settings">
        <button style={{ visibility: 'hidden' }} type="button">
          Hidden
        </button>
        <button type="button">Visible</button>
      </Dialog>
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Visible' })).toHaveFocus()
    )
  })

  test('skips elements inside a display:none ancestor when choosing initial focus', async () => {
    render(
      <Dialog open onOpenChange={vi.fn()} aria-label="Settings">
        <div style={{ display: 'none' }}>
          <button type="button">Hidden</button>
        </div>
        <button type="button">Visible</button>
      </Dialog>
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Visible' })).toHaveFocus()
    )
  })

  test('focuses visible descendants of visibility:hidden ancestors', async () => {
    render(
      <Dialog open onOpenChange={vi.fn()} aria-label="Settings">
        <div style={{ visibility: 'hidden' }}>
          <button style={{ visibility: 'visible' }} type="button">
            Visible
          </button>
        </div>
      </Dialog>
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Visible' })).toHaveFocus()
    )
  })

  test('restores focus to the previously focused element after close', async () => {
    const prior = document.createElement('button')
    prior.textContent = 'Prior'
    document.body.appendChild(prior)
    prior.focus()

    const Harness = (): ReactElement => {
      const [open, setOpen] = useState(true)

      return (
        <Dialog open={open} onOpenChange={setOpen} aria-label="Settings">
          <button type="button" onClick={(): void => setOpen(false)}>
            Close
          </button>
        </Dialog>
      )
    }

    try {
      const user = userEvent.setup()
      render(<Harness />)

      await user.click(screen.getByRole('button', { name: 'Close' }))

      await waitFor(() => expect(prior).toHaveFocus())
    } finally {
      prior.remove()
    }
  })

  test('appends panelClassName to the panel element', () => {
    render(
      <Dialog
        open
        onOpenChange={vi.fn()}
        panelClassName="w-[min(560px,100%)] max-w-none"
        aria-label="New session"
      >
        <span>Body</span>
      </Dialog>
    )
    // eslint-disable-next-line testing-library/no-node-access -- asserting panel chrome class
    const panel = screen.getByText('Body').closest('.max-w-none')
    expect(panel).not.toBeNull()
    expect(panel).toHaveClass('w-[min(560px,100%)]')
  })

  test('applies placement, sizing, and section chrome', () => {
    render(
      <Dialog
        open
        placement="top"
        size="lg"
        onOpenChange={vi.fn()}
        aria-label="Command palette"
      >
        <Dialog.Header>
          <h2>Palette</h2>
        </Dialog.Header>
        <Dialog.Body>
          <p>Search</p>
        </Dialog.Body>
        <Dialog.Footer>
          <button type="button">Done</button>
        </Dialog.Footer>
      </Dialog>
    )

    const dialog = screen.getByRole('dialog', { name: 'Command palette' })
    expect(dialog).toHaveClass('items-start')
    expect(dialog).toHaveClass('pt-[15vh]')

    // eslint-disable-next-line testing-library/no-node-access -- asserting primitive panel chrome
    const panel = screen.getByText('Palette').closest('.max-w-2xl')
    expect(panel).not.toBeNull()
    // eslint-disable-next-line testing-library/no-node-access -- asserting primitive section chrome
    expect(screen.getByText('Palette').parentElement).toHaveClass('border-b')
    // eslint-disable-next-line testing-library/no-node-access -- asserting primitive section chrome
    const footer = screen.getByRole('button', { name: 'Done' }).parentElement
    expect(footer).toHaveClass('justify-end')
  })
})

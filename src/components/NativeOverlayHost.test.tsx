import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { NativeOverlayRequest } from '@/components/base/floating/nativeOverlay'
import { NativeOverlayHost } from './NativeOverlayHost'

const request: NativeOverlayRequest = {
  surfaceId: 'surface-1',
  kind: 'menu',
  anchorRect: { x: 24, y: 32, width: 0, height: 0 },
  placement: 'bottom-start',
  payload: {
    kind: 'menu',
    ariaLabel: 'Terminal actions',
    items: [
      {
        id: 'copy',
        label: 'Copy',
        shortcut: '⌘C',
      },
    ],
  },
}

const sectionRequest: NativeOverlayRequest = {
  surfaceId: 'surface-2',
  kind: 'menu',
  anchorRect: { x: 40, y: 48, width: 24, height: 20 },
  placement: 'bottom-end',
  payload: {
    kind: 'menu',
    ariaLabel: 'Displayed layouts',
    sections: [
      {
        label: 'Displayed layouts',
        items: [
          {
            type: 'checkbox',
            id: 'toggle-quad',
            label: 'Quad',
            checked: true,
          },
        ],
      },
      {
        items: [
          { type: 'separator' },
          {
            id: 'create-custom',
            label: 'Create custom layout',
            icon: 'dashboard_customize',
          },
        ],
      },
    ],
  },
}

const compositeRequest: NativeOverlayRequest = {
  surfaceId: 'surface-3',
  kind: 'menu',
  anchorRect: { x: 40, y: 48, width: 24, height: 20 },
  placement: 'bottom-end',
  payload: {
    kind: 'menu',
    ariaLabel: 'Displayed layouts',
    sections: [
      {
        label: 'Custom',
        items: [
          {
            type: 'composite',
            id: 'pick-custom',
            label: 'Main + bottom',
            icon: 'dashboard',
            active: true,
            actions: [
              {
                id: 'edit-custom',
                label: 'Edit Main + bottom',
                icon: 'edit',
              },
              {
                id: 'duplicate-custom',
                label: 'Duplicate Main + bottom',
                icon: 'content_copy',
              },
              {
                id: 'toggle-custom',
                label: 'Hide Main + bottom from switcher',
                icon: 'visibility',
                pressed: true,
              },
            ],
          },
        ],
      },
    ],
  },
}

let cleanupHostBridgeEvents: (() => void) | null = null

const installNativeOverlayHostBridge = (): {
  ready: ReturnType<typeof vi.fn>
  action: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  ownerOverlayClose: ReturnType<typeof vi.fn>
  emitRender: (payload: unknown) => void
  emitClear: () => void
} => {
  cleanupHostBridgeEvents?.()
  const renderEvent = 'native-overlay-host-render'
  const clearEvent = 'native-overlay-host-clear'
  let renderListener: ((payload: unknown) => void) | null = null
  let clearListener: (() => void) | null = null
  const ready = vi.fn(() => Promise.resolve())
  const action = vi.fn(() => Promise.resolve())
  const close = vi.fn(() => Promise.resolve())
  const ownerOverlayClose = vi.fn(() => Promise.resolve())

  const handleRenderEvent = (event: Event): void => {
    renderListener?.((event as CustomEvent<unknown>).detail)
  }

  const handleClearEvent = (): void => {
    clearListener?.()
  }

  window.addEventListener(renderEvent, handleRenderEvent)
  window.addEventListener(clearEvent, handleClearEvent)
  cleanupHostBridgeEvents = (): void => {
    window.removeEventListener(renderEvent, handleRenderEvent)
    window.removeEventListener(clearEvent, handleClearEvent)
    cleanupHostBridgeEvents = null
  }

  window.vimeflow = {
    invoke: <T,>(): Promise<T> => Promise.resolve(null as T),
    listen: vi.fn(() => Promise.resolve(vi.fn())),
    nativeOverlayHost: {
      ready,
      action,
      close,
      onRender: vi.fn((callback: (payload: unknown) => void) => {
        renderListener = callback

        return vi.fn()
      }),
      onClear: vi.fn((callback: () => void) => {
        clearListener = callback

        return vi.fn()
      }),
    },
    nativeOverlay: {
      open: vi.fn(() => Promise.resolve({ accepted: true })),
      close: ownerOverlayClose,
      onAction: vi.fn(() => vi.fn()),
      onClose: vi.fn(() => vi.fn()),
    },
  }

  return {
    ready,
    action,
    close,
    ownerOverlayClose,
    emitRender: (payload): void => {
      fireEvent(window, new CustomEvent(renderEvent, { detail: payload }))
    },
    emitClear: (): void => {
      fireEvent(window, new CustomEvent(clearEvent))
    },
  }
}

afterEach(() => {
  cleanupHostBridgeEvents?.()
  document.body.removeAttribute('data-native-overlay-host')
  delete window.vimeflow
})

describe('NativeOverlayHost', () => {
  test('renders a native overlay menu request with the shared Menu primitive', async () => {
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost />)

    bridge.emitRender(request)

    expect(
      await screen.findByRole('menu', { name: 'Terminal actions' })
    ).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Copy' })).toBeInTheDocument()
    expect(document.body.dataset.nativeOverlayHost).toBe('true')
    await waitFor(() => {
      expect(bridge.ready).toHaveBeenCalledWith({ surfaceId: 'surface-1' })
    })
    expect(bridge.ownerOverlayClose).not.toHaveBeenCalled()
  })

  test('dispatches the selected action and hides the menu', async () => {
    const user = userEvent.setup()
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost />)

    bridge.emitRender(request)
    await user.click(await screen.findByRole('menuitem', { name: 'Copy' }))

    expect(bridge.action).toHaveBeenCalledWith({
      surfaceId: 'surface-1',
      actionId: 'copy',
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  test('renders v1 sections and dispatches checkbox actions', async () => {
    const user = userEvent.setup()
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost />)

    bridge.emitRender(sectionRequest)

    expect(
      await screen.findByRole('menu', { name: 'Displayed layouts' })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('group', { name: 'Displayed layouts' })
    ).toBeInTheDocument()

    const quad = screen.getByRole('menuitemcheckbox', { name: 'Quad' })
    expect(quad).toHaveAttribute('aria-checked', 'true')

    await user.click(quad)

    expect(bridge.action).toHaveBeenCalledWith({
      surfaceId: 'surface-2',
      actionId: 'toggle-quad',
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  test('renders composite menu rows and dispatches trailing actions', async () => {
    const user = userEvent.setup()
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost />)

    bridge.emitRender(compositeRequest)

    expect(
      await screen.findByRole('menuitem', { name: 'Main + bottom' })
    ).toBeInTheDocument()

    expect(
      screen.getByRole('button', { name: 'Hide Main + bottom from switcher' })
    ).toHaveAttribute('aria-pressed', 'true')

    await user.click(
      screen.getByRole('button', { name: 'Duplicate Main + bottom' })
    )

    expect(bridge.action).toHaveBeenCalledWith({
      surfaceId: 'surface-3',
      actionId: 'duplicate-custom',
    })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  test('closes on Escape and clears on host clear', async () => {
    const user = userEvent.setup()
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost />)

    bridge.emitRender(request)
    expect(await screen.findByRole('menu')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(bridge.close).toHaveBeenCalledWith({
        surfaceId: 'surface-1',
        reason: 'outside',
      })
    })

    bridge.emitRender(request)
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    bridge.emitClear()
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })
})

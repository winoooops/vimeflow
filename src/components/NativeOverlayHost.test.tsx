import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
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

const detailRequest: NativeOverlayRequest = {
  surfaceId: 'surface-4',
  kind: 'menu',
  anchorRect: { x: 40, y: 48, width: 196, height: 22 },
  placement: 'bottom',
  theme: {
    id: 'flexoki',
    colorScheme: 'light',
    variables: {
      '--color-surface-container-high': 'var(--color-test-surface-high)',
      '--color-on-surface': 'var(--color-test-on-surface)',
      '--shadow-menu': 'var(--shadow-test-menu)',
    },
  },
  payload: {
    kind: 'menu',
    ariaLabel: 'Git ref details',
    matchAnchorWidth: true,
    surfaceTone: 'primary-container-soft',
    items: [
      {
        id: 'copy-path',
        label: 'Copy path',
        detail:
          '/Users/will/projects/vimeflow/worktrees/native-overlay-git-ref',
        icon: 'folder_open',
        feedback: 'copy',
        closeOnSelect: false,
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
  emitActionResult: (payload: unknown) => void
} => {
  cleanupHostBridgeEvents?.()
  const renderEvent = 'native-overlay-host-render'
  const clearEvent = 'native-overlay-host-clear'
  const actionResultEvent = 'native-overlay-host-action-result'
  let renderListener: ((payload: unknown) => void) | null = null
  let clearListener: (() => void) | null = null
  let actionResultListener: ((payload: unknown) => void) | null = null
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

  const handleActionResultEvent = (event: Event): void => {
    actionResultListener?.((event as CustomEvent<unknown>).detail)
  }

  window.addEventListener(renderEvent, handleRenderEvent)
  window.addEventListener(clearEvent, handleClearEvent)
  window.addEventListener(actionResultEvent, handleActionResultEvent)
  cleanupHostBridgeEvents = (): void => {
    window.removeEventListener(renderEvent, handleRenderEvent)
    window.removeEventListener(clearEvent, handleClearEvent)
    window.removeEventListener(actionResultEvent, handleActionResultEvent)
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
      onActionResult: vi.fn((callback: (payload: unknown) => void) => {
        actionResultListener = callback

        return vi.fn()
      }),
    },
    nativeOverlay: {
      open: vi.fn(() => Promise.resolve({ accepted: true })),
      close: ownerOverlayClose,
      actionResult: vi.fn(() => Promise.resolve()),
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
    emitActionResult: (payload): void => {
      fireEvent(window, new CustomEvent(actionResultEvent, { detail: payload }))
    },
  }
}

afterEach(() => {
  cleanupHostBridgeEvents?.()
  document.body.removeAttribute('data-native-overlay-host')
  document.documentElement.removeAttribute('style')
  document.documentElement.removeAttribute('data-theme')
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

  test('renders copy detail rows with anchor width and copied feedback', async () => {
    const user = userEvent.setup()
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost />)

    bridge.emitRender(detailRequest)

    const menu = await screen.findByRole('menu', { name: 'Git ref details' })
    const row = screen.getByRole('menuitem', { name: 'Copy path' })

    expect(menu).toHaveStyle({ width: '196px' })
    expect(menu).toHaveClass('vf-native-overlay-primary-container-soft')
    expect(document.documentElement.dataset.theme).toBe('flexoki')
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(
      document.documentElement.style.getPropertyValue(
        '--color-surface-container-high'
      )
    ).toBe('var(--color-test-surface-high)')

    expect(row).toHaveTextContent(
      '/Users/will/projects/vimeflow/worktrees/native-overlay-git-ref'
    )
    expect(row).toHaveClass('rounded-chip')
    expect(within(row).getByText('Copy path')).toHaveClass(
      'text-on-surface-muted'
    )

    expect(
      within(row).getByText(
        '/Users/will/projects/vimeflow/worktrees/native-overlay-git-ref'
      )
    ).toHaveClass('text-on-surface')

    expect(within(row).getByText('content_copy')).toBeInTheDocument()

    await waitFor(() => {
      expect(bridge.ready).toHaveBeenCalledWith({ surfaceId: 'surface-4' })
    })

    await user.click(row)

    expect(bridge.action).toHaveBeenCalledWith({
      surfaceId: 'surface-4',
      actionId: 'copy-path',
      closeOnSelect: false,
      feedback: 'copy',
    })
    expect(screen.getByRole('menu', { name: 'Git ref details' })).toBe(menu)
    expect(within(row).queryByText('check')).not.toBeInTheDocument()

    bridge.emitActionResult({
      surfaceId: 'surface-4',
      actionId: 'copy-path',
      feedback: 'copy',
      ok: false,
    })

    expect(within(row).queryByText('check')).not.toBeInTheDocument()

    bridge.emitActionResult({
      surfaceId: 'surface-4',
      actionId: 'copy-path',
      feedback: 'copy',
      ok: true,
    })

    expect(within(row).getByText('check')).toBeInTheDocument()
    expect(within(row).getByText('Copied')).toHaveClass('text-[10px]')
  })

  test('clears prior theme tokens when a later request has no theme', async () => {
    const bridge = installNativeOverlayHostBridge()
    render(<NativeOverlayHost />)

    bridge.emitRender(detailRequest)
    expect(
      await screen.findByRole('menu', { name: 'Git ref details' })
    ).toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBe('flexoki')
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(
      document.documentElement.style.getPropertyValue(
        '--color-surface-container-high'
      )
    ).toBe('var(--color-test-surface-high)')

    expect(
      document.documentElement.style.getPropertyValue('--shadow-menu')
    ).toBe('var(--shadow-test-menu)')

    bridge.emitRender(request)

    expect(
      await screen.findByRole('menu', { name: 'Terminal actions' })
    ).toBeInTheDocument()
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(document.documentElement.style.colorScheme).toBe('')
    expect(
      document.documentElement.style.getPropertyValue(
        '--color-surface-container-high'
      )
    ).toBe('')

    expect(document.documentElement.style.getPropertyValue('--shadow-menu')).toBe(
      ''
    )
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

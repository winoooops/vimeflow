import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  __resetNativeOverlayForTest,
  nativeOverlayThemeSnapshot,
  openNativeOverlay,
  type NativeOverlayActionEvent,
  type NativeOverlayRequest,
} from './nativeOverlay'

const requestForSurface = (surfaceId: string): NativeOverlayRequest => ({
  surfaceId,
  kind: 'menu',
  anchorRect: {
    x: 0,
    y: 0,
    width: 120,
    height: 32,
  },
  placement: 'bottom-start',
  payload: {
    kind: 'menu',
    items: [{ id: 'open', label: 'Open' }],
  },
})

const deferredOpen = (): {
  promise: Promise<{ accepted: boolean }>
  resolve: (value: { accepted: boolean }) => void
  reject: (error: Error) => void
} => {
  let resolvePromise: ((value: { accepted: boolean }) => void) | null = null
  let rejectPromise: ((error: Error) => void) | null = null

  const promise = new Promise<{ accepted: boolean }>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  return {
    promise,
    resolve: (value): void => {
      resolvePromise?.(value)
    },
    reject: (error): void => {
      rejectPromise?.(error)
    },
  }
}

const installBridge = (
  openResults: Promise<{ accepted: boolean }>[]
): {
  action: (event: NativeOverlayActionEvent) => void
  actionResult: ReturnType<typeof vi.fn>
} => {
  let actionListener: ((event: unknown) => void) | null = null
  const actionResult = vi.fn(() => Promise.resolve())

  window.vimeflow = {
    invoke: <T>(): Promise<T> => Promise.resolve(null as T),
    listen: vi.fn(() => Promise.resolve(vi.fn())),
    nativeOverlay: {
      open: vi.fn(() => {
        const result = openResults.shift()

        if (result === undefined) {
          throw new Error('unexpected native overlay open')
        }

        return result
      }),
      close: vi.fn(() => Promise.resolve()),
      actionResult,
      resume: vi.fn(() => Promise.resolve()),
      onAction: vi.fn((callback: (event: unknown) => void) => {
        actionListener = callback

        return vi.fn()
      }),
      onClose: vi.fn(() => vi.fn()),
    },
  }

  return {
    actionResult,
    action: (event): void => {
      actionListener?.(event)
    },
  }
}

afterEach(() => {
  __resetNativeOverlayForTest()
  document.documentElement.removeAttribute('style')
  document.documentElement.removeAttribute('data-theme')
  delete window.vimeflow
})

describe('nativeOverlayThemeSnapshot', () => {
  test('captures the active theme tokens for the overlay renderer', () => {
    const root = document.documentElement
    root.dataset.theme = 'flexoki'
    root.style.colorScheme = 'light'
    root.style.setProperty('--color-surface', 'var(--color-test-surface)')
    root.style.setProperty('--shadow-modal', 'var(--shadow-test-modal)')
    root.style.setProperty('--layout-gap', '8px')

    expect(nativeOverlayThemeSnapshot()).toEqual({
      id: 'flexoki',
      colorScheme: 'light',
      variables: {
        '--color-surface': 'var(--color-test-surface)',
        '--shadow-modal': 'var(--shadow-test-modal)',
      },
    })
  })
})

describe('openNativeOverlay', () => {
  test('does not let an older rejected open remove a newer session', async () => {
    const olderOpen = deferredOpen()
    const newerOpen = deferredOpen()
    const bridge = installBridge([olderOpen.promise, newerOpen.promise])
    const olderAction = vi.fn()
    const newerAction = vi.fn()

    const olderResult = openNativeOverlay(requestForSurface('surface-1'), {
      actions: new Map([['open', olderAction]]),
      onClose: vi.fn(),
    })

    const newerResult = openNativeOverlay(requestForSurface('surface-1'), {
      actions: new Map([['open', newerAction]]),
      onClose: vi.fn(),
    })

    newerOpen.resolve({ accepted: true })
    olderOpen.resolve({ accepted: false })

    await expect(newerResult).resolves.toBe(true)
    await expect(olderResult).resolves.toBe(false)

    bridge.action({ surfaceId: 'surface-1', actionId: 'open' })

    expect(olderAction).not.toHaveBeenCalled()
    expect(newerAction).toHaveBeenCalledTimes(1)
  })

  test('does not let an older failed open remove a newer session', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const olderOpen = deferredOpen()
    const newerOpen = deferredOpen()
    const bridge = installBridge([olderOpen.promise, newerOpen.promise])
    const newerAction = vi.fn()

    const olderResult = openNativeOverlay(requestForSurface('surface-1'), {
      actions: new Map([['open', vi.fn()]]),
      onClose: vi.fn(),
    })

    const newerResult = openNativeOverlay(requestForSurface('surface-1'), {
      actions: new Map([['open', newerAction]]),
      onClose: vi.fn(),
    })

    newerOpen.resolve({ accepted: true })
    olderOpen.reject(new Error('native open failed'))

    await expect(newerResult).resolves.toBe(true)
    await expect(olderResult).resolves.toBe(false)

    bridge.action({ surfaceId: 'surface-1', actionId: 'open' })

    expect(newerAction).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      '[vimeflow:native-overlay] open failed',
      expect.any(Error)
    )
  })

  test('reports copy feedback success only after the retained action succeeds', async () => {
    const open = deferredOpen()
    const bridge = installBridge([open.promise])
    const copy = vi.fn(() => Promise.resolve(true))

    const result = openNativeOverlay(requestForSurface('surface-1'), {
      actions: new Map([
        [
          'copy',
          {
            retainSession: true,
            run: copy,
          },
        ],
      ]),
      onClose: vi.fn(),
    })

    open.resolve({ accepted: true })
    await expect(result).resolves.toBe(true)

    bridge.action({
      surfaceId: 'surface-1',
      actionId: 'copy',
      feedback: 'copy',
      closeOnSelect: false,
    })

    expect(bridge.actionResult).not.toHaveBeenCalled()
    await Promise.resolve()

    expect(copy).toHaveBeenCalledOnce()
    expect(bridge.actionResult).toHaveBeenCalledWith({
      surfaceId: 'surface-1',
      actionId: 'copy',
      feedback: 'copy',
      ok: true,
    })
  })

  test('reports copy feedback failure when the retained action fails', async () => {
    const open = deferredOpen()
    const bridge = installBridge([open.promise])

    const result = openNativeOverlay(requestForSurface('surface-1'), {
      actions: new Map([
        [
          'copy',
          {
            retainSession: true,
            run: (): boolean => false,
          },
        ],
      ]),
      onClose: vi.fn(),
    })

    open.resolve({ accepted: true })
    await expect(result).resolves.toBe(true)

    bridge.action({
      surfaceId: 'surface-1',
      actionId: 'copy',
      feedback: 'copy',
      closeOnSelect: false,
    })

    await Promise.resolve()

    expect(bridge.actionResult).toHaveBeenCalledWith({
      surfaceId: 'surface-1',
      actionId: 'copy',
      feedback: 'copy',
      ok: false,
    })
  })
})

import type { BrowserWindow } from 'electron'
import { describe, expect, test, vi } from 'vitest'
import { installNavigationGuard, isSafeExternalUrl } from './navigation-guard'

type OpenHandler = (details: { url: string }) => { action: string }

type WillNavigateHandler = (
  event: { preventDefault: () => void },
  url: string
) => void

const APP_URL = 'vimeflow://app/index.html'

const setup = (
  currentUrl: string = APP_URL
): {
  openExternal: ReturnType<typeof vi.fn>
  handlers: { open?: OpenHandler; navigate?: WillNavigateHandler }
} => {
  const openExternal = vi.fn()
  const handlers: { open?: OpenHandler; navigate?: WillNavigateHandler } = {}

  const win = {
    webContents: {
      getURL: (): string => currentUrl,
      setWindowOpenHandler: (handler: OpenHandler): void => {
        handlers.open = handler
      },
      on: (event: string, handler: WillNavigateHandler): void => {
        if (event === 'will-navigate') {
          handlers.navigate = handler
        }
      },
    },
  } as unknown as BrowserWindow

  installNavigationGuard(win, openExternal as unknown as (url: string) => void)

  return { openExternal, handlers }
}

describe('isSafeExternalUrl', () => {
  test('accepts http(s) and mailto, rejects everything else', () => {
    expect(isSafeExternalUrl('https://example.com')).toBe(true)
    expect(isSafeExternalUrl('http://example.com')).toBe(true)
    expect(isSafeExternalUrl('mailto:a@b.com')).toBe(true)
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('vimeflow://app/x')).toBe(false)
  })
})

describe('installNavigationGuard — window.open', () => {
  test('denies the in-app window and opens safe external URLs in the browser', () => {
    const { openExternal, handlers } = setup()

    const result = handlers.open?.({ url: 'https://example.com/docs' })

    expect(result).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledWith('https://example.com/docs')
  })

  test('denies window.open for unsafe schemes without opening anything', () => {
    const { openExternal, handlers } = setup()

    const result = handlers.open?.({ url: 'file:///etc/passwd' })

    expect(result).toEqual({ action: 'deny' })
    expect(openExternal).not.toHaveBeenCalled()
  })
})

describe('installNavigationGuard — will-navigate', () => {
  test('blocks off-origin navigation and routes http(s) to the system browser', () => {
    const { openExternal, handlers } = setup()
    const event = { preventDefault: vi.fn() }

    handlers.navigate?.(event, 'https://evil.example/login')

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(openExternal).toHaveBeenCalledWith('https://evil.example/login')
  })

  test('blocks off-origin navigation to unsafe schemes without opening', () => {
    const { openExternal, handlers } = setup()
    const event = { preventDefault: vi.fn() }

    handlers.navigate?.(event, 'file:///etc/passwd')

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(openExternal).not.toHaveBeenCalled()
  })

  test('allows same-origin navigation within the app', () => {
    const { openExternal, handlers } = setup(APP_URL)
    const event = { preventDefault: vi.fn() }

    handlers.navigate?.(event, 'vimeflow://app/somewhere-else')

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })

  test('guards the dev-server origin too', () => {
    const { openExternal, handlers } = setup('http://localhost:5173/')
    const event = { preventDefault: vi.fn() }

    handlers.navigate?.(event, 'http://localhost:5173/index.html')
    expect(event.preventDefault).not.toHaveBeenCalled()

    handlers.navigate?.(event, 'https://evil.example')
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(openExternal).toHaveBeenCalledWith('https://evil.example')
  })

  test('treats file: as never same-origin so the loadFile runtime is not hijacked', () => {
    const { openExternal, handlers } = setup('file:///home/app/dist/index.html')
    const event = { preventDefault: vi.fn() }

    handlers.navigate?.(event, 'file:///tmp/pwn.html')

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(openExternal).not.toHaveBeenCalled()
  })
})

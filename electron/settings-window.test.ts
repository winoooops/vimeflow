import { describe, expect, test, vi } from 'vitest'
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'
import { SettingsWindowController, settingsWindowUrl } from './settings-window'
import { SETTINGS_NAVIGATE_TARGET } from './ipc-channels'

type WindowEventName = 'closed' | 'ready-to-show'

class FakeSettingsWindow {
  readonly webContents = {
    getURL: vi.fn(() => 'vimeflow://app/index.html?window=settings'),
    on: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    send: vi.fn(),
  }

  readonly focus = vi.fn()
  readonly loadURL = vi.fn(() => Promise.resolve())
  readonly restore = vi.fn()
  readonly show = vi.fn()

  private readonly handlers = new Map<WindowEventName, (() => void)[]>()
  private destroyed = false
  private minimized = false

  constructor(readonly options: BrowserWindowConstructorOptions) {}

  isDestroyed(): boolean {
    return this.destroyed
  }

  isMinimized(): boolean {
    return this.minimized
  }

  markDestroyed(): void {
    this.destroyed = true
  }

  markMinimized(): void {
    this.minimized = true
  }

  on(event: WindowEventName, handler: () => void): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
  }

  once(event: WindowEventName, handler: () => void): void {
    const onceHandler = (): void => {
      this.handlers.set(
        event,
        (this.handlers.get(event) ?? []).filter((h) => h !== onceHandler)
      )
      handler()
    }

    this.on(event, onceHandler)
  }

  emit(event: WindowEventName): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler()
    }
  }
}

const location = {
  appOrigin: 'vimeflow://app',
  isPackaged: false,
  rendererDistDir: '/app/dist',
}

describe('settingsWindowUrl', () => {
  test('targets the custom app protocol in packaged builds', () => {
    expect(
      settingsWindowUrl({
        ...location,
        isPackaged: true,
      })
    ).toBe('vimeflow://app/index.html?window=settings')
  })

  test('preserves dev server URL params while selecting the settings window', () => {
    expect(
      settingsWindowUrl({
        ...location,
        devServerUrl: 'http://localhost:5173/?foo=bar',
      })
    ).toBe('http://localhost:5173/?foo=bar&window=settings')
  })

  test('falls back to the built renderer file when no dev server is present', () => {
    expect(settingsWindowUrl(location)).toBe(
      'file:///app/dist/index.html?window=settings'
    )
  })

  test('includes a requested settings target', () => {
    expect(settingsWindowUrl(location, 'version-diff-view-style')).toBe(
      'file:///app/dist/index.html?window=settings&settingsTarget=version-diff-view-style'
    )
  })
})

describe('SettingsWindowController', () => {
  test('creates a native settings window and loads the settings renderer', () => {
    const windows: FakeSettingsWindow[] = []

    const controller = new SettingsWindowController({
      createWindow: (options): BrowserWindow => {
        const win = new FakeSettingsWindow(options)
        windows.push(win)

        return win as unknown as BrowserWindow
      },
      location,
      preloadPath: '/dist-electron/preload.mjs',
      openExternalUrl: vi.fn(),
      windowChromeOptions: {
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 16, y: 13 },
      },
    })

    controller.open()

    expect(windows).toHaveLength(1)
    expect(windows[0].options).toMatchObject({
      title: 'Settings',
      show: false,
      width: 960,
      height: 680,
      minWidth: 720,
      minHeight: 520,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 13 },
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: '/dist-electron/preload.mjs',
        sandbox: true,
      },
    })

    expect(windows[0].loadURL).toHaveBeenCalledWith(
      'file:///app/dist/index.html?window=settings'
    )

    windows[0].emit('ready-to-show')

    expect(windows[0].show).toHaveBeenCalledTimes(1)
  })

  test('focuses the existing settings window instead of creating another one', () => {
    const windows: FakeSettingsWindow[] = []

    const controller = new SettingsWindowController({
      createWindow: (options): BrowserWindow => {
        const win = new FakeSettingsWindow(options)
        windows.push(win)

        return win as unknown as BrowserWindow
      },
      location,
      preloadPath: '/dist-electron/preload.mjs',
      openExternalUrl: vi.fn(),
    })

    controller.open()
    windows[0].emit('ready-to-show')
    windows[0].markMinimized()
    controller.open()

    expect(windows).toHaveLength(1)
    expect(windows[0].restore).toHaveBeenCalledTimes(1)
    expect(windows[0].show).toHaveBeenCalledTimes(2)
    expect(windows[0].focus).toHaveBeenCalledTimes(1)
  })

  test('navigates an existing settings window to the requested target', () => {
    const windows: FakeSettingsWindow[] = []

    const controller = new SettingsWindowController({
      createWindow: (options): BrowserWindow => {
        const win = new FakeSettingsWindow(options)
        windows.push(win)

        return win as unknown as BrowserWindow
      },
      location,
      preloadPath: '/dist-electron/preload.mjs',
      openExternalUrl: vi.fn(),
    })

    controller.open()
    windows[0].emit('ready-to-show')
    controller.open('version-diff-view-style')

    expect(windows[0].webContents.send).toHaveBeenCalledWith(
      SETTINGS_NAVIGATE_TARGET,
      'version-diff-view-style'
    )
  })

  test('buffers target navigation until the settings window is ready', () => {
    const windows: FakeSettingsWindow[] = []

    const controller = new SettingsWindowController({
      createWindow: (options): BrowserWindow => {
        const win = new FakeSettingsWindow(options)
        windows.push(win)

        return win as unknown as BrowserWindow
      },
      location,
      preloadPath: '/dist-electron/preload.mjs',
      openExternalUrl: vi.fn(),
    })

    controller.open()
    controller.open('version-diff-view-style')

    expect(windows[0].webContents.send).not.toHaveBeenCalled()

    windows[0].emit('ready-to-show')

    expect(windows[0].webContents.send).toHaveBeenCalledOnce()
    expect(windows[0].webContents.send).toHaveBeenCalledWith(
      SETTINGS_NAVIGATE_TARGET,
      'version-diff-view-style'
    )
  })

  test('does not show an existing settings window before it is ready', () => {
    const windows: FakeSettingsWindow[] = []

    const controller = new SettingsWindowController({
      createWindow: (options): BrowserWindow => {
        const win = new FakeSettingsWindow(options)
        windows.push(win)

        return win as unknown as BrowserWindow
      },
      location,
      preloadPath: '/dist-electron/preload.mjs',
      openExternalUrl: vi.fn(),
    })

    controller.open()
    controller.open()

    expect(windows).toHaveLength(1)
    expect(windows[0].show).not.toHaveBeenCalled()
    expect(windows[0].focus).not.toHaveBeenCalled()

    windows[0].emit('ready-to-show')

    expect(windows[0].show).toHaveBeenCalledTimes(1)
  })

  test('allows a new settings window after the previous one closes', () => {
    const windows: FakeSettingsWindow[] = []

    const controller = new SettingsWindowController({
      createWindow: (options): BrowserWindow => {
        const win = new FakeSettingsWindow(options)
        windows.push(win)

        return win as unknown as BrowserWindow
      },
      location,
      preloadPath: '/dist-electron/preload.mjs',
      openExternalUrl: vi.fn(),
    })

    controller.open()
    windows[0].emit('closed')
    windows[0].markDestroyed()
    controller.open()

    expect(windows).toHaveLength(2)
  })
})

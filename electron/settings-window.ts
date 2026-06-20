import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { installNavigationGuard } from './navigation-guard'

const SETTINGS_WINDOW_WIDTH = 960
const SETTINGS_WINDOW_HEIGHT = 680
const SETTINGS_WINDOW_MIN_WIDTH = 720
const SETTINGS_WINDOW_MIN_HEIGHT = 520
const SETTINGS_WINDOW_QUERY_KEY = 'window'
const SETTINGS_WINDOW_QUERY_VALUE = 'settings'

export interface SettingsWindowLocation {
  appOrigin: string
  isPackaged: boolean
  rendererDistDir: string
  devServerUrl?: string
}

export interface SettingsWindowControllerOptions {
  createWindow: (options: BrowserWindowConstructorOptions) => BrowserWindow
  location: SettingsWindowLocation
  preloadPath: string
  openExternalUrl: (url: string) => void
  onRendererDiagnostics?: (win: BrowserWindow) => void
}

export const settingsWindowUrl = ({
  appOrigin,
  isPackaged,
  rendererDistDir,
  devServerUrl,
}: SettingsWindowLocation): string => {
  if (isPackaged) {
    const url = new URL('/index.html', appOrigin)
    url.searchParams.set(SETTINGS_WINDOW_QUERY_KEY, SETTINGS_WINDOW_QUERY_VALUE)

    return url.toString()
  }

  if (devServerUrl !== undefined && devServerUrl.length > 0) {
    const url = new URL(devServerUrl)
    url.searchParams.set(SETTINGS_WINDOW_QUERY_KEY, SETTINGS_WINDOW_QUERY_VALUE)

    return url.toString()
  }

  const url = pathToFileURL(path.join(rendererDistDir, 'index.html'))
  url.searchParams.set(SETTINGS_WINDOW_QUERY_KEY, SETTINGS_WINDOW_QUERY_VALUE)

  return url.toString()
}

export class SettingsWindowController {
  private settingsWindow: BrowserWindow | null = null

  constructor(private readonly options: SettingsWindowControllerOptions) {}

  open(): void {
    const existing = this.settingsWindow

    if (existing !== null && !existing.isDestroyed()) {
      if (existing.isMinimized()) {
        existing.restore()
      }

      existing.show()
      existing.focus()

      return
    }

    const win = this.options.createWindow({
      width: SETTINGS_WINDOW_WIDTH,
      height: SETTINGS_WINDOW_HEIGHT,
      minWidth: SETTINGS_WINDOW_MIN_WIDTH,
      minHeight: SETTINGS_WINDOW_MIN_HEIGHT,
      title: 'Settings',
      show: false,
      resizable: true,
      backgroundColor: '#121221',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: this.options.preloadPath,
      },
    })

    this.settingsWindow = win
    this.options.onRendererDiagnostics?.(win)
    installNavigationGuard(win, this.options.openExternalUrl)

    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) {
        win.show()
      }
    })

    win.on('closed', () => {
      if (this.settingsWindow === win) {
        this.settingsWindow = null
      }
    })

    void win.loadURL(settingsWindowUrl(this.options.location))
  }
}

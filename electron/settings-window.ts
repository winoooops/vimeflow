import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { installNavigationGuard } from './navigation-guard'
import { SETTINGS_NAVIGATE_TARGET } from './ipc-channels'

const SETTINGS_WINDOW_WIDTH = 960
const SETTINGS_WINDOW_HEIGHT = 680
const SETTINGS_WINDOW_MIN_WIDTH = 720
const SETTINGS_WINDOW_MIN_HEIGHT = 520
const SETTINGS_WINDOW_QUERY_KEY = 'window'
const SETTINGS_WINDOW_QUERY_VALUE = 'settings'
const SETTINGS_TARGET_QUERY_KEY = 'settingsTarget'

type SettingsWindowChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  'backgroundColor' | 'titleBarStyle' | 'trafficLightPosition'
>

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
  windowChromeOptions?: SettingsWindowChromeOptions
}

export const settingsWindowUrl = (
  {
    appOrigin,
    isPackaged,
    rendererDistDir,
    devServerUrl,
  }: SettingsWindowLocation,
  targetId?: string
): string => {
  if (isPackaged) {
    const url = new URL('/index.html', appOrigin)
    url.searchParams.set(SETTINGS_WINDOW_QUERY_KEY, SETTINGS_WINDOW_QUERY_VALUE)
    if (targetId !== undefined) {
      url.searchParams.set(SETTINGS_TARGET_QUERY_KEY, targetId)
    }

    return url.toString()
  }

  if (devServerUrl !== undefined && devServerUrl.length > 0) {
    const url = new URL(devServerUrl)
    url.searchParams.set(SETTINGS_WINDOW_QUERY_KEY, SETTINGS_WINDOW_QUERY_VALUE)
    if (targetId !== undefined) {
      url.searchParams.set(SETTINGS_TARGET_QUERY_KEY, targetId)
    }

    return url.toString()
  }

  const url = pathToFileURL(path.join(rendererDistDir, 'index.html'))
  url.searchParams.set(SETTINGS_WINDOW_QUERY_KEY, SETTINGS_WINDOW_QUERY_VALUE)
  if (targetId !== undefined) {
    url.searchParams.set(SETTINGS_TARGET_QUERY_KEY, targetId)
  }

  return url.toString()
}

export class SettingsWindowController {
  private settingsWindow: BrowserWindow | null = null
  private isReady = false
  private pendingTargetId: string | null = null

  constructor(private readonly options: SettingsWindowControllerOptions) {}

  open(targetId?: string): void {
    const existing = this.settingsWindow

    if (existing !== null && !existing.isDestroyed()) {
      if (targetId !== undefined) {
        if (this.isReady) {
          existing.webContents.send(SETTINGS_NAVIGATE_TARGET, targetId)
        } else {
          this.pendingTargetId = targetId
        }
      }

      if (existing.isMinimized()) {
        existing.restore()
      }

      if (this.isReady) {
        existing.show()
        existing.focus()
      }

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
      ...this.options.windowChromeOptions,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: this.options.preloadPath,
      },
    })

    this.settingsWindow = win
    this.isReady = false
    this.pendingTargetId = null
    this.options.onRendererDiagnostics?.(win)
    installNavigationGuard(win, this.options.openExternalUrl)

    win.once('ready-to-show', () => {
      this.isReady = true

      if (!win.isDestroyed()) {
        if (this.pendingTargetId !== null) {
          win.webContents.send(SETTINGS_NAVIGATE_TARGET, this.pendingTargetId)
          this.pendingTargetId = null
        }

        win.show()
      }
    })

    win.on('closed', () => {
      if (this.settingsWindow === win) {
        this.settingsWindow = null
        this.isReady = false
        this.pendingTargetId = null
      }
    })

    void win.loadURL(settingsWindowUrl(this.options.location, targetId))
  }
}

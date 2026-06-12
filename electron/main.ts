import {
  app,
  BrowserWindow,
  ipcMain,
  net,
  protocol,
  session,
  shell,
} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { AppSettings } from '../src/bindings/AppSettings'
import { isAllowedBackendMethod } from './backend-methods'
import {
  developmentContentSecurityPolicy,
  packagedContentSecurityPolicy,
} from './csp'
import { installCommandPaletteShortcutOverride } from './command-palette-shortcut'
import { installApplicationEditMenu } from './edit-menu'
import { installNavigationGuard } from './navigation-guard'
import {
  BACKEND_EVENT,
  BACKEND_INVOKE,
  SETTINGS_OPEN_FILE,
} from './ipc-channels'
import { spawnSidecar, type Sidecar } from './sidecar'
import { setupBrowserPaneIpc, type BrowserPaneController } from './browser-pane'
import {
  setupWorkspaceLayoutController,
  type WorkspaceLayoutController,
} from './workspace-layout-controller'
import { WorkspaceLayoutWriter } from './workspace-layout-writer'
import { WorkspaceTeardown } from './workspace-teardown'
import type { PersistedTab } from './workspace-layout-types'

// Keep the GPU serving this window while it is occluded (covered by another
// window) or unfocused. Chromium otherwise backgrounds the occluded window and
// reclaims its GPU resources, which corrupts xterm's cached glyph textures so
// they render as garbage on return. (Confirmed: disabling hardware
// acceleration entirely made the corruption vanish — it is the GPU layer.)
// These switches keep hardware acceleration and the WebGL renderer while
// stopping the occlusion-driven reclaim.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-renderer-backgrounding')

// __dirname is not defined in ESM modules. Derive it from import.meta.url.
// vite-plugin-electron bundles main.ts as ESM (main.js) under
// package.json:type=module, so we need the ESM-compatible idiom.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_PROTOCOL = 'vimeflow'
const APP_HOST = 'app'
const APP_ORIGIN = `${APP_PROTOCOL}://${APP_HOST}`
const E2E_RUNTIME_ARG = '--vimeflow-e2e'

// E2E detection (env var OR CLI flag fallback). Hoisted above its first
// caller (installContentSecurityPolicy at ~line 80) so the TDZ never
// bites — even if a future refactor moves installContentSecurityPolicy
// off the async `app.whenReady()` path. Closures over E2E_RUNTIME_ARG
// declared just above.
const isE2eRuntime = (): boolean =>
  process.env.VITE_E2E === '1' || process.argv.includes(E2E_RUNTIME_ARG)

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
    },
  },
])

const BINARY_NAME =
  process.platform === 'win32' ? 'vimeflow-backend.exe' : 'vimeflow-backend'

const macosWindowChromeOptions =
  process.platform === 'darwin'
    ? {
        // Matches Tailwind bg-background token — update if
        // tailwind.config.js colors.background changes.
        backgroundColor: '#121221',
        titleBarStyle: 'hiddenInset' as const,
        trafficLightPosition: { x: 16, y: 13 },
      }
    : {}

const resolveSidecarBin = (): string => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', BINARY_NAME)
  }

  return path.resolve(__dirname, '..', 'target', 'debug', BINARY_NAME)
}

const installContentSecurityPolicy = (): void => {
  if (app.isPackaged) {
    return
  }

  const csp = developmentContentSecurityPolicy(isE2eRuntime())

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = Object.fromEntries(
      Object.entries(details.responseHeaders ?? {}).filter(
        ([key]) => key.toLowerCase() !== 'content-security-policy'
      )
    )

    callback({
      responseHeaders: {
        ...responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })
}

const resolveAppProtocolFile = (requestUrl: string): string | null => {
  const url = new URL(requestUrl)

  if (url.protocol !== `${APP_PROTOCOL}:` || url.host !== APP_HOST) {
    return null
  }

  const pathname = url.pathname === '/' ? '/index.html' : url.pathname
  let decodedPathname: string

  try {
    decodedPathname = decodeURIComponent(pathname)
  } catch {
    return null
  }

  const rendererDistDir = path.resolve(__dirname, '..', 'dist')

  const resolvedPath = path.resolve(
    rendererDistDir,
    decodedPathname.replace(/^\/+/, '')
  )
  const relativePath = path.relative(rendererDistDir, resolvedPath)

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null
  }

  return resolvedPath
}

const registerAppProtocol = (): void => {
  protocol.handle(APP_PROTOCOL, async (request): Promise<Response> => {
    const filePath = resolveAppProtocolFile(request.url)

    if (filePath === null) {
      return new Response('Forbidden', { status: 403 })
    }

    const response = await net.fetch(pathToFileURL(filePath).toString())
    const headers = new Headers(response.headers)

    headers.set('Content-Security-Policy', packagedContentSecurityPolicy)

    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    })
  })
}

const configureBrowserPaneWebAuthn = (): void => {
  if (process.platform !== 'darwin') {
    return
  }

  try {
    const keychainAccessGroup =
      process.env.VIMEFLOW_WEBAUTHN_KEYCHAIN_ACCESS_GROUP

    app.configureWebAuthn(
      keychainAccessGroup
        ? {
            touchID: {
              keychainAccessGroup,
              promptReason: 'verify your identity on $1',
            },
          }
        : {}
    )
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('WebAuthn platform authenticator setup failed', error)
  }
}

interface BackendInvokePayload {
  method: string
  args?: Record<string, unknown>
}

type InvokeEnvelope =
  | { ok: true; result: unknown }
  | { ok: false; error: string; errorReason?: string }

let sidecar: Sidecar | null = null
let browserPaneController: BrowserPaneController | null = null
let workspaceLayoutController: WorkspaceLayoutController | null = null
let workspaceTeardown: WorkspaceTeardown | null = null
let quitting = false

const RENDERER_DIAGNOSTIC_PREFIXES = [
  '[vimeflow:terminal-cwd]',
  '[vimeflow:git-branch]',
]

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// Mirrors isStructuredBackendError in src/lib/backend.ts; keep in sync manually.
const isStructuredBackendError = (
  value: unknown
): value is { message: string; reason: string } =>
  isRecord(value) &&
  typeof value.message === 'string' &&
  typeof value.reason === 'string'

const supportsStructuredBackendError = (method: string): boolean =>
  method === 'rename_agent_session'

const rendererConsoleLevelName = (level: number): string => {
  switch (level) {
    case 0:
      return 'verbose'
    case 1:
      return 'info'
    case 2:
      return 'warning'
    case 3:
      return 'error'
    default:
      return 'unknown'
  }
}

const installRendererDiagnosticLogging = (win: BrowserWindow): void => {
  if (app.isPackaged) {
    return
  }

  win.webContents.on(
    'console-message',
    (_event, level, message, line, sourceId) => {
      if (
        !RENDERER_DIAGNOSTIC_PREFIXES.some((prefix) =>
          message.startsWith(prefix)
        )
      ) {
        return
      }

      const source = sourceId.length > 0 ? ` (${sourceId}:${String(line)})` : ''

      // eslint-disable-next-line no-console
      console.info(
        `[renderer:${rendererConsoleLevelName(level)}] ${message}${source}`
      )
    }
  )
}

const isBackendInvokePayload = (
  payload: unknown
): payload is BackendInvokePayload => {
  if (!isRecord(payload)) {
    return false
  }

  if (typeof payload.method !== 'string') {
    return false
  }

  return payload.args === undefined || isRecord(payload.args)
}

const createWindow = (): void => {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Vimeflow',
    resizable: true,
    ...macosWindowChromeOptions,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  // Re-arm the teardown flush for this window's lifecycle (spec §3.2).
  workspaceTeardown?.reset()

  let closeFlushed = false
  win.on('close', (event) => {
    if (closeFlushed) {
      return
    }

    // Defer the close, flush the durable store while the WebContents are still
    // alive, then re-issue so teardown proceeds (no prevent/flush loop).
    event.preventDefault()
    void (async (): Promise<void> => {
      try {
        await workspaceTeardown?.flushOnce()
      } finally {
        closeFlushed = true
        if (!win.isDestroyed()) {
          win.close()
        }
      }
    })()
  })

  installRendererDiagnosticLogging(win)
  installCommandPaletteShortcutOverride(win)
  installNavigationGuard(win, (url) => {
    const openExternalUrl = async (): Promise<void> => {
      try {
        await shell.openExternal(url)
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('Failed to open external URL', url, error)
      }
    }

    void openExternalUrl()
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL

  if (app.isPackaged) {
    void win.loadURL(`${APP_ORIGIN}/index.html`)

    return
  }

  if (devUrl !== undefined && devUrl.length > 0) {
    void win.loadURL(devUrl)

    return
  }

  void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

const setupApp = async (): Promise<void> => {
  await app.whenReady()
  installContentSecurityPolicy()
  installApplicationEditMenu()
  configureBrowserPaneWebAuthn()

  if (app.isPackaged) {
    registerAppProtocol()
  }

  const spawnedSidecar = spawnSidecar({
    binary: resolveSidecarBin(),
    appDataDir: app.getPath('userData'),
  })

  sidecar = spawnedSidecar
  browserPaneController?.dispose()
  browserPaneController = null
  browserPaneController = setupBrowserPaneIpc()

  const layoutWriter = new WorkspaceLayoutWriter({
    sidecar: spawnedSidecar,
    captureTabsForPane: (sessionId, paneId): PersistedTab[] | null =>
      browserPaneController?.captureTabsForPane(sessionId, paneId) ?? null,
    preservedTabsForPane: (sessionId, paneId): PersistedTab[] | null =>
      workspaceLayoutController?.tabsForPane(sessionId, paneId) ?? null,
  })
  browserPaneController.setWriteSignals(layoutWriter)
  workspaceLayoutController?.dispose()
  workspaceLayoutController = null
  workspaceLayoutController = setupWorkspaceLayoutController({
    sidecar: spawnedSidecar,
    ipcMain,
    writer: layoutWriter,
  })

  browserPaneController.setRestoreTabsProvider(
    (sessionId, paneId): PersistedTab[] | null =>
      workspaceLayoutController?.tabsForPane(sessionId, paneId) ?? null
  )

  workspaceTeardown = new WorkspaceTeardown({
    drainFinalShape: async (): Promise<void> => {
      const win = BrowserWindow.getAllWindows().at(0)
      if (win && !win.webContents.isDestroyed()) {
        await workspaceLayoutController?.requestFinalShape(win.webContents)
      }
    },
    flush: (): Promise<void> => layoutWriter.flush(),
    onFlushError: (error: unknown): void => {
      // eslint-disable-next-line no-console
      console.warn('Workspace flush failed during teardown', error)
    },
  })
  const allowE2eBackendMethods = !app.isPackaged && isE2eRuntime()

  ipcMain.handle(
    BACKEND_INVOKE,
    async (_ipcEvent, payload: unknown): Promise<InvokeEnvelope> => {
      if (!isBackendInvokePayload(payload)) {
        return { ok: false, error: 'invalid backend invoke payload' }
      }

      if (
        !isAllowedBackendMethod(payload.method, {
          allowE2eMethods: allowE2eBackendMethods,
        })
      ) {
        return { ok: false, error: 'unknown backend method' }
      }

      try {
        const result = await spawnedSidecar.invoke(payload.method, payload.args)

        return { ok: true, result }
      } catch (err) {
        if (
          supportsStructuredBackendError(payload.method) &&
          isStructuredBackendError(err)
        ) {
          return {
            ok: false,
            error: err.message,
            errorReason: err.reason,
          }
        }

        return {
          ok: false,
          error: typeof err === 'string' ? err : String(err),
        }
      }
    }
  )

  ipcMain.handle(SETTINGS_OPEN_FILE, async (): Promise<string> => {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json')

    if (!fs.existsSync(settingsPath)) {
      try {
        const defaults =
          await spawnedSidecar.invoke<AppSettings>('load_app_settings')
        await spawnedSidecar.invoke('save_app_settings', { settings: defaults })
      } catch {
        // Best-effort: if ensuring the default file fails, still try to open
        // so the OS surfaces the missing-file error to the user.
      }
    }

    return shell.openPath(settingsPath)
  })

  spawnedSidecar.onEvent((event, payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(BACKEND_EVENT, { event, payload })
    }
  })

  createWindow()
}

void setupApp()

app.on('before-quit', (event) => {
  if (quitting || sidecar === null) {
    return
  }

  event.preventDefault()
  quitting = true

  const currentSidecar = sidecar

  void (async (): Promise<void> => {
    try {
      // Flush before disposal (skips if a window-close flush already ran).
      await workspaceTeardown?.flushOnce()
    } finally {
      browserPaneController?.dispose()
      browserPaneController = null
      workspaceLayoutController?.dispose()
      workspaceLayoutController = null

      try {
        await currentSidecar.shutdown()
      } finally {
        app.exit(0)
      }
    }
  })()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

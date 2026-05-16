import { app, BrowserWindow, ipcMain, net, protocol, session } from 'electron'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isAllowedBackendMethod } from './backend-methods'
import { BACKEND_EVENT, BACKEND_INVOKE } from './ipc-channels'
import { spawnSidecar, type Sidecar } from './sidecar'

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

const resolveSidecarBin = (): string => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', BINARY_NAME)
  }

  return path.resolve(__dirname, '..', 'target', 'debug', BINARY_NAME)
}

const packagedContentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
].join('; ')

const devContentSecurityPolicy = [
  "default-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline' http://localhost:* http://127.0.0.1:*",
  "style-src 'self' 'unsafe-inline' http://localhost:* http://127.0.0.1:*",
  "img-src 'self' data: blob: http://localhost:* http://127.0.0.1:*",
  "font-src 'self' data: http://localhost:* http://127.0.0.1:*",
  "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
].join('; ')

// Vite React dev mode injects an inline preamble; WDIO also injects an
// inline bootstrap in E2E. This stays limited to non-packaged builds.
const devE2eContentSecurityPolicy = devContentSecurityPolicy

const installContentSecurityPolicy = (): void => {
  if (app.isPackaged) {
    return
  }

  const csp = isE2eRuntime()
    ? devE2eContentSecurityPolicy
    : devContentSecurityPolicy

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

interface BackendInvokePayload {
  method: string
  args?: Record<string, unknown>
}

type InvokeEnvelope =
  | { ok: true; result: unknown }
  | { ok: false; error: string }

let sidecar: Sidecar | null = null
let quitting = false

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.mjs'),
    },
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

  if (app.isPackaged) {
    registerAppProtocol()
  }

  const spawnedSidecar = spawnSidecar({
    binary: resolveSidecarBin(),
    appDataDir: app.getPath('userData'),
  })

  sidecar = spawnedSidecar
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
        return {
          ok: false,
          error: typeof err === 'string' ? err : String(err),
        }
      }
    }
  )

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
      await currentSidecar.shutdown()
    } finally {
      app.exit(0)
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

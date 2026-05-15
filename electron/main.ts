import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BACKEND_EVENT, BACKEND_INVOKE } from './ipc-channels'
import { spawnSidecar, type Sidecar } from './sidecar'

// __dirname is not defined in ESM modules. Derive it from import.meta.url.
// vite-plugin-electron bundles main.ts as ESM (main.js) under
// package.json:type=module, so we need the ESM-compatible idiom.
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const BINARY_NAME =
  process.platform === 'win32' ? 'vimeflow-backend.exe' : 'vimeflow-backend'

const resolveSidecarBin = (): string => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', BINARY_NAME)
  }

  return path.resolve(
    __dirname,
    '..',
    'src-tauri',
    'target',
    'debug',
    BINARY_NAME
  )
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

  if (!app.isPackaged && devUrl !== undefined && devUrl.length > 0) {
    void win.loadURL(devUrl)

    return
  }

  void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

const setupApp = async (): Promise<void> => {
  await app.whenReady()

  const spawnedSidecar = spawnSidecar({
    binary: resolveSidecarBin(),
    appDataDir: app.getPath('userData'),
  })

  sidecar = spawnedSidecar

  ipcMain.handle(
    BACKEND_INVOKE,
    async (_ipcEvent, payload: unknown): Promise<InvokeEnvelope> => {
      if (!isBackendInvokePayload(payload)) {
        return { ok: false, error: 'invalid backend invoke payload' }
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

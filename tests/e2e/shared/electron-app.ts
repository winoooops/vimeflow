import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const repoRoot = path.resolve(__dirname, '../../..')

// Bundled main entry produced by `vite build --mode electron`.
// vite-plugin-electron's underlying `lib` config sets formats:['es'] +
// fileName:'[name].js' (see node_modules/vite-plugin-electron/dist/index.mjs:17),
// so this is always `.js` regardless of root package.json:type. The .mjs
// extension is reserved for preload (the plugin's deliberate override).
// @wdio/electron-service resolves the Electron binary itself from local
// node_modules.
export const appEntryPoint = path.resolve(repoRoot, 'dist-electron/main.js')

// WDIO service onPrepare hooks run before config onPrepare hooks. Set this
// while loading the shared Electron app config so the service-spawned main
// process inherits it and exposes E2E-only backend methods.
process.env.VITE_E2E = '1'

// Per-WDIO-session app-data dir. Electron's --user-data-dir CLI flag
// reroutes app.getPath('userData'); the sidecar inherits the rerouted
// path via spawnSidecar({ appDataDir: app.getPath('userData') }) in
// electron/main.ts. Without this isolation, the e2e-test Cargo
// feature's cache-wipe doesn't fire on the sidecar code path (it only
// runs inside Tauri's lib.rs setup() block, which Electron skips), so
// sessions.json would leak between WDIO workers and break the
// terminal specs that assume a fresh default session. See spec section 5.7.
const sessionUserDataDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'vimeflow-e2e-')
)

// --no-sandbox is required on most Linux dev hosts and CI runners that
// don't ship a SUID chrome-sandbox; this matches what the Tauri/wry
// path effectively ran without. NOT applied to `npm run electron:dev`
// (vite-plugin-electron's startup(['.']) hook keeps the default
// sandboxed mode). Packaged production builds (PR-D3) re-enable the
// sandbox.
export const appArgs: string[] = [
  '--no-sandbox',
  '--vimeflow-e2e',
  `--user-data-dir=${sessionUserDataDir}`,
]

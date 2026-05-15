import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const repoRoot = path.resolve(__dirname, '../../..')

// Bundled main entry produced by `vite build --mode electron`. The plugin's
// `lib` config hard-codes `fileName: () => '[name].js'`, so this stays
// .js regardless of root package.json:type. The .mjs extension is
// reserved for preload (the plugin's deliberate override).
// @wdio/electron-service resolves the Electron binary itself from local
// node_modules.
export const appEntryPoint = path.resolve(repoRoot, 'dist-electron/main.js')

// Base CLI args passed to every WDIO Electron session. --user-data-dir is
// added per session in beforeSession (see injectFreshUserDataDir) — at
// module-load time we don't yet know which session is starting, and a
// shared dir would let one spec's sessions.json bleed into the next.
//
// --no-sandbox is required on most Linux dev hosts and CI runners that
// don't ship a SUID chrome-sandbox; this matches what the Tauri/wry
// path effectively ran without. NOT applied to `npm run electron:dev`
// (vite-plugin-electron's startup(['.']) hook keeps the default
// sandboxed mode). Packaged production builds (PR-D3) re-enable the
// sandbox.
//
// --vimeflow-e2e is the Electron-side detection fallback for the
// E2E-only backend-method allowlist (electron/main.ts:isE2eRuntime).
export const appArgs: string[] = ['--no-sandbox', '--vimeflow-e2e']

// Tracks the temp dirs created by injectFreshUserDataDir across all
// sessions in this WDIO process so the exit-time safety net can clean up
// anything afterSession missed (crash, kill -9, etc).
const activeUserDataDirs = new Set<string>()

/**
 * Mutate the per-session capabilities to inject a fresh isolated
 * --user-data-dir. Called from each wdio.conf.ts `beforeSession` hook.
 *
 * Per-spec freshness is the contract that compensates for the Tauri
 * e2e-test Cargo feature's cache-wipe NOT firing on the Electron sidecar
 * code path. Without a fresh dir per session, sessions.json written by
 * one spec would be observed by the next.
 */
export const injectFreshUserDataDir = (
  capabilities: WebdriverIO.Capabilities
): void => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vimeflow-e2e-'))
  activeUserDataDirs.add(dir)
  const electronOpts = capabilities['wdio:electronServiceOptions'] ?? {}
  const baseArgs = electronOpts.appArgs ?? []
  capabilities['wdio:electronServiceOptions'] = {
    ...electronOpts,
    appArgs: [...baseArgs, `--user-data-dir=${dir}`],
  }
}

/**
 * Remove every temp dir this process created and forget them. Called
 * from each wdio.conf.ts `afterSession` hook. With `maxInstances: 1`
 * only one session is active at a time, so clearing the entire set
 * is safe.
 */
export const cleanupUserDataDirs = (): void => {
  for (const dir of activeUserDataDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // ignore — directory may already be gone or unreadable
    }
  }
  activeUserDataDirs.clear()
}

// Process-exit safety net in case `afterSession` doesn't fire (WDIO
// crash, SIGKILL). Best-effort: macOS /tmp is persistent so accumulated
// dirs would otherwise grow unbounded across local dev runs.
process.on('exit', cleanupUserDataDirs)

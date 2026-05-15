# PR-D1 — Electron shell + sidecar wiring (Design Spec)

## 1. Goal & Roadmap Context

**Goal:** Add Electron as a **parallel** desktop runtime to Tauri. Spawn the
existing `vimeflow-backend` sidecar from Electron main, expose
`window.vimeflow.invoke` / `.listen` via preload's `contextBridge`, and let
the post-PR-C bridge auto-route through the sidecar IPC path when the
Electron host is in use. Tauri stays alive in this PR — both
`npm run tauri:dev` and the new `npm run electron:dev` work side-by-side
out of the same tree.

**Architecture:** Layered handoff. Renderer code is unchanged (PR-C's
`src/lib/backend.ts` already prefers `window.vimeflow` over the
`@tauri-apps/api` fallback). `electron/preload.ts` exposes a minimal
`{ invoke, listen }` API via `contextBridge` that proxies to `ipcMain`
in `electron/main.ts`. `main.ts` owns one `Sidecar` instance
(`electron/sidecar.ts` — a deep module wrapping `child_process.spawn`,
the LSP-framed stdout reader (`Content-Length: N\r\n\r\n<body>` parity
with PR-B's `runtime::ipc::frame` codec), the pending-request map, and
the listener registry). Sidecar startup is **lazy** — `app.whenReady()`
spawns the sidecar with
`['--app-data-dir', app.getPath('userData')]` (required — the
sidecar exits with code 2 if absent) and creates the BrowserWindow
concurrently; stdin buffers any early invokes. Crash semantics: sidecar
exit → reject all pending requests with `'sidecar exited unexpectedly'`,
log to electron stderr, no auto-restart. Renderer events are fanned out
via `webContents.send('backend:event', { event: eventName, payload })`
to every `BrowserWindow.getAllWindows()` entry (forward-compat for
multi-window even though the v1 ship is single-window); preload filters
on `eventName` and forwards the bare `payload` to the renderer callback
so PR-C's `listen<T>` bare-payload contract is preserved end-to-end.

**Tech Stack:** Electron (latest stable major at the time the PR opens —
pin in `package.json` at implementation time, not at spec time, since
Electron releases on a fast cadence and the currently-supported set is
the latest three stable majors), `vite-plugin-electron/simple`
(canonical 2026 bundler for adding Electron to an existing Vite
renderer; its dev-mode auto-launch removes the need for an external
runner so no `concurrently` / `wait-on` are added). No new TypeScript
runtime deps for the renderer — preload talks to main via Electron's
built-in `ipcRenderer`/`ipcMain`, main talks to the sidecar via Node's
built-in `child_process` plus the LSP-style `Content-Length` framing
defined in PR-B's `src-tauri/src/runtime/ipc.rs::frame` module. The
sidecar binary itself (`vimeflow-backend`) lands unchanged from PR-B.

**Prior PRs (locked):**

- PR-A: `BackendState` + `EventSink` + `TauriEventSink` + `FakeEventSink`
  (`docs/superpowers/specs/2026-05-13-pr-a-runtime-neutral-rust-backend-design.md`)
- PR-B: `vimeflow-backend` bin + `runtime/ipc.rs` LSP framing + router +
  `StdoutEventSink` (`docs/superpowers/specs/2026-05-13-pr-b-rust-sidecar-ipc-design.md`)
- PR-C: `src/lib/backend.ts` bridge + 7 renderer files migrated; bridge
  falls back to `@tauri-apps/api` when `window.vimeflow` is unset
  (`docs/superpowers/specs/2026-05-14-pr-c-frontend-backend-bridge-design.md`)

**Migration roadmap:** `docs/superpowers/plans/2026-05-13-electron-rust-backend-migration.md`
is the original index (originally "one PR", then split into A/B/C/D, then
D further split into D1/D2/D3 for reviewer load — 6 PRs total). This spec
implements migration plan **Tasks 1 + 7** ("Add Electron Shell" + "Wire
Electron Main to the Rust Sidecar"). Tasks 9 (E2E driver swap), 10 (Tauri
runtime removal), and 11 (packaging smoke) ship in PR-D2 and PR-D3
respectively.

**What this PR does NOT do:**

- Remove `@tauri-apps/api` or `@tauri-apps/cli` — fallback path in
  `src/lib/backend.ts` stays alive (deferred to PR-D3).
- Remove `tauri = "2.11"` or `tauri-plugin-log` Rust deps — Tauri host
  in `src-tauri/src/lib.rs` keeps compiling (deferred to PR-D3).
- Swap E2E driver away from `tests/e2e/shared/tauri-driver.ts`
  (deferred to PR-D2).
- Package the app with `electron-builder` — `electron:build` is **not**
  introduced in this PR; full packaging script lands in PR-D3.
- Rename `src-tauri/` to a backend-neutral directory (deferred,
  follow-up after D3).
- Add auto-update, code signing, notarization (out of scope per the
  migration plan).

**Compatibility contract (stable across the migration):**

- Command names: `spawn_pty`, `write_pty`, `resize_pty`, `kill_pty`,
  `list_sessions`, `set_active_session`, `reorder_sessions`,
  `update_session_cwd`, `detect_agent_in_session`, `start_agent_watcher`,
  `stop_agent_watcher`, `list_dir`, `read_file`, `write_file`,
  `git_status`, `git_branch`, `get_git_diff`, `start_git_watcher`,
  `stop_git_watcher` (+ `list_active_pty_sessions` under `e2e-test`).
- Event names: `pty-data`, `pty-exit`, `pty-error`, `agent-status`,
  `agent-tool-call`, `agent-turn`, `test-run`, `git-status-changed`.
- Payload shapes: bare-payload (NOT Tauri's `Event<T>` envelope) —
  enforced by PR-C's bridge and by the sidecar router's frame format.
- Renderer-facing surface: `window.vimeflow.invoke<T>(method, args?)`
  and `window.vimeflow.listen<T>(event, cb): Promise<UnlistenFn>`.

**Process model:**

```text
React renderer (Vite-served HTML)
  ↓ window.vimeflow.invoke<T>(method, args)
  ↓ window.vimeflow.listen<T>(event, cb): Promise<UnlistenFn>
electron/preload.ts (contextBridge allowlist — invoke + listen only)
  invoke → ipcRenderer.invoke('backend:invoke', { method, args })
  listen → ipcRenderer.on('backend:event', (_ipcEvent, msg) =>
            msg.event === <subscribed-event> && cb(msg.payload))
electron/main.ts (BrowserWindow + ipcMain.handle)
  ipcMain.handle('backend:invoke', async (_e, { method, args }) => {
    try { return { ok: true, result: await sidecar.invoke(method, args) } }
    catch (e) { return { ok: false, error: typeof e === 'string' ? e : String(e) } }
  })                                                      // envelope, never rethrows
  sidecar.onEvent((event, payload) =>
    BrowserWindow.getAllWindows().forEach(w =>
      w.webContents.send('backend:event', { event, payload })))
electron/sidecar.ts (Sidecar instance — owns child process)
  spawn(BIN, ['--app-data-dir', app.getPath('userData')])
  stdout reader → LSP frame codec → router (response | event)
  pending-request map: Map<string, {resolve, reject}>
src-tauri/target/debug/vimeflow-backend  (binary unchanged from PR-B)
  runtime::ipc::run → router dispatch → BackendState  (PR-A)
```

## 2. File Structure

### New (6 files)

- `electron/main.ts` — Electron entry.
  - App lifecycle:
    - `app.whenReady` — three-step ordered sequence to avoid the
      early-invoke race:
      1. `const sidecar = spawnSidecar({ binary: SIDECAR_BIN, appDataDir: app.getPath('userData') })`.
      2. **Register `ipcMain.handle(BACKEND_INVOKE, ...)` and
         `sidecar.onEvent(...)` BEFORE step 3.** This guarantees that
         a renderer firing `window.vimeflow.invoke` immediately on
         page load has a handler ready on the main side; the sidecar
         child has already started reading stdin so the request frame
         is buffered cleanly.
      3. `createWindow()` → `BrowserWindow` instance →
         `browserWindow.loadURL(devURL)`.
    - `before-quit` — gate the quit on the async shutdown using
      `event.preventDefault()` + a `quitting` flag. The full pattern
      is required because Electron does NOT await async listeners
      on `before-quit`:

      ```ts
      let quitting = false
      app.on('before-quit', (event) => {
        if (quitting) return // second-pass: shutdown done, let it quit
        event.preventDefault()
        quitting = true
        sidecar.shutdown().finally(() => app.exit(0))
      })
      ```

      `sidecar.shutdown()` closes stdin (clean EOF), waits up to
      **5500 ms** for the child to exit on its own — matching PR-B's
      sidecar shutdown contract which waits up to 5 s for handlers
      to drain before running `state.shutdown()`, plus a 500 ms
      grace — then escalates to `SIGTERM` and finally `SIGKILL`.
      The pending-request map drains with `'app quitting'`
      rejection at the start of `shutdown()`.

    - `window-all-closed` — follows Electron convention. On Linux
      and Windows it calls `app.quit()` (which fires `before-quit` →
      sidecar shutdown). On macOS it leaves the application running
      per platform UX (user must press `Cmd+Q` explicitly to
      trigger `before-quit` → shutdown).
    - `app.on('activate', ...)` — macOS-specific. When the dock icon
      is clicked after all windows were closed, recreate the
      BrowserWindow: `if (BrowserWindow.getAllWindows().length === 0) createWindow()`.
      Without this handler, macOS users who close the window have
      no way to reopen the UI; the sidecar would continue running
      with no visible app.

  - **Dev-mode tree-kill caveat:** `vite-plugin-electron`'s cleanup
    hook tree-kills the Electron process on Ctrl+C / vite shutdown,
    which means `before-quit` does NOT fire and the sidecar receives
    SIGHUP/SIGTERM mid-flight without going through `state.shutdown()`.
    The session cache is preserved (sidecar exit without shutdown
    leaves the cache file intact; next launch's lazy-reconciliation
    in `list_sessions` flips all sessions to Exited per PR-A's
    contract), so this is recoverable — but it is NOT a clean
    shutdown. Recommended clean-exit paths in dev: close the
    BrowserWindow on Linux/Windows, or Cmd+Q on macOS; both fire
    `before-quit`. Ctrl+C in the dev terminal is the "emergency
    stop" — fast but skips the cache wipe.
  - **Known limitation (deferred):** the sidecar's `state.shutdown()`
    clears the session cache but does NOT kill spawned PTY child
    processes — PR-B's sidecar exit leaves PTY descendants alive
    (same behavior as Tauri's current `RunEvent::ExitRequested`
    path). PR-D1 maintains parity; PTY orphan cleanup is a
    follow-up (could land in PR-D3 or as a separate small PR).
  - Sidecar binary path resolution: at runtime `main.ts` resolves the
    binary as
    `path.resolve(__dirname, '..', 'src-tauri', 'target', 'debug', BINARY_NAME)`
    where `BINARY_NAME` is `'vimeflow-backend.exe'` on
    `process.platform === 'win32'` and `'vimeflow-backend'`
    elsewhere. `__dirname` is `dist-electron/`, so the resolved path
    points at the cargo dev-target. Production (`process.resourcesPath`)
    resolution is deferred to PR-D3 (packaging).
  - **ESM `__dirname` derivation:** the bundled main is ESM
    (`dist-electron/main.js`), so the CommonJS global `__dirname` is
    not defined. `main.ts` must derive it explicitly near the top
    of the file:

    ```ts
    import path from 'node:path'
    import { fileURLToPath } from 'node:url'
    const __dirname = path.dirname(fileURLToPath(import.meta.url))
    ```

    Without this, every `path.join(__dirname, …)` call throws
    `ReferenceError: __dirname is not defined in ES module scope`
    and Electron crashes during `app.whenReady`.

  - `BrowserWindow` config: 1400×900, min 800×600, title "Vimeflow",
    resizable (matches `src-tauri/tauri.conf.json`).
    `webPreferences`: `contextIsolation: true`, `nodeIntegration: false`,
    `sandbox: true`, `preload: path.join(__dirname, 'preload.mjs')`
    (relative to `dist-electron/main.js` after bundling — and
    `__dirname` is derived from `import.meta.url` because the
    bundled main is ESM; see §4 implementation note). Dev:
    `loadURL('http://localhost:5173')`; production-equivalent
    `loadFile(path.join(__dirname, '..', 'dist', 'index.html'))` is
    wired up but exercised by PR-D3's packaging smoke — Tauri remains
    the default packaged shell through end of PR-D2.
  - Owns one `Sidecar` instance (`electron/sidecar.ts`). Wires
    `ipcMain.handle(BACKEND_INVOKE, ...)` and the event-forwarding
    callback. **The `ipcMain.handle` callback MUST return an envelope
    `{ ok, result, error }`, never rethrow** — Electron serializes
    thrown values via Error-message coercion and would otherwise turn
    PR-C's bare-string rejection contract (e.g.
    `'PTY session not found'`) into `Error('Error invoking remote method ...')`
    on the renderer side. Shape:

    ```ts
    ipcMain.handle(BACKEND_INVOKE, async (_e, { method, args }) => {
      try {
        return { ok: true, result: await sidecar.invoke(method, args) }
      } catch (err) {
        return { ok: false, error: typeof err === 'string' ? err : String(err) }
      }
    })
    sidecar.onEvent((event, payload) =>
      BrowserWindow.getAllWindows().forEach((w) =>
        w.webContents.send(BACKEND_EVENT, { event, payload })
      )
    )
    ```

- `electron/preload.ts` — Sole
  `contextBridge.exposeInMainWorld('vimeflow', { invoke, listen })`
  call.
  - `invoke<T>(method, args)`: calls
    `ipcRenderer.invoke(BACKEND_INVOKE, { method, args })`, awaits the
    envelope, and **unwraps**: returns `envelope.result as T` on
    `ok: true`; **throws the bare `envelope.error` string** on
    `ok: false`. This preserves PR-C's "rejection value passes through
    unchanged" contract (Tauri rejects with a bare string; the
    sidecar path must too).
  - `listen<T>(event, callback)`: returns
    `Promise<UnlistenFn>` (matching `BackendApi.listen` in
    `src/lib/backend.ts`). On the synchronous path it registers
    `ipcRenderer.on(BACKEND_EVENT, handler)` where `handler` filters
    on the `event` name (matching the subscriber's `event` parameter)
    and invokes `callback(payload)` with the bare payload — no
    Electron `IpcRendererEvent` exposed to the renderer. The Promise
    resolves with a teardown function that calls
    `ipcRenderer.off(BACKEND_EVENT, handler)`. (The Promise wrapper
    is required by the bridge's `BackendApi` shape even though
    `ipcRenderer.on` itself is synchronous — preload returns
    `Promise.resolve(teardown)`.)
  - NO other Node, Electron, or filesystem APIs reach the renderer.
- `electron/sidecar.ts` — Deep module.
  - Owns the child process spawned with
    `['--app-data-dir', app.getPath('userData')]`.
  - Owns the LSP frame codec (parity with
    `src-tauri/src/runtime/ipc.rs::frame` — same
    `Content-Length: N\r\n\r\n<body>` shape, same `MAX_FRAME_BYTES`
    16 MiB cap).
  - Owns the pending-request map (`Map<string, {resolve, reject}>`).
    `invoke(method, args)` returns a `Promise<T>` that **resolves** on
    `ok: true` response frames with the bare `result` value, and
    **rejects** with the bare `error` string on `ok: false` response
    frames — matching `src/lib/backend.ts`'s pass-through-unchanged
    rejection contract so existing call-sites that compare against the
    Tauri error string keep working.
  - Owns the listener registry (`(event, payload) => void`).
  - Owns the crash handler. On unexpected child exit (no preceding
    `before-quit` shutdown signal): drain the pending map with
    `'sidecar exited unexpectedly'` rejection, log to electron stderr,
    set an internal "disabled" flag so subsequent `invoke()` calls
    reject immediately with `'backend unavailable'`. No auto-restart
    in v1.
- `electron/sidecar.test.ts` — Vitest unit suite. Covers: frame codec
  roundtrip (encode → decode roundtrip; partial-frame buffering;
  fatal-on-malformed-header — the Electron decoder has no resync
  budget, see §4.3), pending-map cleanup on `response`, pending-map
  drain on simulated child exit, event fan-out to registered
  listeners, listener teardown idempotency, oversize-frame fatal
  handling. Uses a `MockChildProcess` (`PassThrough` streams +
  manual `emit('exit')`) in lieu of an actual `vimeflow-backend`
  binary, wired through the `createSidecar({ ...options, spawnFn })`
  test-only factory described in §4.1 / §4.7.
- `electron/ipc-channels.ts` — Two named constants used by `main.ts`
  and `preload.ts` to avoid stringly-typed channel mismatch:
  `BACKEND_INVOKE = 'backend:invoke'`,
  `BACKEND_EVENT = 'backend:event'`.
- `electron/tsconfig.json` — IDE / language-server + type-check
  config (`noEmit: true`). Stand-alone (does NOT extend
  `../tsconfig.json` — the root has `noEmit` interaction quirks with
  project references; a flat config keeps the Electron build path
  independent). Explicit options:
  `target: "es2022"`, `module: "esnext"`,
  `moduleResolution: "bundler"` (Vite-aligned; allows
  `import.meta.url` and pass-through `.ts` extensions without
  requiring `.js` suffixes on relative imports), `strict: true`,
  `noEmit: true`, `esModuleInterop: true`, `skipLibCheck: true`,
  `isolatedModules: true`, `types: ["node"]`,
  `include: ["./**/*.ts"]` (test files included — they need
  type-checking even though `vite-plugin-electron`'s bundler ignores
  them). The actual JavaScript output is produced by
  `vite-plugin-electron`, whose defaults under root
  `package.json:type=module` emit:
  - **`dist-electron/main.js`** as ESM (Electron 28+ supports an ESM
    main process when `type=module`; the bundled module uses
    top-level `import` and is loaded directly by Electron).
  - **`dist-electron/preload.mjs`** with CJS-style content
    (`require('electron')`) — the plugin's deliberate convention for
    preload scripts under sandbox + contextIsolation, and Electron's
    preload loader handles this special case.

  Custom `build.lib` / `rollupOptions.output` configs to force CJS
  are NOT used: `vite.mergeConfig` concatenates `lib.formats` arrays
  rather than replacing them, so a `formats: ['cjs']` override is
  merged into `['es', 'cjs']`, producing dual builds that overwrite
  each other into a hybrid output (top-level `import` + `__commonJS`
  wrapper + `export default` tail) which parses as neither ESM nor
  CJS. Accepting the plugin defaults is the supported path.

  Because root `tsconfig.json:include = ["src"]` deliberately
  excludes `electron/**` (the renderer build path must not see Node
  globals), `npm run type-check` is updated to run BOTH configs:
  `"type-check": "tsc -b && tsc -p electron/tsconfig.json"`. This
  way every `.ts` file in the repo is type-checked exactly once.

### Modified (5 files)

- `package.json`:
  - Add `devDependencies`: `electron`, `vite-plugin-electron` (the
    `/simple` API form is used in `vite.config.ts`). Versions
    resolved at implementation time — pin to the latest stable
    Electron major. **No `concurrently` / `wait-on` deps** — Vite +
    `vite-plugin-electron`'s built-in dev-mode auto-launch removes
    the need for an external runner (a single `vite --mode electron`
    process compiles `main.ts`, starts the renderer dev server, then
    spawns Electron pointed at the dev URL once the renderer is
    ready).
  - Add `"main": "dist-electron/main.js"` (top-level field — Electron
    reads this when launched as `electron .`). The `.js` extension
    pairs with root `package.json:type=module` and Electron loads
    the file as ESM.
  - Add scripts:
    - `"electron:dev": "npm run backend:build && vite --mode electron"`
    - `"backend:build": "cd src-tauri && cargo build --bin vimeflow-backend"`
  - **Modify** the existing `type-check` script from `"tsc -b"` to
    `"tsc -b && tsc -p electron/tsconfig.json"` so the Electron
    files are also type-checked.
  - Leave `tauri:dev` and `tauri:build` scripts untouched.
  - **No `electron:start` and no `electron:build` scripts in this PR**
    — Vite's `--mode electron` flag is the single entry point for
    dev; packaging (`electron:build`) is deferred to PR-D3.
- `vite.config.ts` — **Additive** edit (preserve every existing key —
  `react()`, `gitApiPlugin()`, `fileApiPlugin()`, `define.__APP_VERSION__`,
  `server.watch.ignored`, etc.). Three additions:
  1. Import `vite-plugin-electron/simple` and **gate it behind
     `mode === 'electron'`** so `npm run dev` (mode `development`)
     stays renderer-only and only `npm run electron:dev`
     (mode `electron`) loads the plugin and auto-launches Electron.
     The plugin is appended to the existing `plugins` array,
     conditionally:

     ```ts
     // ADD at the top of the file:
     import electron from 'vite-plugin-electron/simple'

     // MODIFY the existing defineConfig export to accept `mode` and
     // conditionally append the electron plugin. ALL prior plugin
     // entries (react, gitApiPlugin, fileApiPlugin, …) and ALL
     // prior config keys (define.__APP_VERSION__, server.watch.ignored,
     // …) are preserved verbatim — only the marked block is new.
     export default defineConfig(({ mode }) => ({
       plugins: [
         react(),
         gitApiPlugin(),
         fileApiPlugin(),
         // ⟨…existing plugins kept…⟩
         ...(mode === 'electron'
           ? [
               electron({
                 // Use vite-plugin-electron/simple defaults. With root
                 // package.json:type=module, the plugin emits
                 // dist-electron/main.js (ESM) and
                 // dist-electron/preload.mjs (CJS-content). Custom
                 // build.lib / rollupOptions.output configs to force CJS
                 // fight the plugin defaults because mergeConfig
                 // concatenates `lib.formats` arrays, producing dual
                 // overwriting builds. Accept the defaults; the only
                 // override needed is the `onstart` sandbox patch.
                 main: {
                   entry: 'electron/main.ts',
                   // Drop --no-sandbox from the plugin's default
                   // startup so production sandbox parity is preserved
                   // in dev (see §5.1 "Dev-mode caveat" for the threat
                   // model).
                   onstart: ({ startup }) => {
                     void startup(['.'])
                   },
                   vite: { build: { outDir: 'dist-electron' } },
                 },
                 preload: {
                   input: 'electron/preload.ts',
                   vite: { build: { outDir: 'dist-electron' } },
                 },
               }),
             ]
           : []),
       ],
       define: { __APP_VERSION__: JSON.stringify(packageJson.version) }, // existing
       server: {
         strictPort: true,
         port: 5173,
         // EXTEND (do not replace) the existing watch.ignored list.
         // Existing patterns ('.codex*', '.lifeline-planner', '.vimeflow',
         // 'target', '.git', etc.) MUST be preserved verbatim — only
         // 'dist-electron' is added here.
         watch: {
           ignored: [
             /* …all existing patterns from the current vite.config.ts… */
             '**/dist-electron/**',
           ],
         },
       },
       base: './',
     }))
     ```

  2. Set `server.strictPort: true` so the renderer dev server fails
     loudly if port 5173 is occupied rather than silently moving to
     5174 — `vite-plugin-electron`'s auto-launch depends on the port
     being deterministic.

  3. The plugin's dev-mode auto-launch handles the run-Electron step,
     replacing the `concurrently` + `wait-on` + `electron .` chain.
     Build-output paths and `package.json:main` (`dist-electron/main.js`)
     stay aligned with the plugin's ESM defaults.

  Keep `base: './'` (already set). No alias / build-target changes to
  the renderer half.

- `.gitignore` — Add `dist-electron/` so the Vite-bundled main/preload
  output is ignored.
- `vitest.config.ts` — Verify `electron/**/*.test.ts` is picked up
  (Vitest's default `include` does cover `electron/sidecar.test.ts`,
  but this repo's `vitest.config.ts` adds an `exclude` list — confirm
  `electron/` is not accidentally excluded). Optionally add
  `electron/**` to `coverage.exclude` if coverage thresholds otherwise
  drop because `electron/main.ts` and `electron/preload.ts` are not
  unit-tested. Note: this repo uses a separate `vitest.config.ts` (not
  `vite.config.ts`'s `test` block) — edits MUST go in that file.
- `package-lock.json` — Auto-updated by `npm install` when adding the
  new `electron` and `vite-plugin-electron` devDependencies. Must be
  committed alongside the `package.json` edit so CI's `npm ci` stays
  in sync. No hand edits — let `npm install` regenerate.

### Files NOT touched

- `src/**` — Renderer is unchanged. PR-C's `src/lib/backend.ts` already
  detects `window.vimeflow` at call time and falls back to
  `@tauri-apps/api` otherwise; nothing in the renderer needs to know
  which host launched it.
- `src-tauri/**` — Rust runtime, sidecar binary, Tauri host all
  unchanged. The sidecar binary is already built by PR-B's `[[bin]]`
  block.
- `tests/e2e/**` — E2E suite stays on `tauri-driver.ts` through PR-D2.
- `src-tauri/Cargo.toml` — No Rust dep changes.
- `src-tauri/tauri.conf.json` — Tauri config stays through PR-D3.
- `tsconfig.json` (root) — Renderer config unchanged; its
  `include: ["src"]` already excludes `electron/**`, so the new
  Electron files do not pollute the renderer's type-check.
- `eslint.config.ts` — No new lint rules in PR-D1; the
  `no-restricted-imports` rule that bans `@tauri-apps/api` outside
  `src/lib/backend.ts` is deferred to PR-D3 (when the dep is removed).

## 3. Build Tooling & Dev Workflow

This section pins the moving parts that make `npm run electron:dev` and
`npm run test` work — the contract above this layer (file structure)
already establishes WHAT exists; this section explains HOW it builds
and runs together.

### 3.1 — `npm run electron:dev` flow

The script chain is deterministic and uses `vite-plugin-electron`'s
dev-mode auto-launch — no external runner (`concurrently` / `wait-on`)
needed:

1. `npm run electron:dev` invokes
   `npm run backend:build && vite --mode electron`.
2. **Cargo step (blocking)** — `npm run backend:build` runs
   `cd src-tauri && cargo build --bin vimeflow-backend`. No-op on
   warm caches; cold cache is ~30-60s. Intentionally blocking — we
   will NOT launch Electron with a stale or missing sidecar binary.
3. **Vite step** — `vite --mode electron` reads `vite.config.ts`,
   sees `mode === 'electron'`, loads the `vite-plugin-electron/simple`
   plugin. The plugin:
   1. Bundles `electron/main.ts` → `dist-electron/main.js` (ESM —
      see §3.2 / §2 `electron/tsconfig.json` for why we accept the
      plugin's ESM default rather than forcing CJS).
   2. Bundles `electron/preload.ts` → `dist-electron/preload.mjs`
      (CJS-content under an `.mjs` extension — the plugin's
      deliberate convention for preload scripts; Electron's preload
      loader handles this special case).
   3. Starts the renderer dev server on `http://localhost:5173`
      (Vite's standard pipeline, `strictPort: true`).
   4. Once both bundled outputs are written AND the dev server is
      listening, the plugin spawns `electron .`. Electron reads
      `package.json:main` → `dist-electron/main.js` → spawns
      `vimeflow-backend` with `--app-data-dir` → opens BrowserWindow
      at `http://localhost:5173`.

**Shutdown:** the cleanest stop fires `before-quit` so the sidecar
runs `state.shutdown()` and wipes the session cache:

- **Linux / Windows**: close the BrowserWindow — `window-all-closed`
  calls `app.quit()` → `before-quit` → 5500 ms drain → exit.
- **macOS**: press Cmd+Q (closing the window alone leaves Electron
  running per platform UX) — also fires `before-quit`.

Ctrl+C in the dev terminal is the **emergency stop**, not the clean
path: `vite-plugin-electron`'s cleanup hook tree-kills the Electron
process tree (it does not send a request to quit), so `before-quit`
NEVER fires and the sidecar receives SIGHUP/SIGTERM mid-flight
without going through `state.shutdown()`. The session cache file is
preserved on disk (un-modified), and PR-A's lazy-reconciliation in
`list_sessions` flips its entries to Exited on the next launch —
recoverable but not clean. Prefer the window-close / Cmd+Q paths
above when shutting down between iterations.

### 3.2 — vite-plugin-electron output behavior

`vite-plugin-electron` runs Vite/Rollup once for each entry. With root
`package.json:type=module`, its defaults produce:

- **`dist-electron/main.js`** — ESM module loaded directly by
  Electron 28+ (which honors `package.json:type=module` for the main
  process). The bundled file uses top-level `import` for `electron`
  and `node:*` externals. `__dirname` is not defined in ESM scope,
  so `electron/main.ts` derives it via
  `path.dirname(fileURLToPath(import.meta.url))` (see §4 main.ts
  contract).
- **`dist-electron/preload.mjs`** — CJS-content
  (`"use strict"; const electron = require("electron")…`) but with
  `.mjs` extension. The plugin emits this combination on purpose
  for preload under sandbox + contextIsolation: Electron's preload
  loader handles `.mjs`-with-`require` specially. Do not try to
  rename the extension to `.cjs` — the plugin's preload pipeline
  rewrites it back.

In dev mode (`vite` + `electron:dev`), the plugin watches
`electron/**/*.ts` and rebuilds on change. By default, when
`main.ts` changes the plugin restarts the Electron process; when
`preload.ts` changes the plugin reloads the affected renderer
windows. Both are appropriate for our case — we do not need to
override the plugin's restart/reload behavior in PR-D1.

**Why not force CJS via `build.lib.formats: ['cjs']` or
`rollupOptions.output.format: 'cjs'`?** Vite's `mergeConfig` deep-merges
arrays by concatenation, not replacement. The plugin's internal default
sets `lib.formats: ['es']` (under `type=module`) and our `['cjs']` is
appended to `['es', 'cjs']`, producing two builds for the same entry
that race to write the same path. The result is a hybrid file (top-level
`import` for externals, `__commonJS` factory wrapper for user code, and
`export default require_main();` tail) that parses as neither ESM nor
CJS — observed in PR-D1 implementation: `SyntaxError: Cannot use import
statement outside a module` followed (after a `.cjs`→`.mjs` rename
attempt) by `SyntaxError: Unexpected token '}'` on the trailing
`export default`. Accepting the plugin's defaults is the supported path.

### 3.3 — Vitest discovery for `electron/sidecar.test.ts`

This repo uses a dedicated `vitest.config.ts` (separate from
`vite.config.ts`), so any test-config edits MUST land in
`vitest.config.ts`, not in the Vite config. The current
`vitest.config.ts` has no explicit `test.include` and Vitest's default
matches `**/*.test.{ts,tsx}`, which covers `electron/sidecar.test.ts`.
The current `test.exclude` list does NOT exclude `electron/**`, so the
suite picks up automatically.

Verification step at implementation time:
`npx vitest run electron/sidecar.test.ts` must locate and run the
suite. If discovery fails for any reason, add an explicit
`test.include: ['src/**/*.test.{ts,tsx}', 'electron/**/*.test.ts']`
in `vitest.config.ts`. To prevent coverage thresholds from dropping
because of unevaluated `electron/main.ts` and `electron/preload.ts`
(both effectively integration code, not unit tested), add
`'electron/main.ts'` and `'electron/preload.ts'` to
`vitest.config.ts:coverage.exclude`.

The sidecar test does NOT spawn a real `vimeflow-backend` binary —
the `MockChildProcess` (Section 4.7) uses `stream.PassThrough`
instances for stdin/stdout/stderr and lets the test drive frames into
the stdout pipe + `emit('exit', code)` on demand. The tests are
synchronous and run in the existing Vitest jsdom environment.

### 3.4 — No `electron:build` script in PR-D1

The `electron:build` script (electron-builder integration) is
**deferred to PR-D3**. PR-D1 ships only `electron:dev` and
`backend:build`. Reasoning:

- Packaging requires settling extraResources for the sidecar binary,
  picking electron-builder's target list (Linux AppImage / .deb,
  macOS .dmg, Windows .exe), and handling icon assets — all of which
  are PR-D3's concern.
- Verifying packaging requires a full `electron-builder` install
  which pulls a 200+ MB toolchain — PR-D1's CI cost stays low without
  it.
- PR-D1's smoke verification is purely `electron:dev` (Section 6).

### 3.5 — Build coordination with the existing Tauri stack

Tauri's `npm run tauri:dev` continues to work unmodified. It builds
the Tauri binary (`src-tauri/target/debug/vimeflow`) and launches the
Tauri host. The Tauri host sets `window.__TAURI_INTERNALS__`,
populates the WebView with the Vite-served renderer, and registers its
`tauri::generate_handler!` invoke router. The renderer's bridge in
`src/lib/backend.ts` (post-PR-C) selects its transport by checking
`window.vimeflow` directly: when unset (Tauri host) it falls back to
`@tauri-apps/api` (`tauriInvoke` / `tauriListen`). The
`__TAURI_INTERNALS__` global is a SEPARATE signal — `isDesktop()` in
`src/lib/environment.ts` uses it (along with `window.vimeflow`) to
classify the runtime environment, but it does NOT participate in the
bridge's per-call branch selection.

The Electron host's renderer differs only in that `window.vimeflow`
IS set by preload, so PR-C's bridge picks the sidecar path.

**App-data-dir relationship.** Electron and Tauri **do not** resolve
the same OS path by default — Electron's `app.getPath('userData')`
returns `<OS-appData>/<package.json:name>` (so on Linux today:
`~/.config/vibm/`, since the npm package name is `vibm`), while
Tauri's `app_data_dir` returns `<OS-dataDir>/<bundleIdentifier>`
(`~/.local/share/dev.vimeflow.app/` for the current
`identifier: "dev.vimeflow.app"`). This means the two hosts maintain
**separate** session caches in PR-D1. That is intentional and
desirable: there is no race between the Tauri host and the Electron
sidecar over a shared cache file, and switching hosts during dev
gives a clean cache rather than ghost sessions from the other host.
Cross-host cache migration is out of scope for PR-D1; PR-D3 (which
removes the Tauri host) makes the question moot. Running both hosts
simultaneously is still discouraged because they would compete for
process resources (PTY children, agent watchers), but the cache itself
is no longer the failure mode.

## 4. Sidecar Deep Module (`electron/sidecar.ts`)

This is the load-bearing module of PR-D1. Its public surface is small;
its internal state machine and protocol parity with PR-B are the
critical contracts.

### 4.1 — Public interface

```ts
export interface Sidecar {
  invoke<T>(method: string, args?: Record<string, unknown>): Promise<T>
  onEvent(handler: (event: string, payload: unknown) => void): () => void
  shutdown(): Promise<void> // graceful close-stdin → wait 5500ms → SIGTERM → SIGKILL
}

export interface SidecarOptions {
  binary: string // absolute path to vimeflow-backend
  appDataDir: string // passed as --app-data-dir
  stderr?: NodeJS.WritableStream // defaults to process.stderr
}

// Production factory (used by electron/main.ts):
export const spawnSidecar: (options: SidecarOptions) => Sidecar

// Narrow surface of the child process actually used by Sidecar.
// `child_process.spawn` returns a value that satisfies this interface;
// the test mock implements just these members instead of the full
// ChildProcessWithoutNullStreams surface (which has dozens of fields
// that would clutter the mock).
export interface SpawnedChild {
  readonly stdin: NodeJS.WritableStream
  readonly stdout: NodeJS.ReadableStream
  readonly stderr: NodeJS.ReadableStream | null
  readonly pid?: number
  on(
    event: 'exit',
    cb: (code: number | null, signal: NodeJS.Signals | null) => void
  ): this
  on(event: 'error', cb: (err: Error) => void): this
  kill(signal?: NodeJS.Signals | number): boolean
}

// Test-only factory (used by electron/sidecar.test.ts). Same options
// plus a dependency-injected spawn function. Exported separately so
// the public surface stays clean for production callers.
export interface SidecarDeps {
  spawnFn: (binary: string, args: string[]) => SpawnedChild
}

export const createSidecar: (options: SidecarOptions & SidecarDeps) => Sidecar

// `spawnSidecar` is implemented as:
//   (options) => createSidecar({ ...options, spawnFn: childProcess.spawn })
```

`invoke<T>` returns a `Promise<T>` that:

- **resolves** with the bare `result` value (no envelope) when the
  sidecar replies with `{ kind: 'response', id, ok: true, result }`.
- **rejects** with the bare `error` string (NOT an `Error` instance)
  when the sidecar replies with
  `{ kind: 'response', id, ok: false, error }`.
- **rejects** with `'sidecar exited unexpectedly'` if the child exits
  before the response arrives.
- **rejects** with `'backend unavailable'` if `invoke()` is called
  after a prior unexpected exit.

`onEvent` registers a listener fired for every `kind: 'event'` frame
from the sidecar. The returned function unregisters the listener and
is idempotent (subsequent calls are no-ops). Required because
`electron/main.ts` is the sole subscriber on the Node side and must
be able to clean up on app quit without double-fire.

`shutdown` is the cooperative-then-forceful teardown path documented
in Section 2's `before-quit` description; called by `main.ts`.

### 4.2 — Internal state

```ts
class SidecarImpl implements Sidecar {
  private child: SpawnedChild | null // NOT ChildProcessWithoutNullStreams —
  // see §4.1: SpawnedChild is the narrow surface real-spawn AND test mocks
  // both satisfy.
  private pending: Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (reason: string) => void
    }
  >
  private listeners: Set<(event: string, payload: unknown) => void>
  private inboundBuffer: Buffer // accumulates raw stdout bytes between framings
  private nextId: number // monotonic; stringified for the wire
  private disabled: boolean // set true on unexpected exit; future invokes reject
}
```

`nextId` is a process-local monotonic counter starting at `1`. The
wire `id` is the stringified counter. Re-using a single counter
avoids UUID dep weight; collision is impossible within one
electron-main lifetime.

### 4.3 — Frame codec parity with PR-B

The codec MUST match `src-tauri/src/runtime/ipc.rs::frame` byte for
byte. Key invariants (copied from PR-B spec §2.1):

- Header line: `Content-Length: <bytes>\r\n`.
- Optional extension headers (none today) follow before the blank
  `\r\n`.
- Body is exactly `Content-Length` bytes of UTF-8 JSON. **No leading
  or trailing newlines, no BOM.**
- `MAX_FRAME_BYTES` = `16 * 1024 * 1024`. Larger frames are protocol
  errors — the sidecar will close the connection, and our reader
  should treat it as a fatal corruption (log + drain pending +
  disable).
- `MAX_HEADER_LINE_BYTES` = `8 * 1024`. Header lines longer than this
  are fatal.
- `MAX_HEADER_SECTION_BYTES` = `1024 * 1024` (1 MiB). The complete
  header section, including extension headers after `Content-Length`,
  is capped at this size. This matches PR-B
  (`src-tauri/src/runtime/ipc.rs:192-195`); without it the Electron
  decoder could buffer header sections the Rust side would reject,
  which would silently desync the protocol. Enforce during scan:
  if `\r\n\r\n` is not found within the first 1 MiB of
  `inboundBuffer`, transition to fatal-corruption (drain + disable).

The decoder is an incremental state machine:

1. State `READ_HEADER`: scan `inboundBuffer` for `\r\n\r\n`.
2. Parse `Content-Length` from the header section; reject malformed
   (non-numeric, missing) by transitioning to a fatal error.
3. State `READ_BODY`: wait until
   `inboundBuffer.length >= contentLength`, then slice the body and
   JSON-parse it.
4. Reset and loop.

There is NO resync-budget behavior on the Electron side. PR-B's
`RESYNC_BUDGET_BYTES` is sidecar-side defense against malformed
inputs from us; we ARE the well-behaved peer, so we never emit junk.
If we see malformed bytes FROM the sidecar, that's a protocol
corruption bug — log it, drain pending, disable. Do NOT attempt
recovery.

### 4.4 — Encoder

```ts
const encode = (body: object): Buffer => {
  const json = Buffer.from(JSON.stringify(body), 'utf8')
  const header = Buffer.from(`Content-Length: ${json.length}\r\n\r\n`, 'ascii')
  return Buffer.concat([header, json])
}
```

`invoke()` writes one request frame per call:

```ts
const id = String(this.nextId++)
const frame = encode({
  kind: 'request',
  id,
  method,
  params: args ?? {},
})
this.child.stdin.write(frame)
```

The wire `params` value is passed through unchanged from the caller's
`args` — **no universal `{ request: ... }` wrapping**. Each command
in `runtime/ipc.rs::router` declares its own per-arm decoder struct
with a per-command shape (verified in PR-B's tests, e.g.
`{"method":"git_status","params":{"cwd":"/tmp"}}` at
`src-tauri/src/runtime/ipc.rs:1283`). Commands like
`spawn_pty` whose router arm decodes
`SpawnPtyParams { request: SpawnPtyRequest }` are passed
`args = { request: { sessionId, ... } }` by the renderer call-site
(unchanged from the Tauri behavior); commands like `git_status` whose
arm decodes `GitStatusParams { cwd: String }` are passed
`args = { cwd }`. The bridge / sidecar `invoke()` is shape-agnostic.

### 4.5 — Inbound dispatch

Two layers of malformedness must be distinguished:

1. **Frame-codec-level malformed** (§4.3): the byte stream itself
   violates the `Content-Length` framing — missing header, non-numeric
   length, oversize frame, header section overflow, JSON parse failure
   on the body. These are **fatal**: drain pending, mark `disabled`,
   log to stderr. The dispatcher never sees these — they trip in the
   decoder first.

2. **Frame-body-level malformed** (this section): the bytes framed
   cleanly AND the body JSON-parsed, but the parsed object shape
   doesn't match a known variant. The default for this layer is
   **non-fatal** (log + skip the frame) — the router has already
   validated structure on the sidecar side, so the only way to reach
   this branch is a protocol-version skew or a bug we want to be
   tolerant of rather than crash for. **Exception:** missing
   top-level `id` or `ok` on a `kind: 'response'` frame IS fatal
   (drain + disable), because we cannot settle the corresponding
   pending invoke without `id` — leaving it pending would hang the
   caller forever. The table below makes this exhaustive.

For each parsed frame:

For RESPONSE frames (any frame with `kind: 'response'`), the
following table is exhaustive — every malformed shape MUST settle
the matching pending entry so no caller hangs:

| Shape                                                                                    | Action                                                                                                                                         |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ ok: true, result }` and `id` is pending                                               | `resolve(result)`, delete pending                                                                                                              |
| `{ ok: false, error }` with `error: string` and `id` pending                             | `reject(error)` (bare string), delete pending                                                                                                  |
| `{ ok: false, error }` with non-string `error` and `id` pending                          | `reject('malformed response frame: error not a string')`, log + delete pending                                                                 |
| `{ ok: true, ...no result }` and `id` pending                                            | `reject('malformed response frame: missing result')`, log + delete pending                                                                     |
| `{ ok: false, ...no error }` and `id` pending                                            | `reject('malformed response frame: missing error')`, log + delete pending                                                                      |
| ambiguous (`ok: false` with `result` set / `ok: true` with `error` set) and `id` pending | `reject('malformed response frame: ambiguous ok flag')`, log + delete pending                                                                  |
| `id` not in pending (duplicate, late, or unknown)                                        | log warning, do NOT remove anything                                                                                                            |
| body JSON-parsable but missing top-level `id` or `ok`                                    | log warning + treat as fatal corruption (drain pending, mark `disabled`) — the wire shape is required, missing it indicates real protocol skew |

The body MUST also JSON-parse cleanly — JSON parse failure on the
N-byte body is a frame-codec-level corruption (the producer claimed
N bytes of JSON and didn't deliver), so it's fatal per §4.3: drain
pending, mark `disabled`.

For EVENT frames:

- `{ kind: 'event', event, payload }` → fan out to every listener
  via `listeners.forEach((l) => l(event, payload))`.
- `{ kind: 'event' }` missing `event` or `payload` → log warning,
  drop the frame. Events have no caller waiting, so dropping is safe.

For UNKNOWN frame kinds (`kind` neither `'response'` nor `'event'`):

- log a warning to the configured stderr stream, drop the frame. Do
  NOT mark `disabled` — this is the "tolerant of future protocol
  additions" path. Router-validated shapes on the sidecar side mean
  this branch should never fire in practice.

### 4.6 — Stderr drainage and exit/spawn-error handling

**Stderr drainage (required, not optional):** the constructor MUST
attach a `data` listener to `child.stderr` and forward each chunk to
the configured `stderr` stream (or `process.stderr` by default):

```ts
child.stderr?.on('data', (chunk: Buffer) =>
  (options.stderr ?? process.stderr).write(chunk)
)
```

Without this, the sidecar's stderr pipe buffer (~64 KB on Linux)
will fill once `env_logger` produces enough output, and the sidecar
blocks on its next `stderr.write` — silently bricking the backend
with no visible error. The pipe MUST be drained continuously.

Three paths feed the disable/drain machinery:

- **Cooperative exit**: `shutdown()` was called first → the child saw
  clean EOF on stdin → `code === 0` on `child.on('exit', ...)`.
  Pending requests are already drained with `'app quitting'`
  rejection by `shutdown()`. The `exit` handler is a no-op.
- **Unexpected exit**: `shutdown()` was NOT called → the child died
  on its own (panic, OOM, killed by OS). Set `this.disabled = true`.
  Drain `pending` with `'sidecar exited unexpectedly'` rejection.
  Log `[sidecar exit] code=${code} signal=${signal}` to stderr. Do
  NOT auto-restart.
- **Spawn error**: `child.on('error', (err) => ...)` fires when
  `child_process.spawn` itself fails (e.g., `ENOENT` if the binary
  is missing because `backend:build` was skipped; `EACCES` if the
  binary is not executable). Set `this.disabled = true`. Drain
  `pending` with the bare string `'sidecar spawn failed: ' + err.message`
  rejection. Log `[sidecar spawn error] ${err.message}` to stderr.
  This MUST be a separate code path from `exit` — Node fires `error`
  BEFORE `exit` in spawn-failure cases, and pending requests issued
  during the brief window before the `error` event would otherwise
  hang forever.

### 4.7 — Test contract (`electron/sidecar.test.ts`)

Tests use the `createSidecar({ ...options, spawnFn })` factory
(§4.1) so a `MockChildProcess` can substitute for a real
`child_process.spawn` return value. `MockChildProcess` extends
`EventEmitter` and exposes `stdin: PassThrough`,
`stdout: PassThrough`, `stderr: PassThrough` (the same shape as
`ChildProcessWithoutNullStreams`).

All assertions are **behavior-driven** — tests never reach into the
private `pending`, `disabled`, `listeners`, or `inboundBuffer` fields.
Instead they observe the Promise resolution/rejection paths, the
subsequent invoke behavior, and the listener call counts. This keeps
the public surface honest and avoids brittle "white-box" coverage.

Required test cases (vitest):

1. **Frame codec roundtrip** — push an encoded `response` frame into
   `mock.stdout`; assert the matching `invoke` Promise resolves with
   the expected `result`.
2. **Partial-frame buffering** — push the same encoded response in
   two `mock.stdout` writes (split mid-body); assert the Promise
   stays pending after the first write and resolves only after the
   second.
3. **Two frames concatenated in one write** — write two encoded
   response frames in a single `mock.stdout.push(Buffer.concat(...))`;
   assert both corresponding invokes resolve in order.
4. **Resolution cleanup** — `invoke('m')`, push matching success
   response, assert resolve; immediately re-invoke `'m'` and push a
   response with the next `id`; assert the second invoke also
   resolves (proves the first `pending` entry was deleted and the
   ID counter advanced).
5. **Rejection cleanup with bare string** — push an `ok: false`
   response; assert `invoke` rejects with the bare error string
   (`expect(promise).rejects.toBe('PTY session not found')`, no
   `Error` wrapping).
6. **Drain on unexpected exit** — fire two `invoke`s, emit
   `mock.emit('exit', 1, null)`; assert both reject with
   `'sidecar exited unexpectedly'`.
7. **`invoke` after exit** — after the prior case, call a fresh
   `invoke('m')`; assert it rejects with `'backend unavailable'` AND
   `mock.stdin.write` was NOT called (assert via a `vi.spyOn`).
8. **Event fan-out** — register two listeners via `onEvent`, push an
   event frame on `mock.stdout`; assert both listeners are called
   with `(event, payload)` in registration order.
9. **Listener teardown idempotency** — call the unsubscribe returned
   by `onEvent` twice; push another event frame; assert the listener
   was NOT called after the first unsubscribe and the second
   unsubscribe is a no-op (doesn't throw).
10. **Frame too large is fatal** — push a header claiming
    `Content-Length: 17000000` (17 MiB, exceeds 16 MiB cap); assert
    a subsequent `invoke` rejects with `'backend unavailable'`
    (the decoder has marked the sidecar disabled).
11. **Spawn error path** — `createSidecar({ ...options, spawnFn })`
    where `spawnFn` returns a mock; immediately after `createSidecar`
    returns (so `child.on('error')` is attached), issue an
    `invoke('m')`, then **on the next microtask**
    (`queueMicrotask(() => mock.emit('error', new Error('ENOENT: vimeflow-backend')))`)
    fire the error event; assert the invoke rejects with the bare
    string `'sidecar spawn failed: ENOENT: vimeflow-backend'` (no
    `Error` wrapping). A synchronous emit inside `spawnFn` would be
    missed because `on('error')` is attached after `spawnFn` returns;
    using a microtask delay matches the real `child_process.spawn`
    error-event ordering (Node always emits `error` asynchronously).
12. **Header section overflow** — push 2 MiB of bytes containing no
    `\r\n\r\n` sequence; assert a subsequent `invoke` rejects with
    `'backend unavailable'` (1 MiB header-section cap).

## 5. Preload Bridge (`electron/preload.ts`)

This file is the minimal trust boundary between the renderer's web
context and the Node-privileged main process. Its size is its safety:
the smaller the allowlist, the smaller the attack surface.

### 5.1 — Security model

`BrowserWindow.webPreferences` (from §2 main.ts) sets:

- `contextIsolation: true` — renderer can only touch what
  `contextBridge.exposeInMainWorld` exposes; raw `ipcRenderer`,
  `process`, `require`, etc. are NOT reachable from page scripts.
- `nodeIntegration: false` — Node globals (`Buffer`, `process`,
  `__dirname`) are NOT available in the renderer.
- `sandbox: true` — preload itself runs in Chromium's renderer
  sandbox; the only privileged surface it can reach is a curated
  `electron`-module subset (`ipcRenderer`, `contextBridge`). Native
  Node modules (`fs`, `child_process`) are NOT loadable from preload.
  This is the strictest sane setting and is the load-bearing defense
  against a compromised renderer.

**Dev-mode caveat:** `vite-plugin-electron`'s default startup script
passes `--no-sandbox` when launching Electron in dev mode, which
disables Chromium's process sandbox for the whole app. PR-D1 overrides
this via the plugin's `onstart` hook so dev mode preserves sandbox
parity with production:

```ts
electron({
  main: {
    entry: 'electron/main.ts',
    onstart: ({ startup }) => startup(['.']), // no --no-sandbox
    vite: {
      /* …rollupOptions… */
    },
  },
  preload: {
    /* …unchanged… */
  },
})
```

If the plugin's `onstart` API changes in a future version and removing
`--no-sandbox` becomes infeasible, the spec section 5.1 must be
**downgraded**: dev mode sandbox is opt-in, production sandbox is
enabled. The threat model in PR-D1 still assumes production-grade
sandbox at ship time.

The combined effect: a malicious script in the renderer (XSS, supply
chain) cannot reach Node APIs directly — no `require('fs')`, no
`child_process.spawn`, no raw `ipcRenderer`. It IS still allowed to
call `window.vimeflow.invoke('read_file', { path })`,
`window.vimeflow.invoke('write_file', { … })`,
`window.vimeflow.invoke('spawn_pty', { … })`, etc., because those are
the validated backend commands the app needs to function — but each
of those commands enforces its own scope/argument validation
(filesystem reads bounded to allowed roots, PTY spawn constrained by
the request shape, and so on) inside the Rust runtime. The trust
boundary moves from "the renderer cannot touch the filesystem" to
"the renderer can only touch the filesystem through the
backend-validated path", which is the standard contextBridge model.

### 5.2 — Public surface (exact code shape)

```ts
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { BACKEND_EVENT, BACKEND_INVOKE } from './ipc-channels'

const invoke = async <T>(
  method: string,
  args?: Record<string, unknown>
): Promise<T> => {
  const envelope = (await ipcRenderer.invoke(BACKEND_INVOKE, {
    method,
    args,
  })) as { ok: true; result: T } | { ok: false; error: string }
  if (envelope.ok) {
    return envelope.result
  }
  // Bare-string throw matches PR-C's bridge rejection contract.
  // src/lib/backend.test.ts asserts
  // `await expect(invoke('m')).rejects.toBe('sidecar error')` —
  // same bare-string shape.
  throw envelope.error
}

const listen = <T>(
  event: string,
  callback: (payload: T) => void
): Promise<() => void> => {
  const handler = (
    _e: IpcRendererEvent,
    msg: { event: string; payload: T }
  ) => {
    if (msg.event === event) {
      callback(msg.payload)
    }
  }
  ipcRenderer.on(BACKEND_EVENT, handler)
  const unlisten = () => ipcRenderer.off(BACKEND_EVENT, handler)
  return Promise.resolve(unlisten)
}

contextBridge.exposeInMainWorld('vimeflow', { invoke, listen })
```

Nothing else is exposed. No `ipcRenderer.send`, no
`ipcRenderer.invoke` raw, no path helpers, no version info.

### 5.3 — Why filtering happens in preload, not main

`ipcMain` could pre-filter events and only send them to subscribers
of the matching name, but doing so would require main to track
per-window subscription lists keyed by event name — non-trivial state
for a problem that doesn't exist at the small event volumes this app
produces. The broadcast-and-filter approach is acceptable:

- Backend event rates are modest (`pty-data` is the highest-volume,
  bounded by terminal output speed; `git-status-changed` and
  `agent-*` events are sparse).
- Filter cost in preload is O(1) string comparison per delivered
  event.
- Subscription state stays local to each window's preload context, so
  there's no cross-window state to keep coherent.

If event volume becomes a concern (PR-D2/D3 follow-up), a main-side
filter map is a straightforward optimization: track
`Map<windowId, Set<eventName>>`, only `webContents.send` to windows
whose set contains the fired event.

### 5.4 — contextBridge serialization constraints

Two transport layers carry data in PR-D1, each with different rules:

1. **contextBridge function proxy** (preload ↔ renderer). The
   functions we expose (`invoke`, `listen`) and the `callback` the
   renderer passes to `listen(...)` are wrapped by Electron's
   contextBridge in a function proxy — they ARE allowed to cross the
   boundary as functions. Behind the scenes Electron synthesizes a
   sandboxed proxy that forwards calls; the function itself never
   leaves the renderer process, but it can be invoked from the
   preload context. Arguments and return values across the proxy
   call DO go through structured-clone, so `args` and `payload`
   must be clonable.

2. **`ipcRenderer.invoke` / `webContents.send` wire** (preload ↔
   main). This is the actual IPC channel. Every value crossing it is
   serialized via structured-clone. The shapes we ship —
   `{ method, args }`, `{ ok, result, error }`,
   `{ event, payload }` — are plain JSON-clonable objects.

What is NOT safe on EITHER layer: passing class instances with
methods (methods get stripped), DOM nodes, weak references, or
non-cloneable objects. Our protocol never does this — all wire
payloads from the sidecar are plain JSON; the bridge's `args` shape
is `Record<string, unknown>` typed at the source. The test contract
in §4.7 enforces this implicitly because the sidecar mock pushes
encoded JSON frames.

### 5.5 — Interplay with `src/lib/backend.ts`

The PR-C bridge in `src/lib/backend.ts` already detects
`window.vimeflow` at call time:

```ts
if (typeof window !== 'undefined' && window.vimeflow) {
  return window.vimeflow.invoke<T>(method, args)
}
return tauriInvoke<T>(method, args) // fallback path
```

Under Electron, `window.vimeflow` IS set by our preload, so the first
branch fires. No renderer-side changes are required by PR-D1. The
bridge's `called`-guard wrapper around `UnlistenFn` continues to
work: our preload returns an `unlisten` that calls `ipcRenderer.off`
once; the bridge wraps it with a `called` flag so React StrictMode
double-cleanup is safe even though our `ipcRenderer.off` itself is
already idempotent.

## 6. Verification Gate

Three layers of verification before merging PR-D1: type-check + lint,
automated unit tests, and a manual smoke against `npm run electron:dev`.

### 6.1 — Static + automated checks

```bash
npm run format:check
npm run lint
npm run type-check
npm run test               # vitest --passWithNoTests
npx vitest run electron/sidecar.test.ts  # specifically verify the new suite
(cd src-tauri && cargo build --bin vimeflow-backend)  # binary builds
(cd src-tauri && cargo test)                          # Rust suite still green
```

Expected:

- All static checks green.
- Vitest suite count increases by exactly the 12 cases in
  `electron/sidecar.test.ts` (§4.7).
- Rust test count is byte-identical to post-PR-B baseline (PR-D1
  does not touch `src-tauri/**`).
- E2E suites are NOT run as part of PR-D1's verification —
  `tests/e2e/**` still uses `tauri-driver` and the swap to
  Electron-driven E2E lands in PR-D2.

### 6.2 — Manual smoke against `electron:dev`

This is the load-bearing acceptance gate for PR-D1. Run it with the
Tauri stack stopped (`pkill -f tauri:dev` if necessary):

```bash
npm run electron:dev
```

Expected timeline:

1. Cargo build of `vimeflow-backend` completes (~30-60s cold, ~1s
   warm).
2. Vite dev server starts on `http://localhost:5173`.
3. Vite-plugin-electron bundles `electron/main.ts` and
   `electron/preload.ts` → `dist-electron/main.js`,
   `dist-electron/preload.mjs`.
4. Electron BrowserWindow opens at 1400×900 with title "Vimeflow".

Within the window, exercise the renderer's full feature surface and
confirm each path goes through the sidecar (not the Tauri fallback):

- [ ] **Default terminal pane spawns.** A single tab appears in the
      sidebar. The pane shows the shell prompt within ~1s of window
      open. Type `pwd` and press Enter; output is the working directory.
- [ ] **PTY output stream.** `ls -la` produces output without dropped
      bytes (visual inspection — no truncated lines).
- [ ] **Resize.** Resize the BrowserWindow; the terminal reflows to
      the new column count (`resize_pty` invocation visible in
      DevTools network if relevant; output renders without garbage).
- [ ] **Second pane / second session.** Open a second tab via the
      sidebar; confirm it spawns its own PTY. Close it; tab count
      decrements.
- [ ] **File explorer lists.** Open the file explorer panel; the
      project tree appears. Open a file (`README.md`); the editor
      loads it.
- [ ] **Git diff panel.** Open the diff panel; current branch name
      appears, status shows current changes (or "no changes" if
      clean).
- [ ] **Agent watcher (if Claude Code is running locally).** Status
      indicator updates as the agent transitions states. Skip this
      step in CI / clean dev environments.

Console / DevTools checks:

- [ ] Open Electron's DevTools (Cmd/Ctrl+Shift+I). Inspect the
      Console for any errors. Expected: no errors. Warnings about
      "downloading Electron" (first run) are acceptable.
- [ ] In the DevTools Console, evaluate
      `typeof window.vimeflow.invoke === 'function'` — must be
      `'function'`.
- [ ] Evaluate `await window.vimeflow.invoke('list_sessions')` —
      must resolve to an array (possibly empty) without throwing.

Shutdown checks:

- [ ] Close the BrowserWindow.
- [ ] On Linux/Win: Electron exits cleanly; `vite` process exits;
      the terminal returns to a prompt.
- [ ] On macOS: Electron remains running. Press Cmd+Q; same exit
      flow as above.
- [ ] Check the OS process list (`ps aux | grep vimeflow-backend`):
      no orphan sidecar process. (Note: `bash` / `zsh` PTY children
      may persist — that's the known limitation from §2; the sidecar
      itself MUST be gone.)

### 6.3 — Smoke against Tauri (regression guard)

Verify PR-D1 did not regress the Tauri path:

```bash
npm run tauri:dev
```

Same renderer should launch. PR-C's bridge sees `window.vimeflow`
unset, falls back to `@tauri-apps/api`. All feature surface above
must still work. This confirms the bridge's transport switch is
clean and that adding Electron did not leak anything into the Tauri
path.

### 6.4 — Coupling inventory

```bash
rg -nE "@tauri-apps/api|__TAURI_INTERNALS__" src tests --glob '!src/types/vimeflow.d.ts'
```

Expected: exactly the same hits as the post-PR-C baseline. PR-D1 does
NOT remove Tauri coupling — that's PR-D3. The diff for this PR
should not change the Tauri-coupling count.

```bash
rg -nE "from 'electron'|require\('electron'\)" src tests --glob '!electron/**'
```

Expected: zero hits. Renderer code must not import `electron`
directly — all paths go through `window.vimeflow`.

## 7. Risk Notes

High-leverage failure modes and the mitigations the spec already
encodes. Reviewers should focus disagreement on this list — if any
risk feels insufficiently mitigated, it's likely a spec-level fix
before implementation, not an implementation-time discovery.

### 7.1 — Sidecar stdout is protocol-owned

Anything written to `vimeflow-backend`'s stdout MUST be a valid IPC
frame. A stray `println!`, `eprintln!` mis-routed to stdout, or panic
backtrace dumped to stdout corrupts the frame stream and (per §4.3)
fatally disables our decoder. **Mitigation**: PR-B already routes
`env_logger` to stderr; the Rust runtime crate audit in PR-A removed
stdout `println!` from the production paths. PR-D1 doesn't add Rust
code, so no new exposure. **Watch**: any future Rust PR that adds a
`println!` is a regression that PR-D1 will surface as a sidecar
crash in dev — that's by design.

### 7.2 — PTY orphan processes on app quit

The sidecar's `state.shutdown()` clears the session cache but does
NOT kill spawned PTY child processes. This is pre-existing behavior
under Tauri (`RunEvent::ExitRequested` has the same shape) and is
explicitly preserved by PR-D1. **Mitigation**: documented in §2 as a
known limitation; users see lingering `bash`/`zsh` processes in
`ps aux` after quit. **Follow-up**: PR-D3 or a small dedicated PR
should add PTY-child cleanup to `BackendState::shutdown()`. Out of
scope for D1 to avoid scope creep.

### 7.3 — Frame codec parity with PR-B

Any drift between the Electron decoder (§4.3) and the Rust encoder
(`src-tauri/src/runtime/ipc.rs::frame`) causes silent desync. The
spec encodes parity at three points: `MAX_FRAME_BYTES`,
`MAX_HEADER_LINE_BYTES`, `MAX_HEADER_SECTION_BYTES`. **Mitigation**:
§4.7 test cases 1-3 and 10-12 cover the framing boundary explicitly;
the codec is small enough to audit by hand. **Watch**: if PR-B's
codec ever changes (a real possibility for v2 of the protocol),
this spec's §4.3 numbers MUST move in lockstep, and PR-B's spec
should reference this section.

### 7.4 — Dev-mode sandbox preservation

`vite-plugin-electron`'s default startup passes `--no-sandbox`. PR-D1
overrides this via the `onstart` hook (§5.1 Dev-mode caveat, §2 vite
config) so dev mode preserves production sandbox parity.
**Mitigation**: explicit `onstart: ({ startup }) => startup(['.'])`
in the plugin config. **Watch**: if `vite-plugin-electron`'s
`onstart` API changes in a future version, the override breaks
silently — dev mode would quietly re-enable `--no-sandbox`. The risk
acceptance: dev mode is for trusted local development; sandbox
weakening is bounded to dev, not ship.

### 7.5 — macOS app-quit UX divergence

On macOS, closing the BrowserWindow leaves the Electron process
running per platform convention. Users must `Cmd+Q` to fully exit
(triggering `before-quit` → sidecar shutdown). **Mitigation**:
documented in §2 and §6.2's shutdown checks. **Watch**: if a future
multi-window flow makes "close last window" the quit signal on
macOS, the `window-all-closed` handler must be revisited.

### 7.6 — Tauri ↔ Electron coexistence

Both `npm run tauri:dev` and `npm run electron:dev` work in this PR.
They write to different `app_data_dir` paths (§3.5), so the session
cache is not racy. They do, however, share the host OS — running
both simultaneously doubles PTY processes, agent watchers, and
git-watcher subscriptions. **Mitigation**: PR description tells
developers to run one at a time. PR-D3 removes Tauri, eliminating
the question.

### 7.7 — Cargo binary missing at spawn time

The first run of `npm run electron:dev` requires `cargo build`
success. If the cargo step is skipped (e.g., a developer runs
`vite --mode electron` directly) the sidecar binary is missing and
`child_process.spawn` fires `ENOENT`. **Mitigation**: §4.6 spawn
error handling drains pending invokes with a clear error; the
DevTools console shows
`'sidecar spawn failed: ENOENT: vimeflow-backend'`. The
`electron:dev` script always runs `backend:build` first, so this
only surfaces if developers bypass the script.

### 7.8 — Single-window today, forward-compat code

Event fan-out iterates `BrowserWindow.getAllWindows()` (§1 process
model, §2 main.ts) so adding a second window in a future PR
requires no main-side changes. **Watch**: per-window subscription
state could become relevant if event volumes grow; §5.3 outlines
the optimization path.

### 7.9 — No auto-restart on sidecar crash

Per §4.6, an unexpected sidecar exit disables further invokes and
requires the user to restart Electron. **Mitigation**: PR-D1 keeps
v1 simple — auto-restart is one of the deferred follow-ups in the
migration plan. **Watch**: if sidecar stability becomes a concern
in real use, a single-shot auto-restart with cache reconciliation is
a reasonable D-side follow-up.

### 7.10 — Renderer is not unit-tested

`electron/main.ts` and `electron/preload.ts` rely on the Electron
runtime and are exercised only via the manual smoke in §6.2 in this
PR. **Mitigation**: §6.2 covers the full feature surface end-to-end;
PR-D2's E2E swap moves these paths under automated Electron-driven
tests. Coverage thresholds are protected via the
`vitest.config.ts:coverage.exclude` additions in §3.3.

<!-- codex-reviewed: 2026-05-15T01:37:44Z -->

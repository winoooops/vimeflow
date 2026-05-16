# PR-D3 — Tauri Runtime Removal + Packaging Smoke Design Spec

## 1. Overview & Scope

**Goal:** Delete the Tauri runtime surface in its entirety — the Rust crate
dependency, the `#[tauri::command]` wrappers, `TauriEventSink`, `lib.rs::run()`,
`tauri.conf.json`, the npm `@tauri-apps/*` packages, and the bridge fallback in
`src/lib/backend.ts` — and replace the packaging path with electron-builder
producing a Linux AppImage. After this PR lands, the only desktop runtime is
Electron, the only Rust binary that ships is the `vimeflow-backend` sidecar,
and `npm run electron:build` produces an installable AppImage with the sidecar
bundled as an `extraResource` resolved at runtime via `process.resourcesPath`.
The frontend bridge collapses to a thin `window.vimeflow.invoke` / `.listen`
delegate (the `called`-guard idempotency wrapper for `UnlistenFn` stays for
React StrictMode safety).

**Migration roadmap:** `docs/superpowers/plans/2026-05-13-electron-rust-backend-migration.md`
Tasks 10 + 11. PR-D1 (#209) shipped the Electron shell + sidecar wiring; PR-D2
(#210) swapped the E2E pipeline; PR-D3 finishes the 4-PR sequence.

**Tech Stack:** Electron 42 (already pinned), `electron-builder` (new devDep,
latest stable), `vite-plugin-electron` (already installed), Rust sidecar
`vimeflow-backend` (built without the `tauri` Cargo dep). No new frontend
runtime dependencies.

### 1.1 In Scope

**Frontend / TypeScript:**

- Strip `@tauri-apps/api/core` + `@tauri-apps/api/event` fallback from
  `src/lib/backend.ts`. Bridge becomes a thin `window.vimeflow.invoke` /
  `.listen` delegate. The `called`-guard `UnlistenFn` wrapper stays.
- Remove the `__TAURI_INTERNALS__` probe from
  `src/lib/environment.ts:isDesktop()` — becomes `window.vimeflow != null`.
  Delete the `TauriInternals` interface and the global
  `Window.__TAURI_INTERNALS__` augmentation.
- Update `src/lib/backend.test.ts` to drop the `@tauri-apps fallback path`
  describe block; only the `window.vimeflow path` tests remain. Update
  `src/lib/environment.test.ts` to drop `__TAURI_INTERNALS__` fixtures.
- Rename TypeScript classes `TauriTerminalService` → `DesktopTerminalService`,
  `TauriGitService` → `DesktopGitService`, `TauriFileSystemService` →
  `DesktopFileSystemService`. Rename the file
  `src/features/terminal/services/tauriTerminalService.ts` →
  `desktopTerminalService.ts` (the other two classes live inside files that
  don't need renaming). Update factory call sites + sibling tests.

**Rust crate:**

- Strip `tauri = ...` and `tauri-plugin-log = ...` from `[dependencies]`.
  Strip `tauri = { ... features = ["test"] }` from `[dev-dependencies]` (the
  `test` feature is unused — verified empirically; no `tauri::test::mock_*`
  callers exist in `*.rs`). Strip `tauri-build = ...` from
  `[build-dependencies]`.
- Change `default-run = "vimeflow"` → `default-run = "vimeflow-backend"`.
- Narrow `[lib] crate-type` from `["staticlib", "cdylib", "rlib"]` to
  `["rlib"]`. The `staticlib` and `cdylib` outputs existed only for the
  Tauri mobile binding path.
- Delete `src-tauri/build.rs` (was just `tauri_build::build()`).
- Delete `src-tauri/src/main.rs` (was just `vimeflow_lib::run()` which is
  being deleted).
- Replace `src-tauri/src/lib.rs` body with module declarations only. The
  Tauri-decorated `run()` function, `configure_linux_webkit_env()`, and all
  `#[cfg(not(test))] use ... { ... };` rewrappers go away. Final shape: ~5
  lines of `pub mod` / `mod` declarations.
- Delete `src-tauri/src/runtime/tauri_bridge.rs`. Remove
  `pub mod tauri_bridge;` and `pub use tauri_bridge::TauriEventSink;` from
  `runtime/mod.rs`.
- Remove the **20** `#[tauri::command]` wrapper functions across
  `terminal/commands.rs` (8), `terminal/test_commands.rs` (1), `git/mod.rs` (3),
  `git/watcher.rs` (2), `agent/commands.rs` (1), `agent/adapter/mod.rs` (2),
  and `filesystem/{list,read,write}.rs` (1 each). Wrappers share the shape
  `fn xxx(state: tauri::State<'_, Arc<BackendState>>, request: ...) ->
Result<T, String>` (or the `<R: tauri::Runtime>`-generic form in
  `agent/adapter/mod.rs`). The IPC router calls `BackendState` methods
  directly; the wrappers are pure dead code post-removal.
- Remove the `#[cfg(not(test))] pub use ...` re-exports of those wrapper
  names from `src-tauri/src/terminal/mod.rs:17-21`,
  `src-tauri/src/filesystem/mod.rs:28-34`, and
  `src-tauri/src/agent/mod.rs:21-25`. These re-exports existed solely so
  `lib.rs`'s `invoke_handler![...]` macro could resolve the command
  symbols at the crate root; after `lib.rs::run()` is deleted, the
  re-exports are dead and reference non-existent symbols (compile
  failure if left in place). The `pub use state::PtyState` /
  `pub use adapter::AgentWatcherState` / etc. re-exports that don't
  reference deleted symbols **stay**.
- Delete `src-tauri/tauri.conf.json` and `src-tauri/capabilities/default.json`.

**Packaging (electron-builder):**

- Add `electron-builder` to devDeps.
- Add `electron-builder.yml` (separate file per planner-time choice)
  declaring: appId, productName, files glob, asar packaging,
  `directories.output: release` (so the produced AppImage lands at
  `release/<name>.AppImage`, not the electron-builder default of `dist/`
  which would collide with the Vite renderer output), `linux.artifactName`
  pinned to `vimeflow-${version}-${arch}.AppImage` (so the smoke step's
  `release/vimeflow-*.AppImage` glob has a stable filename), Linux AppImage
  target + category, and `extraResources` packaging the sidecar binary at
  `bin/vimeflow-backend` inside the AppImage payload.
- Add `electron:build` npm script: `npm run type-check && cross-env vite
build --mode electron && npm run backend:build:release &&
electron-builder --linux AppImage`. Calls the project-level `type-check`
  (which chains `tsc -b && tsc -p electron/tsconfig.json`) instead of
  `tsc -b` alone because the root `tsconfig.json` includes only `src/`;
  the Electron main / preload TypeScript lives outside that include and
  would otherwise be packaged without ever being type-checked. New
  `backend:build:release` script: `cd src-tauri && cargo build --release
--bin vimeflow-backend`. Release profile because the packaged artifact
  ships to end users.
- The sidecar resolution in `electron/main.ts:39-52` already uses
  `path.join(process.resourcesPath, 'bin', BINARY_NAME)` under
  `app.isPackaged`. No `main.ts` change; `electron-builder.yml` ensures the
  packaged path matches.

**CI workflows:**

- `.github/workflows/e2e.yml`:
  - Drop `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libappindicator3-dev`,
    `librsvg2-dev`, `patchelf` from apt install. After the Tauri Cargo dep
    is gone, the sidecar no longer link-pulls `webkit2gtk-rs`. Keep `xvfb`.
  - Drop the `shared-key: e2e-test` justification comment that references
    `tauri-build`. Keep the key itself.
  - Rewrite the `Install system dependencies` comment to describe the new
    Electron-only dep set.
- `.github/workflows/tauri-build.yml`: **delete the file entirely.** It
  currently runs `npm run tauri:build` and `npx tauri build --ci` across
  Ubuntu/macOS/Windows; both invocations break the moment the npm scripts
  and `@tauri-apps/cli` are removed. The packaged-build CI surface returns
  in a deferred follow-up that adds a multi-platform `electron:build`
  matrix.

**npm scripts + keywords (`package.json`):**

- Drop `tauri:dev` and `tauri:build` from `scripts`.
- Drop `@tauri-apps/api` from `dependencies`.
- Drop `@tauri-apps/cli` from `devDependencies`.
- Replace `"tauri"` in `keywords` with `"electron"`.
- Commit the regenerated `package-lock.json` alongside `package.json`.
  `npm install` after the dep changes rewrites the lockfile; without
  committing the new lockfile, CI's `npm ci` step (which requires
  `package.json` and `package-lock.json` to be in sync) fails.

**Smoke verification (Task 11 of migration roadmap):**

- Build packaged AppImage with `npm run electron:build`.
- Launch the produced `release/vimeflow-*.AppImage` and walk all 7 baseline
  flows: app launch, terminal spawn + `pwd`, `ls -la` output, file
  explorer + editor, diff panel branch/status, second pane spawn + close,
  quit + relaunch with session cache parity to dev mode.

### 1.2 Out of Scope

- Renaming `src-tauri/` to a runtime-neutral directory (e.g. `backend/`).
  Deferred follow-up per migration roadmap.
- Code signing, notarization, GitHub release wiring, auto-update channels.
  Deferred follow-up.
- macOS / Windows packaging. The CI matrix stays Linux-only; the
  electron-builder config is structured so adding mac/win targets later
  is a one-section follow-up.
- Protocol versioning for the sidecar IPC. Deferred follow-up.
- Refactoring the `BackendState` API or the IPC router. PR-D3 only deletes
  the Tauri wrappers sitting _above_ the IPC layer; the layer itself is
  untouched.
- Re-introducing `webkit2gtk-driver` or any wry-era system deps. Their
  removal is final.

### 1.3 Acceptance Posture

- `npm run type-check`, `npm run lint`, `npm run format:check` clean.
- `npm run test` green. Unit-test count drops by ~12: ~6 from the
  `@tauri-apps fallback path` describe block in `backend.test.ts`, plus
  ~6 more from the `__TAURI_INTERNALS__` fixtures in `environment.test.ts`
  (the `returns true when __TAURI_INTERNALS__ is set` group + the
  `MODE` interaction tests that drive `isDesktop` truthy via the
  internals path). Net delta is small; no production tests are
  affected.
- `cargo test` green inside `src-tauri/`. Count matches the PR-D2 baseline
  exactly. None of the deleted `#[tauri::command]` wrappers had unit tests
  of their own: each Tauri-decorated command has a `#[cfg(test)] pub fn
xxx(...)` sibling in the same file (e.g.
  `src-tauri/src/git/mod.rs:559-561`) that takes plain args (no
  `tauri::State`) and is what tests actually call. Those test-only aliases
  stay; PR-D3 only deletes the `#[tauri::command]`-decorated production
  wrappers above them.
- `npm run test:e2e:build && npm run test:e2e:all` green. The sidecar
  binary builds without `tauri-*` deps; renderer still resolves
  `window.vimeflow` from the unchanged Electron preload.
- `npm run electron:build` produces a runnable AppImage; the 7-flow smoke
  walks completely.
- `rg -n "@tauri-apps|__TAURI_INTERNALS__|tauri::|tauri-driver|tauri:dev|tauri:build" src src-tauri tests package.json vite.config.ts --glob '!docs/**' --glob '!src-tauri/target/**' --glob '!src-tauri/bindings/**' --glob '!**/*.md' --glob '!**/*.puml' --glob '!**/*.svg'`
  returns **zero** runtime hits. The `.puml`/`.svg` exclusions cover
  `src-tauri/src/agent/architecture.{puml,svg}`, rendered diagrams that
  reference `tauri::Runtime` in the pre-PR-D3 `AgentAdapter<R>` trait shape;
  redrawing the diagrams to match the post-D3 non-generic adapter is a
  deferred follow-up.

## 2. End-State Architecture

### 2.1 Runtime Topology After PR-D3

```

React renderer (http://localhost:5173 via VITE_DEV_SERVER_URL in dev; vimeflow://app/index.html in packaged)
→ Electron preload (electron/preload.ts) exposes `window.vimeflow`
→ Electron main (dist-electron/main.js)

- ipcMain.handle('backend:invoke') with method allowlist
- BrowserWindow.webContents.send('backend:event', ...)
  → Sidecar child process (vimeflow-backend)
- stdio JSON IPC, LSP-framed
- StdoutEventSink → main → renderer fan-out
  → BackendState (runtime-neutral)
- PtyState / SessionCache / AgentWatcherState / TranscriptState / GitWatcherState
- spawn_pty / write_pty / list_sessions / git_status / list_dir / ...

```

No Tauri layer anywhere. The `BackendState` + IPC router were already
runtime-neutral after PR-A/B; PR-D3 only removes the dead Tauri wrappers
that sat _above_ that layer.

### 2.2 What Survives Untouched

The architecture established by PR-A → PR-D2 is the production target.
PR-D3 deletes Tauri-specific scaffolding without modifying any of these:

- `src-tauri/src/runtime/state.rs` — `BackendState` impl + all `pub fn
spawn_pty / write_pty / list_sessions / list_dir / git_status` etc.
  methods. These delegate to `*_inner` helpers in
  `terminal/commands.rs`, `filesystem/{list,read,write}.rs`,
  `git/{mod,watcher}.rs`, `agent/commands.rs`. None of the
  `*_inner` helpers move.
- `src-tauri/src/runtime/ipc.rs` — LSP frame codec, request router,
  `StdoutEventSink`, writer task, backpressure logic, shutdown handshake.
- `src-tauri/src/runtime/event_sink.rs` — the `EventSink` trait +
  `FakeEventSink` for tests. Only `TauriEventSink` (in
  `runtime/tauri_bridge.rs`) is deleted.
- `src-tauri/src/bin/vimeflow-backend.rs` — sidecar `main()`. Already
  consumes only `vimeflow_lib::runtime::*`; no Tauri references.
- `electron/main.ts`, `electron/preload.ts`, `electron/sidecar.ts`,
  `electron/ipc-channels.ts`, `electron/backend-methods.ts` — all PR-D1
  artifacts stay byte-for-byte.
- `electron/sidecar.test.ts` — 22 unit cases (the original 16 from PR-D1
  plus 6 extensions that landed in PR-D1's follow-up CSP / preload-bridge
  cycle) all stay green; the LSP codec lives entirely on the
  renderer-side of the boundary.
- The 11 WDIO E2E specs across `tests/e2e/{core,terminal,agent}/specs/`
  — they exercise DOM + `window.__VIMEFLOW_E2E__` and are
  runtime-agnostic by design.

### 2.3 What Gets Deleted

After PR-D3 lands, these paths cease to exist:

| Path                                                                                                             | What                                                                        | Why                                                                                          |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src-tauri/src/main.rs`                                                                                          | `vimeflow_lib::run()` shim                                                  | No more Tauri app binary                                                                     |
| `src-tauri/src/lib.rs` content                                                                                   | `run()` function + Tauri imports + Linux WebKit env shim                    | All callers gone                                                                             |
| `src-tauri/src/runtime/tauri_bridge.rs`                                                                          | `TauriEventSink` adapter                                                    | `StdoutEventSink` is the only sink that ships                                                |
| `src-tauri/build.rs`                                                                                             | `tauri_build::build()`                                                      | `tauri-build` crate removed                                                                  |
| `src-tauri/tauri.conf.json`                                                                                      | Tauri app config                                                            | No Tauri binary to configure                                                                 |
| `src-tauri/capabilities/default.json`                                                                            | Tauri capability allowlist                                                  | No Tauri command surface                                                                     |
| `src-tauri/icons/*`                                                                                              | Tauri-bundled icon set                                                      | electron-builder reads from `build/icons/` (PR-D3 copies a subset there — see §2.5 and §3.1) |
| `.github/workflows/tauri-build.yml`                                                                              | Cross-platform `npx tauri build --ci` matrix                                | Scripts + CLI removed                                                                        |
| All `#[tauri::command]` decorated functions                                                                      | 20 thin wrappers around `*_inner` helpers                                   | IPC router calls `BackendState` directly                                                     |
| `src/lib/backend.ts` Tauri fallback branches                                                                     | `@tauri-apps/api/core` + `/event` import + their use in `invoke` / `listen` | `window.vimeflow` is the only transport                                                      |
| `src/lib/environment.ts` `__TAURI_INTERNALS__` probe + `TauriInternals` interface + global `Window` augmentation | Tauri-host detection                                                        | Only Electron sets `window.vimeflow`                                                         |
| `src/lib/backend.test.ts` `@tauri-apps fallback path` describe block (~6 cases)                                  | Fallback-path unit tests                                                    | No fallback to test                                                                          |
| `src/lib/environment.test.ts` `__TAURI_INTERNALS__` fixtures                                                     | Tauri-signal tests                                                          | No `__TAURI_INTERNALS__`                                                                     |

### 2.4 What Gets Renamed

- `src/features/terminal/services/tauriTerminalService.ts` →
  `desktopTerminalService.ts` (file rename); class
  `TauriTerminalService` → `DesktopTerminalService` (with sibling test
  file `tauriTerminalService.test.ts` → `desktopTerminalService.test.ts`).
- Class `TauriGitService` → `DesktopGitService` inside
  `src/features/diff/services/gitService.ts` (no file rename — the
  file owns multiple classes).
- Class `TauriFileSystemService` → `DesktopFileSystemService` inside
  `src/features/files/services/fileSystemService.ts` (no file rename —
  same reason).
- Two factory call sites flip: `terminalService.ts:389` and
  `gitService.ts:182` reference the new class names. The
  `fileSystemService.ts` factory at `:106` is in the same file as
  its class, so the rename is local.

### 2.5 What Gets Added

- `electron-builder.yml` at repo root.
- `build/icons/` populated with size-named PNGs that electron-builder's
  Linux target reads natively: `32x32.png`, `128x128.png`,
  `128x128@2x.png` (copied from the existing `src-tauri/icons/`). The
  AppImage embeds the largest size; the smaller sizes are used by
  desktop-environment menus / dock icons. **Note:** `.gitignore`
  currently ignores `build/` (line 1 of `.gitignore`). PR-D3 adds
  un-ignore rules `!build/`, `!build/icons/`, `!build/icons/*.png` so
  the icon files are tracked. The `release/` electron-builder output
  directory remains ignored (added in the same `.gitignore` edit).
- `build/icons/icon.png` is NOT added separately — `electron-builder.yml`
  points `linux.icon` at one of the size-named files (default behavior
  picks the largest), so a top-level `icon.png` is unused.
- `npm run electron:build` and `npm run backend:build:release` scripts
  in `package.json`.
- `release/` to the `.gitignore` set (electron-builder output dir).

### 2.6 Bridge Edit Is Minimal (PR-C §2.5 Contract)

PR-C's spec §2.5 locked in that PR-D's bridge edit would be a "4-to-6-line
delete of the `@tauri-apps` imports and the fallback branches". The
contract is honored:

```ts
// Before (current PR-C post-merge state):
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen as tauriListen } from '@tauri-apps/api/event'
// ...
export const invoke = async <T>(method, args) => {
  if (typeof window !== 'undefined' && window.vimeflow) {
    return window.vimeflow.invoke<T>(method, args)
  }
  return tauriInvoke<T>(method, args) // ← dies
}
export const listen = async <T>(event, callback) => {
  const rawUnlisten =
    typeof window !== 'undefined' && window.vimeflow
      ? await window.vimeflow.listen<T>(event, callback)
      : await tauriListen<T>(event, (e) => callback(e.payload)) // ← dies
  // ... `called`-guard wrapper unchanged ...
}

// After:
export const invoke = async <T>(method, args) =>
  window.vimeflow!.invoke<T>(method, args)
export const listen = async <T>(event, callback) => {
  const rawUnlisten = await window.vimeflow!.listen<T>(event, callback)
  // ... `called`-guard wrapper unchanged ...
}
```

The 2 imports + the two fallback branches go. The bridge's only surviving
job is the `called`-guard idempotency wrapper for `UnlistenFn` (React
StrictMode's mount→cleanup→remount fires it twice in dev — without the
guard, an underlying transport without idempotency would throw on the
second call).

`window.vimeflow` is asserted non-null because the only post-PR-D3 entry
point is the Electron renderer, where the preload sets it before the
renderer JS runs. The `!` is safe but readers may prefer an explicit
runtime check — see §4.1 R3 for the failure-mode discussion.

## 3. electron-builder Packaging Contract

### 3.1 `electron-builder.yml`

```yaml
# electron-builder.yml — Linux AppImage packaging for vimeflow.
# macOS / Windows targets are deferred to a follow-up PR.

appId: io.vimeflow.app
productName: Vimeflow

# The renderer (Vite) emits to `dist/`, the Electron bundles emit to
# `dist-electron/`, the Cargo release binary lives under
# `src-tauri/target/release/`. electron-builder reads from those for
# `files` + `extraResources`.
directories:
  output: release
  buildResources: build

# What goes into the asar archive.
files:
  - dist/**/*
  - dist-electron/**/*
  - package.json

# Sidecar binary copied to `<resources>/bin/vimeflow-backend` inside the
# AppImage. electron/main.ts:39-52 already resolves this path via
# `path.join(process.resourcesPath, 'bin', BINARY_NAME)` when
# `app.isPackaged` is true.
extraResources:
  - from: src-tauri/target/release/vimeflow-backend
    to: bin/vimeflow-backend

asar: true

linux:
  target:
    - AppImage
  category: Development
  # Stable filename so the §1.1 smoke step's `release/vimeflow-*.AppImage`
  # glob has a deterministic match across builds.
  artifactName: vimeflow-${version}-${arch}.AppImage
  # Point at the largest size-named PNG; electron-builder generates the
  # other sizes from it. The file is checked in at `build/icons/256x256.png`
  # (sourced by upscaling from `src-tauri/icons/128x128@2x.png` during
  # PR-D3 implementation — see §2.5).
  icon: build/icons/256x256.png

# No publish target — release/upload is deferred follow-up.
publish: null
```

### 3.2 Why Each Field

- `appId`: reverse-DNS identifier required by AppImage manifest.
  `io.vimeflow.app` is a placeholder; if a project owns a domain, change
  to that domain's reverse-DNS form.
- `productName`: human-readable name shown in the launcher / window title.
  Independent of `package.json:name` ("vibm") — that's the npm package
  name; this is the app's distribution name.
- `directories.output: release` — electron-builder defaults to `dist/`,
  which would collide with the Vite renderer output. `release/` is
  conventional for packaging artifacts and matches the §1.1 smoke
  command's glob.
- `directories.buildResources: build` — where electron-builder looks for
  icons, entitlements, etc. Default value; declared explicitly because
  PR-D3 places `build/icons/icon.png` there.
- `files`: the asar payload. `dist/**/*` ships the renderer; `dist-electron/**/*`
  ships `main.js` + `preload.mjs`; `package.json` is needed because
  Electron resolves `main` from it at launch.
- `extraResources`: NOT bundled into asar — copied to a sibling of the
  asar so it can be executed as a child process. Asar contents can't be
  `spawn()`d directly (the asar archive doesn't expose individual files
  as executables on the filesystem). The sidecar binary MUST live outside
  asar.
- `asar: true`: explicit because some electron-builder versions default
  to `false` for `linux` targets. Speeds up startup (one mmap instead of
  thousands of file opens) and keeps the resource tree opaque.
- `linux.target.AppImage`: the chosen distribution format. Single
  portable file; no install/uninstall flow; runs on any glibc-based Linux
  with no system deps.
- `linux.category: Development`: AppStream category. Picked from
  `xdg-utils`'s registered list; doesn't affect runtime.
- `linux.icon: build/icons/256x256.png`: explicit path to the largest
  source PNG. electron-builder downscales from this for the smaller
  sizes the desktop environment requests. Without this, electron-builder
  falls back to its embedded default Electron icon (visible during
  smoke).
- `publish: null`: prevents electron-builder from attempting to upload
  the AppImage on a successful build. Release wiring is a deferred
  follow-up.

### 3.3 Build Pipeline

```

npm run electron:build
├── npm run type-check # tsc -b + tsc -p electron/tsconfig.json
├── cross-env vite build --mode electron # emit dist/ + dist-electron/
├── npm run backend:build:release # cargo build --release --bin vimeflow-backend
└── electron-builder --linux AppImage # consume above + electron-builder.yml

```

The `backend:build:release` script is new:

```jsonc
"backend:build:release": "cd src-tauri && cargo build --release --bin vimeflow-backend",
```

Release profile because the produced AppImage ships to end users; debug
binaries are 5-10× larger and 2-3× slower at startup. The existing
`backend:build` (debug) is preserved for `electron:dev`.

### 3.4 Packaging Smoke Acceptance

Run after the implementation is complete:

```bash
npm run electron:build
ls -la release/
# Expected:
#   release/vimeflow-0.1.0-x64.AppImage  (~120-180 MB, executable)
#   release/<other electron-builder artifacts>

chmod +x release/vimeflow-0.1.0-x64.AppImage
./release/vimeflow-0.1.0-x64.AppImage --no-sandbox &
```

`--no-sandbox` is required when running the produced AppImage on a host
without a working SUID chrome-sandbox (most dev hosts and many end-user
Linux systems). electron-builder wraps the binary in an `AppRun` shell
script that handles library path setup but does **not** install or
satisfy the chrome-sandbox dependency — that's a host-OS concern. PR-D3
ships an AppImage that requires either `--no-sandbox` or a host with
`unprivileged_userns_clone=1` kernel knob. End-user-safe sandboxed
distribution (auto-installing chrome-sandbox helpers, wrapping in
flatpak, etc.) is a deferred follow-up; see §4.1 R2.

The 7 baseline flows from §1.1 must all pass:

1. App window opens (~3-5s cold start).
2. Default terminal spawns; `pwd` returns the working directory.
3. `ls -la` produces clean output with no dropped bytes.
4. Open `README.md` from file explorer; editor renders content.
5. Diff panel shows current branch + uncommitted status.
6. Open a second terminal pane; close it; tab count decrements.
7. Quit and relaunch; session cache reconciliation matches dev parity.

If any step regresses, the most likely failure modes are §4's
documented risks: sidecar resource path mismatch, asar packaging
gotchas, or AppImage SUID-sandbox issues.

## 4. Risks & Rollback

### 4.1 High-Severity Risks

**R1 — Sidecar resource path mismatch in packaged AppImage.**
`electron/main.ts:40-42` resolves `process.resourcesPath/bin/<BINARY>` when
`app.isPackaged` is true. The electron-builder.yml's `extraResources` entry
must put the binary at exactly that path. Mismatch (e.g., `bin/backend` vs
`bin/vimeflow-backend`, or missing the `bin/` prefix) produces a silent
ENOENT — the renderer launches but `window.vimeflow.invoke` rejects every
call with "backend unavailable" via sidecar.ts's spawn-error handler.

_Mitigation:_ the packaging smoke (§3.4) catches this on first launch
because step 2 (`pwd` in terminal) fails immediately. Build-time
verification: post-build, `unsquashfs -ll release/vimeflow-*.AppImage |
grep vimeflow-backend` to confirm the binary's path inside the AppImage's
SquashFS payload matches what main.ts expects.

**R2 — AppImage SUID-sandbox refusal on Linux dev hosts.**
A bare-AppImage launch on a host without a SUID `chrome-sandbox` (most
non-Chromium-distro systems) fails with "Failed to move to new namespace:
PID namespaces supported, Network namespace supported, but failed: errno
= Operation not permitted". The smoke step in §3.4 uses `--no-sandbox` to
work around this, but the workaround is not appropriate for
end-user distribution. Production distribution of the AppImage should
wrap in an `AppRun` script or rely on a host with `unprivileged_userns_clone=1`.

_Mitigation:_ document `--no-sandbox` as the smoke command but flag that
end-user installation needs the host's chrome-sandbox or the
unprivileged-userns kernel knob. Note: deferred follow-up adds an `AppRun`
wrapper if cross-host distribution becomes a target.

**R3 — Bridge `!` assertion races a slow preload.**
The post-PR-D3 bridge in §2.6 uses `window.vimeflow!.invoke(...)`. The
non-null assertion is safe **only if** the Electron preload script runs
before the renderer's first JS executes. This is normally guaranteed by
Electron's `preload` option — the preload's `contextBridge.exposeInMainWorld`
fires before the renderer's `<script>` tags load. But under sandbox: true

- contextIsolation: true (which `electron/main.ts:200-202` enables), if
  the preload throws **during** its exposure call (e.g. by importing a
  module that fails), the renderer launches with no `window.vimeflow` and
  every `invoke` call throws "Cannot read properties of undefined (reading
  'invoke')" — non-recoverable.

_Mitigation:_ keep the bridge's two-call surface (invoke + listen) but
add a one-time assertion at first call: `if (!window.vimeflow) throw new
Error('preload did not expose window.vimeflow; backend unavailable')`. The
extra branch is dead code in the happy path and yields a useful error
message in the failure path. The acceptance gate's `npm run electron:dev`
smoke catches preload exposure failures because the renderer hangs
visibly with no PTY data; CSP / preload exposure failures show up as
DevTools errors.

### 4.2 Medium-Severity Risks

**R4 — `cargo test` count drift from cfg(test) alias deletion.**
§1.3's claim is that `cargo test` count matches PR-D2 baseline. This holds
ONLY if the implementation preserves the `#[cfg(test)] pub fn xxx(...)`
aliases. If a contributor mistakenly deletes one of those (e.g. when
ripping out the production `#[tauri::command]` neighbor), the
corresponding test entry point vanishes and the test count drops.

_Mitigation:_ the plan-level breakdown (separate PR-D3 plan doc) calls
out the `#[cfg(test)]` aliases explicitly per file. The implementation
diff should keep the aliases byte-for-byte; reviewers should look for
`#[cfg(test)] pub` adjacent to every `#[cfg(not(test))] #[tauri::command] pub` deletion.

**R5 — Icon resolution fallback.**
electron-builder's Linux target reads `build/icons/{32x32,128x128,...}.png`.
If those files aren't present at build time, electron-builder silently
falls back to its embedded default Electron logo. This is visible in the
launcher / dock / taskbar but does not break functionality. PR-D3's
un-ignore rules + copy-from-src-tauri/icons are load-bearing for proper
icon display; the smoke step's "App window opens" check should verify
the window title bar and taskbar icon are the vimeflow icon, not the
generic Electron logo.

**R6 — `src-tauri/` directory rename is deferred but the name becomes misleading.**
After PR-D3, `src-tauri/` contains only the Rust sidecar — no Tauri code.
The directory name is preserved per the migration roadmap's deferred
follow-up (renaming touches every Cargo path, every test script, every
CI workflow, and is its own atomic refactor). Until renamed, new
contributors looking at the directory will reasonably assume Tauri is
still in use. PR-D3 adds a `src-tauri/README.md` (or updates the
existing `src-tauri/CLAUDE.md`) noting "Despite the directory name, this
crate contains only the Electron sidecar binary post-PR-D3. Rename to
`backend/` is tracked as a follow-up." to defuse the confusion until
the rename lands.

### 4.3 Low-Severity Risks

**R7 — Stale `tauri::Runtime` references in `agent/architecture.{puml,svg}`.**
The acceptance grep in §1.3 excludes these files. They still describe
the pre-D3 `AgentAdapter<R: tauri::Runtime>` trait shape that's being
flattened to a non-generic version when the wrappers go. Diagrams become
misleading. _Mitigation:_ deferred follow-up to redraw; documented as a
known-stale path in §1.3.

**R8 — `keywords: ["tauri"]` is searchable on npm.**
Removing the `"tauri"` keyword from `package.json:keywords` is in scope
(§1.1) but the `package.json:name` ("vibm") and the repo URL are
unchanged. Users who found the project via the "tauri" keyword search
will keep finding it through the historical npm metadata until a new
package version is published. _Mitigation:_ none required at PR-D3
scope; publish-time concern.

### 4.4 Rollback

PR-D3 is a single atomic PR. Rollback options:

- **Full revert:** `git revert <merge-sha>` undoes the entire PR. This
  restores Tauri runtime, the bridge fallback, the Tauri command
  wrappers, and the CI apt deps. `npm install` will need to re-pull
  `@tauri-apps/api` and `@tauri-apps/cli`; the sidecar still builds.
- **Partial revert:** if only the electron-builder wiring causes problems
  (R1, R2, R5), revert just the electron-builder.yml + package.json
  script edits via `git revert` against the specific commit(s) in the
  PR-D3 commit sequence. The Rust cleanup + frontend bridge tightening
  is independent and can stay merged. `npm run electron:dev` continues
  working unchanged.

The migration is irreversible in the "design intent" sense once PR-D3
merges to `main` — the Tauri runtime is gone, contributors will start
adding electron-only code paths, and re-introducing Tauri later would
be a new architectural decision rather than a revert.

### 4.5 What This Spec Does Not Promise (Known Deferrals)

- Production-ready cross-platform packaging. PR-D3 ships a working
  Linux-only AppImage smoke. mac/win targets are a follow-up.
- A signed / notarized AppImage. Distribution security is a follow-up.
- An end-user-safe sandbox story. PR-D3's AppImage requires
  `--no-sandbox` or a host kernel with `unprivileged_userns_clone=1`;
  bundling chrome-sandbox / flatpak / AppRun-with-sandbox-helper is a
  follow-up.
- Auto-update wiring. Squirrel/AppImageUpdate integration is a follow-up.
- Multi-platform CI parity. The post-PR-D3 CI runs only `e2e.yml` on
  Linux. A `packaged-build.yml` matrix is a follow-up.
- A `backend/` directory rename. Tracked as deferred per migration
  roadmap; out of PR-D3 scope to keep diff bounded.
- Redrawing `src-tauri/src/agent/architecture.{puml,svg}` to match the
  post-D3 non-generic `AgentAdapter` trait shape (the diagrams still
  show `AgentAdapter<R: tauri::Runtime>`). Excluded from the §1.3
  acceptance grep via `--glob '!**/*.puml' --glob '!**/*.svg'`.

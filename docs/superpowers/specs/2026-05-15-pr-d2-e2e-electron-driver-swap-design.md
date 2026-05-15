# PR-D2 — E2E driver swap to Electron Design Spec

## 1. Overview & Scope

**Goal:** Replace the Tauri/wry WebDriver pipeline (`tauri-driver` + `browserName: 'wry'` + `tauri:options`) with Electron CDP via `@wdio/electron-service` across the three WDIO suites (`core`, `terminal`, `agent`). After this PR, `npm run test:e2e:all` launches the same Electron binary as `npm run electron:dev` — but adds `--no-sandbox` to `appArgs` only for the E2E entry point. `electron:dev` keeps the default sandbox behavior; sandbox-off is an E2E-only concession. The sidecar is built with the `e2e-test` Cargo feature; the renderer is built with `VITE_E2E=1` baked in (and `VITE_E2E=1` is also set in `process.env` before WDIO spawns Electron so the main process unlocks `list_active_pty_sessions`). The Tauri E2E surface is removed in this PR; PR-D3 removes the Tauri runtime entirely.

**Migration roadmap:** `docs/superpowers/plans/2026-05-13-electron-rust-backend-migration.md` Task 9. PR-D1 (#209, just landed) shipped the Electron shell + sidecar wiring; PR-D3 ships Tauri runtime removal + electron-builder packaging smoke.

**Tech Stack:** Electron 42 (already pinned by PR-D1), `@wdio/electron-service` (new devDep, v10), WDIO 9.27 (already installed), Mocha framework (unchanged), `tsx` runtime resolver (unchanged), Rust sidecar binary `vimeflow-backend` (built with `--features e2e-test`).

### 1.1 In Scope

- Add `@wdio/electron-service` as a devDep.
- Create `tests/e2e/shared/electron-app.ts` exposing the bundled-main entry point and electron CLI args; replace the deleted `tests/e2e/shared/tauri-driver.ts`.
- Rewrite each of the three `tests/e2e/{core,terminal,agent}/wdio.conf.ts` files to use `browserName: 'electron'` + `wdio:electronServiceOptions` + `services: ['electron']`.
- Update `tests/e2e/tsconfig.json:types` to pull in the `@wdio/electron-service` global augmentations so `'wdio:electronServiceOptions'` type-checks.
- Rewrite the `test:e2e:build` npm script to build the renderer + bundled main + bundled preload (`cross-env VITE_E2E=1 vite build --mode electron`) and the sidecar binary (`cd src-tauri && cargo build --bin vimeflow-backend --features e2e-test` — the Cargo manifest lives under `src-tauri/`, so the script must `cd` or use `--manifest-path`) instead of the Tauri app binary.
- Propagate `VITE_E2E=1` to Electron at runtime: each `wdio.conf.ts` `onPrepare` hook sets `process.env.VITE_E2E = '1'` so `electron/main.ts:212` (`!app.isPackaged && process.env.VITE_E2E === '1'`) flips on the E2E-only backend-method allowlist before `@wdio/electron-service` spawns Electron. Required by `tests/e2e/terminal/specs/session-lifecycle.spec.ts` which calls `listActivePtySessions()`.
- Update `.github/workflows/e2e.yml` to drop the `tauri-driver` install step, the `webkit2gtk-driver` system dep, the `WEBKIT_DISABLE_DMABUF_RENDERER` env, and the Tauri-binary build step; keep `xvfb-run` (still required for Electron under headless Linux).
- Fix the PR-D1 leftover `package.json:main` mismatch — the field currently points at `dist-electron/main.mjs`, but `vite build --mode electron` actually emits `dist-electron/main.js` (vite-plugin-electron's underlying `lib` config sets `formats: ['es']` + `fileName: () => '[name].js'` in `node_modules/vite-plugin-electron/dist/index.mjs:17`, which produces `.js` regardless of `package.json:type=module`). Update `package.json:main` to `dist-electron/main.js` and point `appEntryPoint` at the same path. Empirically verified by running `vite build --mode electron` on the current HEAD: `dist-electron/main.js` (10.54 KB) and `dist-electron/preload.mjs` (0.39 KB) are produced.
- Fix the misleading inline comment in `vite.config.ts:602-607` that claims "the plugin emits main as ESM at dist-electron/main.mjs". The empirical emission is `main.js` (preload IS `.mjs` per the plugin's `entryFileNames` override for preload, but main is not). Update the comment block to describe what actually happens; otherwise future readers (and code reviewers, including codex) keep treating the comment as authoritative.

### 1.2 Out of Scope

- Removing the Tauri runtime surface (Cargo deps, `tauri.conf.json`, `lib.rs` Tauri wrapper). That's PR-D3.
- Renaming `src-tauri/` to a runtime-neutral directory.
- electron-builder packaging / signed binaries.
- E2E spec rewrites — every spec under `tests/e2e/*/specs/` lands unchanged; they operate on DOM + `window.__VIMEFLOW_E2E__` and are already runtime-agnostic.
- The `renderer` option of `vite-plugin-electron` (renderer-side Node access). Not used today and not needed for PR-D2.
- Re-enabling Electron's sandbox via AppArmor under E2E — `--no-sandbox` is the deliberate choice for the WDIO entry point on Linux dev hosts + CI runners that don't ship a SUID chrome-sandbox. `npm run electron:dev` is NOT affected by this flag (it runs the default sandboxed Electron via `vite-plugin-electron`'s `startup(['.'])`). Production sandbox parity for packaged builds lands with PR-D3.
- Refactoring the three `wdio.conf.ts` files into a shared base config — see "Approach A vs B" in §2.

### 1.3 Acceptance Posture

- All 11 existing E2E specs (4 core + 6 terminal + 1 agent) pass under Electron on a local Linux dev host after `npm run test:e2e:build && npm run test:e2e:all`.
- `npm run type-check` and `npm run lint` stay green; `npm run format:check` warnings stay restricted to the pre-existing `src-tauri/bindings/` auto-generated set.
- CI's `e2e-linux` job passes on the post-PR-D2 main branch without any manual intervention or follow-up CI patch.
- `npm run tauri:dev` is allowed to break in this PR (PR-D3 deletes it). `npm run electron:dev` must remain green.

## 2. Architecture & Lifecycle

### 2.1 Layered Launch Sequence

```
WDIO test process (npx wdio tests/e2e/<suite>/wdio.conf.ts)
  → onPrepare: set process.env.VITE_E2E=1 (+ per-suite agent-detection toggle)
  → @wdio/electron-service launcher
      - reads wdio:electronServiceOptions.{appEntryPoint, appArgs}
      - resolves Electron binary from local node_modules
      - downloads/reuses cached chromedriver matching Electron's Chromium version
      - launches chromedriver locally (port managed by the service, not us)
      - chromedriver spawns Electron with --remote-debugging-port:
        <electron-binary> dist-electron/main.js --no-sandbox [other appArgs]
                (inherits parent process.env, so VITE_E2E=1 reaches main.ts)
  → Electron main (dist-electron/main.js)
      - spawnSidecar() → src-tauri/target/debug/vimeflow-backend --app-data-dir <userData>
      - registers ipcMain.handle(BACKEND_INVOKE)
      - allowE2eBackendMethods = !app.isPackaged && process.env.VITE_E2E === '1'  ← TRUE under E2E
      - createWindow() loads file://.../dist/index.html (no dev server in E2E build)
  → Renderer (dist/index.html, built with VITE_E2E=1)
      - import.meta.env.VITE_E2E === '1' so e2e-bridge.ts attaches window.__VIMEFLOW_E2E__
  → @wdio/electron-service: attaches to Electron via CDP, exposes `browser` to specs
  → Mocha specs run against the renderer (DOM + window.__VIMEFLOW_E2E__)
  → onComplete / teardown: service kills Electron + sidecar inherited cleanup runs
```

### 2.2 Why The Old Tauri Lifecycle Code Goes Away

The Tauri pipeline had three explicit lifecycle responsibilities — none of them survive:

1. **Spawn a separate WebDriver process** (`tauri-driver` on port 4444). `@wdio/electron-service` is in-process; no second binary, no port allocation, no `waitForPort` polling.
2. **Resolve the `tauri-driver` binary path** (4-level fallback: `$TAURI_DRIVER_PATH` → `~/.cargo/bin` → `~/.local/bin` → `PATH`). Replaced by NPM's `node_modules/.bin/electron` resolution baked into the service.
3. **Force classic WebDriver protocol** (`wdio:enforceWebDriverClassic: true`) because WebKitWebDriver rejected `webSocketUrl: true` + `unhandledPromptBehavior: "ignore"`. Replaced by `@wdio/electron-service`'s managed chromedriver: the service downloads (or reuses cached) chromedriver, launches it locally, spawns Electron with `--remote-debugging-port`, and routes WDIO's WebDriver protocol through chromedriver → Chromium's CDP. WDIO scripts still call standard WebDriver commands; only the underlying driver process changes.

Net effect: `tests/e2e/shared/tauri-driver.ts` (89 lines, including port-wait loop + 4-path binary resolver + stderr piping) becomes `tests/e2e/shared/electron-app.ts` (~20 lines: two `path.resolve` constants + the `--no-sandbox` array).

### 2.3 Approach A vs B (recap from planning)

- **Approach A — three separate configs + shared helper** (chosen). Each `wdio.conf.ts` is self-contained; only the shared launch contract (entry point + appArgs) lives in `tests/e2e/shared/electron-app.ts`. ~70% of the three configs is duplicated by design (same convention as the pre-PR-D2 Tauri configs).
- **Approach B — shared `wdio.base.conf.ts`** (deferred). Worthwhile follow-up after PR-D2 lands; mixing the DRY refactor into the migration PR doubles review surface for no incremental safety.

### 2.4 Capability Shape

Each `wdio.conf.ts` declares exactly one capability object:

```ts
capabilities: [
  {
    browserName: 'electron',
    'wdio:electronServiceOptions': {
      appEntryPoint, // dist-electron/main.js (absolute, from electron-app.ts)
      appArgs, // ['--no-sandbox']
    },
  },
],
services: ['electron'],
```

The `'wdio:electronServiceOptions'` property is declared by `@wdio/native-types/dist/esm/index.d.ts:28` via `declare global { namespace WebdriverIO { interface Capabilities { … } } }`. The augmentation is reached transitively through `@wdio/electron-service`'s top-of-file `import '@wdio/native-types'`. To activate the augmentation in this project, `tests/e2e/tsconfig.json:types` adds `"@wdio/electron-service"`. **Note on type-check enforcement:** the project's `npm run type-check` script does NOT currently include the E2E tsconfig (root `tsconfig.json:24` only includes `src`; `electron/tsconfig.json` only the electron entries). The WDIO runtime resolver consumes the configs via `tsx` (permissive). The acceptance gate (§1.3) therefore relies on a manual smoke check (`npx tsc --noEmit -p tests/e2e/tsconfig.json` on the new `wdio.conf.ts` files) rather than a folded-in build step. Folding the E2E tsconfig into `npm run type-check` is deferred: existing test specs have pre-existing type-error noise unrelated to PR-D2 and cleaning that up belongs in a separate change.

### 2.5 onPrepare Hook Responsibilities

The hook does exactly two things:

1. `process.env.VITE_E2E = '1'` — required by `electron/main.ts:212` so the E2E-only backend-method allowlist (`list_active_pty_sessions`) is enabled. WDIO's child-process spawn inherits parent env, so this lands in the Electron main process.
2. Per-suite agent-detection toggle:
   - `core` / `terminal`: `process.env.VIMEFLOW_DISABLE_AGENT_DETECTION = '1'` (avoids dev-host claude processes destabilising unrelated specs — see #71).
   - `agent`: `delete process.env.VIMEFLOW_DISABLE_AGENT_DETECTION` (suite needs detection on; the spec has its own skip-guard for pre-existing claude processes).

`onComplete` is removed entirely — `@wdio/electron-service` owns Electron teardown.

### 2.6 Failure Modes The New Pipeline Surfaces

| Failure                                                            | Symptom                                                                                                                                   | Detection point                   |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `dist-electron/main.js` missing (forgot `test:e2e:build`)          | service throws "App entry point not found" at session-start                                                                               | service `validateFilePath`        |
| `src-tauri/target/debug/vimeflow-backend` missing                  | Electron main calls `spawnSidecar`; `child.on('error')` fires; sidecar `invoke` rejects "backend unavailable"; first spec assertion fails | `electron/sidecar.ts:disable()`   |
| Renderer NOT built with `VITE_E2E=1`                               | `window.__VIMEFLOW_E2E__` is `undefined`; bridge-dependent specs throw at first call                                                      | spec line that touches the bridge |
| `chrome-sandbox` SUID missing AND `--no-sandbox` dropped from args | Electron fails with "SUID sandbox helper binary" error                                                                                    | startup, before any spec          |
| Stale `electron:dev` Vite server on `:5173`                        | none — E2E build loads from `dist/index.html` via `loadFile`; the dev server is never consulted                                           | n/a                               |
| Chromedriver download fails (network-restricted CI)                | service throws "Failed to download chromedriver" at first session-start                                                                   | service launcher (pre-spawn)      |
| Chromedriver version mismatch with bundled Electron Chromium       | first WDIO command fails with "session not created: Chromedriver only supports Chrome version N"                                          | first `browser.url`/`$$` call     |

## 3. File Structure

### 3.1 New (1 file)

- `tests/e2e/shared/electron-app.ts` — ESM module exporting the WDIO ↔ Electron launch contract. Two `path.resolve()` constants (`repoRoot`, `appEntryPoint`) and one `string[]` (`appArgs`). No process spawning, no port management — the service owns the lifecycle. See §4.1 for the contract.

### 3.2 Modified (8 files)

- `package.json` — three deltas:
  1. Add `"@wdio/electron-service": "^10"` to `devDependencies`.
  2. Change `"main"` from `"dist-electron/main.mjs"` to `"dist-electron/main.js"` (PR-D1 leftover).
  3. Rewrite `"test:e2e:build"` (see §5 for full script body).
- `package-lock.json` — auto-updated by `npm install`. Committed alongside `package.json`.
- `vite.config.ts` — comment-only fix at lines 602-607: rewrite the inline comment block that misdescribes the `main`/`preload` emission. No behavior change.
- `tests/e2e/tsconfig.json` — add `"@wdio/electron-service"` to the `types` array. Required for the `'wdio:electronServiceOptions'` capability key to type-check (the augmentation in `@wdio/native-types/dist/esm/index.d.ts:28` only activates when the package is loaded into the type context).
- `tests/e2e/core/wdio.conf.ts` — full rewrite per §4.2. ~10 lines added vs the Tauri version after capabilities/services swap and onPrepare slim-down.
- `tests/e2e/terminal/wdio.conf.ts` — full rewrite per §4.2. Same shape as `core`; differs only in `waitforTimeout`/`mochaOpts.timeout` (20 s / 60 s).
- `tests/e2e/agent/wdio.conf.ts` — full rewrite per §4.2. Same shape; differs in agent-detection env (`delete process.env.VIMEFLOW_DISABLE_AGENT_DETECTION` instead of `=1`) and timeouts (30 s / 90 s).
- `.github/workflows/e2e.yml` — full rewrite of the runner steps. See §6 for the complete diff.

### 3.3 Deleted (1 file)

- `tests/e2e/shared/tauri-driver.ts` — 89 lines. All exports (`appBinary`, `startTauriDriver`, `stopTauriDriver`, `TAURI_DRIVER_PORT`, `repoRoot`) become dead after the wdio.conf rewrites. `repoRoot` is republished from `electron-app.ts` so callers (if any future helper wants it) keep working.

### 3.4 Files Explicitly NOT Touched

- `src/**` — renderer is unchanged. `src/lib/e2e-bridge.ts` already migrated to `backend.invoke` during PR-C; specs continue to use `window.__VIMEFLOW_E2E__` exactly as today.
- `src/types/e2e.d.ts` — the `Window['__VIMEFLOW_E2E__']` declaration stays.
- `electron/**` — main, preload, sidecar are unchanged. PR-D1's allowlist (`electron/backend-methods.ts`) already gates `list_active_pty_sessions` behind `allowE2eMethods`.
- `src-tauri/**` Rust code — the `e2e-test` Cargo feature already exists (`src-tauri/Cargo.toml:43-44`); the `vimeflow-backend` binary already supports it. No source changes.
- `tests/e2e/*/specs/**` — all 11 spec files untouched. They are DOM/bridge-only and runtime-agnostic.
- `tests/e2e/shared/actions.ts`, `tests/e2e/shared/terminal.ts` — WebDriver action helpers that use `browser.execute(...)`; no Tauri/Electron-specific code. Untouched.
- `tests/e2e/tsconfig.json:include` — already `["**/*.ts"]`, covers the new helper.

### 3.5 Generated Build Artifacts (gitignored)

Produced by `npm run test:e2e:build`; not committed:

- `dist/` — renderer bundle with `VITE_E2E=1` baked in.
- `dist-electron/main.js` — bundled Electron main.
- `dist-electron/preload.mjs` — bundled preload (the plugin's deliberate `.mjs` extension for preload; main stays `.js`).
- `src-tauri/target/debug/vimeflow-backend` — sidecar with `e2e-test` feature.

## 4. Implementation Details (per-file contracts)

### 4.1 `tests/e2e/shared/electron-app.ts` (new)

```ts
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

// --no-sandbox is required on most Linux dev hosts and CI runners that don't
// ship a SUID chrome-sandbox; this matches what the Tauri/wry path effectively
// ran without. NOT applied to `npm run electron:dev` (vite-plugin-electron's
// startup(['.']) hook keeps the default sandboxed mode). Packaged production
// builds (PR-D3) re-enable the sandbox.
export const appArgs: string[] = ['--no-sandbox']
```

**Properties:**

- `repoRoot` is republished (the deleted `tauri-driver.ts` exposed it too); any future helper using it keeps working.
- `appArgs` is a mutable `string[]` (not `readonly`) because `ElectronServiceOptions.appArgs?: string[]` in `@wdio/native-types` declares it mutable; passing a `readonly` array would require a `[...spread]` at every call site.
- No process spawn, no port logic — the service owns the lifecycle.

### 4.2 `tests/e2e/{core,terminal,agent}/wdio.conf.ts`

**`core/wdio.conf.ts`** (full body):

```ts
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { appArgs, appEntryPoint } from '../shared/electron-app.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const config: WebdriverIO.Config = {
  runner: 'local',
  framework: 'mocha',
  reporters: ['spec'],

  specs: [path.resolve(__dirname, 'specs/**/*.spec.ts')],
  maxInstances: 1,
  maxInstancesPerCapability: 1,

  tsConfigPath: path.resolve(__dirname, '../tsconfig.json'),

  services: ['electron'],

  onPrepare: () => {
    // Renderer was built with VITE_E2E=1 (see `test:e2e:build`); the Electron
    // main process gates E2E-only backend methods (list_active_pty_sessions)
    // on the same runtime env, so propagate it before the service spawns
    // Electron. Child-process inheritance carries the value into main.ts.
    process.env.VITE_E2E = '1'
    // See #71: on a dev box with real Claude Code processes running, the
    // host-global agent detector can latch onto them and crash the webview
    // during startup. Disable for this suite which doesn't exercise the
    // detector.
    process.env.VIMEFLOW_DISABLE_AGENT_DETECTION = '1'
  },

  capabilities: [
    {
      browserName: 'electron',
      'wdio:electronServiceOptions': {
        appEntryPoint,
        appArgs,
      },
    },
  ],

  waitforTimeout: 10_000,
  mochaOpts: { ui: 'bdd', timeout: 30_000 },
}
```

**`terminal/wdio.conf.ts` diff vs core** (only these lines differ):

```diff
-  // host-global agent detector can latch onto them and crash the webview
-  // during startup. Disable for this suite which doesn't exercise the
-  // detector.
+  // See tests/e2e/core/wdio.conf.ts onPrepare for the rationale — skip
+  // agent detection in this suite so real claude processes on the dev
+  // host don't destabilise unrelated terminal specs. See #71.
   process.env.VIMEFLOW_DISABLE_AGENT_DETECTION = '1'
…
-  waitforTimeout: 10_000,
-  mochaOpts: { ui: 'bdd', timeout: 30_000 },
+  waitforTimeout: 20_000,
+  mochaOpts: { ui: 'bdd', timeout: 60_000 },
```

**`agent/wdio.conf.ts` diff vs core** (only these lines differ):

```diff
-  // host-global agent detector can latch onto them and crash the webview
-  // during startup. Disable for this suite which doesn't exercise the
-  // detector.
-  process.env.VIMEFLOW_DISABLE_AGENT_DETECTION = '1'
+  // Agent suite wants detection enabled — explicitly clear the env var in
+  // case it leaks in from the shell or a prior WDIO run. The spec itself
+  // has a skip-guard for pre-existing host claude processes (see
+  // agent-detect-fake.spec.ts and #71).
+  delete process.env.VIMEFLOW_DISABLE_AGENT_DETECTION
…
-  waitforTimeout: 10_000,
-  mochaOpts: { ui: 'bdd', timeout: 30_000 },
+  // Agent detection polls every ~2s; give it room.
+  waitforTimeout: 30_000,
+  mochaOpts: { ui: 'bdd', timeout: 90_000 },
```

### 4.3 `tests/e2e/tsconfig.json`

Single delta — add `"@wdio/electron-service"` to the `types` array:

```diff
   "compilerOptions": {
     …
-    "types": ["node", "mocha", "@wdio/globals/types", "expect-webdriverio"]
+    "types": [
+      "node",
+      "mocha",
+      "@wdio/globals/types",
+      "expect-webdriverio",
+      "@wdio/electron-service"
+    ]
   },
   "include": ["**/*.ts"]
```

### 4.4 `vite.config.ts` (comment fix)

Lines 602-607 currently say:

```ts
// Use vite-plugin-electron/simple's defaults. With root
// package.json:type=module, the plugin emits:
//   - main as ESM at dist-electron/main.mjs
//   - preload as CJS-content with .mjs extension at
//     dist-electron/preload.mjs (Electron's preload loader
//     handles this special case)
```

Replace with:

```ts
// Use vite-plugin-electron/simple's defaults. The plugin emits:
//   - main as ESM at dist-electron/main.js (the plugin's `lib`
//     config in node_modules/vite-plugin-electron/dist/index.mjs:17
//     hard-codes `fileName: () => '[name].js'`, so this stays .js
//     regardless of root package.json:type=module)
//   - preload as CJS-content with .mjs extension at
//     dist-electron/preload.mjs (the plugin's separate preload
//     config overrides entryFileNames with the .mjs suffix to
//     trigger Electron's preload-loader special case)
```

No behavior change. Anchored at the same location.

### 4.5 `package.json`

Three deltas:

```diff
-  "main": "dist-electron/main.mjs",
+  "main": "dist-electron/main.js",
…
   "devDependencies": {
+    "@wdio/electron-service": "^10",
     "@wdio/cli": "^9.27.0",
…
-    "test:e2e:build": "cross-env VITE_E2E=1 npm run build && cd src-tauri && cargo build --features e2e-test,tauri/custom-protocol",
+    "test:e2e:build": "tsc -b && cross-env VITE_E2E=1 vite build --mode electron && cd src-tauri && cargo build --bin vimeflow-backend --features e2e-test",
```

Rationale for each:

1. `main` → `.js`: the file the build actually produces.
2. `@wdio/electron-service ^10`: the canonical scoped package (`npm view @wdio/electron-service version` → `10.0.0`). Augmentations come through its transitive `@wdio/native-types` dep.
3. `test:e2e:build`: drops the Tauri-binary build (`cargo build --features e2e-test,tauri/custom-protocol`) and substitutes the renderer + Electron bundles + sidecar-only build. `tsc -b` retained so type-check fails fast before vite/cargo run. `cd src-tauri` keeps `cargo build` runnable from the npm script's repo-root cwd. See §5 for the full script discussion.

## 5. Build Pipeline (`test:e2e:build`)

### 5.1 Script Body

```jsonc
"test:e2e:build": "tsc -b && cross-env VITE_E2E=1 vite build --mode electron && cd src-tauri && cargo build --bin vimeflow-backend --features e2e-test"
```

### 5.2 Step-by-Step Contract

| Step | Command                                                                  | What it produces                                                                                                                                                                                      | Failure surface                                                          |
| ---- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1    | `tsc -b`                                                                 | nothing emitted (root tsconfig is `noEmit`); validates `src/**` types                                                                                                                                 | exits non-zero with file:line errors; CI/dev fails fast                  |
| 2    | `cross-env VITE_E2E=1 vite build --mode electron`                        | `dist/index.html` + `dist/assets/*` (renderer with `VITE_E2E=1` baked in via `import.meta.env`); `dist-electron/main.js` (Electron main, ESM, ~10 KB); `dist-electron/preload.mjs` (preload, ~0.4 KB) | vite build errors; missing entry; renderer too large warning (non-fatal) |
| 3    | `cd src-tauri && cargo build --bin vimeflow-backend --features e2e-test` | `src-tauri/target/debug/vimeflow-backend` (Rust sidecar with the `e2e-test` feature enabled, which makes the cache wipe deterministic per `lib.rs:46-50`)                                             | cargo compile error; exits non-zero                                      |

### 5.3 What Changed vs the Tauri Version

```diff
-"test:e2e:build": "cross-env VITE_E2E=1 npm run build && cd src-tauri && cargo build --features e2e-test,tauri/custom-protocol",
+"test:e2e:build": "tsc -b && cross-env VITE_E2E=1 vite build --mode electron && cd src-tauri && cargo build --bin vimeflow-backend --features e2e-test",
```

| Change                                                                                                             | Rationale                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build` → `tsc -b && cross-env VITE_E2E=1 vite build --mode electron`                                      | The old `npm run build` was `tsc -b && vite build`. Inlining lets us thread `VITE_E2E=1` through the same shell so it reaches both renderer compilation and the Electron-mode plugin invocation. Adding `--mode electron` triggers `vite-plugin-electron/simple`, which emits the main + preload bundles into `dist-electron/`.                                        |
| `cargo build --features e2e-test,tauri/custom-protocol` → `cargo build --bin vimeflow-backend --features e2e-test` | The Tauri custom-protocol feature is only needed for Tauri-binary E2E loading; the Electron sidecar doesn't run inside Tauri. `--bin vimeflow-backend` scopes the build to the sidecar binary instead of the whole crate (which would also compile the deprecated `vimeflow` Tauri main entry — PR-D3 deletes that). Shorter compile, no Tauri-runtime deps pulled in. |
| (new) `tsc -b` first                                                                                               | The new pipeline drops `npm run build` (which previously included `tsc -b`). Re-introducing it as the first step preserves the fast-fail behavior for type errors.                                                                                                                                                                                                     |

### 5.4 Cross-shell `cross-env` Notes

`cross-env VITE_E2E=1 cmd1 && cmd2` only exports `VITE_E2E` to `cmd1`. `&&` chains run in the same shell, so subsequent commands inherit the shell's env, but the `cross-env` prefix scopes the var only to its immediate argv child. Step 2 (`vite build`) needs `VITE_E2E=1` at build time so `import.meta.env.VITE_E2E === '1'` is folded into the renderer bundle; step 3 (`cargo build`) does NOT need `VITE_E2E` — the Rust sidecar doesn't read it. The script is correct as written.

`tsc -b` (step 1) doesn't need `VITE_E2E` either — TypeScript's vite-client types recognize `import.meta.env.VITE_E2E` regardless of whether the env var is set at compile time. So step 1 sits before the `cross-env` prefix without consequence.

### 5.5 Manual Run Sequence

A developer running E2E locally:

```bash
npm run test:e2e:build         # build everything
npm run test:e2e               # core suite
npm run test:e2e:terminal      # terminal suite
npm run test:e2e:agent         # agent suite
# OR
npm run test:e2e:all           # all three
```

`test:e2e:build` is idempotent — repeated runs are fast (cargo+vite incremental). It does NOT need to be re-run between suite invocations unless source changed.

### 5.6 What `test:e2e:build` Does NOT Do

- **Does not invoke `npm install`.** The dev must have run `npm install` once after the PR lands so `@wdio/electron-service` is present.
- **Does not start the Vite dev server.** Suites load `dist/index.html` via Electron's `loadFile` (the `else` branch in `electron/main.ts:195`). No `:5173` dependency at E2E time.
- **Does not delete prior `dist*/` outputs.** vite's `emptyOutDir: false` (set by vite-plugin-electron) means stale bundles can persist. If a developer suspects a stale build, `rm -rf dist dist-electron` is the manual reset.
- **Does not validate that `@wdio/electron-service` is installed.** If missing, WDIO fails at session start, not at build.
- **Does not produce a packaged binary.** `electron-builder` is PR-D3 scope.

## 6. CI Workflow Update (`.github/workflows/e2e.yml`)

### 6.1 Steps Removed

| Step                                                                                                                            | Reason                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Cache tauri-driver` (lines 59-64)                                                                                              | `tauri-driver` not used; `@wdio/electron-service` manages chromedriver and caches it under `~/.cache/wdio` (handled by the service, not us).                                                                                      |
| `Install tauri-driver` (lines 66-68)                                                                                            | Same.                                                                                                                                                                                                                             |
| `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`, `webkit2gtk-driver` from `apt-get` | These are Tauri-build / wry dependencies. The sidecar build doesn't need GUI libs; Electron ships its own Chromium. The only Linux deps Electron+Chromedriver need on Ubuntu 24.04 are already in the GitHub runners' base image. |
| `WEBKIT_DISABLE_DMABUF_RENDERER: '1'` env on each WDIO step                                                                     | wry-specific workaround; Electron's Chromium has its own renderer path.                                                                                                                                                           |
| `Build Tauri debug binary with e2e-test feature` (lines 90-92)                                                                  | Tauri binary not used in PR-D2+. Replaced by Electron bundles + sidecar (in `test:e2e:build`).                                                                                                                                    |

### 6.2 Steps Added / Changed

| Step                                                                           | What                                                                                                                                             |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Update path triggers                                                           | Add `'electron/**'` and `'vite.config.ts'` so PR-D2-style changes re-trigger CI; otherwise renderer-only edits could regress E2E without firing. |
| `Build E2E artifacts` (replaces "Build frontend" + "Build Tauri debug binary") | Single step: `npm run test:e2e:build`. Inlines tsc + vite electron-mode build + sidecar build.                                                   |
| Diagnostics-upload paths                                                       | Change `src-tauri/target/debug/vimeflow` → `src-tauri/target/debug/vimeflow-backend`; add `dist-electron/`.                                      |

### 6.3 Steps Preserved

- `xvfb-run --auto-servernum` wrapper on each suite invocation — still required (Electron is GUI; CI runners are headless).
- `actions/cache` for cargo — unchanged.
- `actions/setup-node@v4` + `dtolnay/rust-toolchain@stable` — unchanged.
- `timeout-minutes: 30` — sufficient for the three-suite Electron run.

### 6.4 Full Replacement YAML

```yaml
name: E2E Tests

on:
  push:
    branches:
      - main
    paths:
      - 'src-tauri/**'
      - 'src/**'
      - 'electron/**'
      - 'tests/e2e/**'
      - 'package.json'
      - 'package-lock.json'
      - 'vite.config.ts'
      - '.github/workflows/e2e.yml'
  pull_request:
    branches:
      - main
    paths:
      - 'src-tauri/**'
      - 'src/**'
      - 'electron/**'
      - 'tests/e2e/**'
      - 'package.json'
      - 'package-lock.json'
      - 'vite.config.ts'
      - '.github/workflows/e2e.yml'

concurrency:
  group: e2e-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  e2e-linux:
    name: E2E smoke suite (Linux)
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js 24
        uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'

      - name: Setup Rust toolchain
        uses: dtolnay/rust-toolchain@stable

      - name: Cache Rust dependencies
        uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
          shared-key: e2e-test

      - name: Install system dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y xvfb

      - name: Install npm dependencies
        run: npm ci

      - name: Build E2E artifacts (renderer + Electron bundles + sidecar)
        run: npm run test:e2e:build

      - name: Run core E2E suite
        run: xvfb-run --auto-servernum npx wdio tests/e2e/core/wdio.conf.ts

      - name: Run terminal E2E suite
        run: xvfb-run --auto-servernum npx wdio tests/e2e/terminal/wdio.conf.ts

      - name: Run agent E2E suite
        run: xvfb-run --auto-servernum npx wdio tests/e2e/agent/wdio.conf.ts

      - name: Upload E2E diagnostics on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-diagnostics-${{ github.run_id }}
          path: |
            src-tauri/target/debug/vimeflow-backend
            dist/
            dist-electron/
          retention-days: 3
          if-no-files-found: ignore
```

### 6.5 Why `npm ci` Reaches `@wdio/electron-service` and `electron` Cleanly

`npm ci` installs from `package-lock.json`. PR-D2's `package.json` delta adds the service to `devDependencies` and `npm install` regenerates the lockfile. CI's `npm ci` then resolves both `electron@^42` (already in lockfile) and `@wdio/electron-service@^10` (newly added) from the lockfile snapshot. No additional cache config needed — `actions/setup-node@v4 with: cache: 'npm'` keys on `package-lock.json` and survives the lockfile bump.

### 6.6 chromedriver Provisioning

`@wdio/electron-service` downloads chromedriver on first use into `node_modules/.cache/chromium-bidi/...` (or similar; the path is service-internal). On a fresh CI runner this is ~30 s extra at the first suite run. The cached download persists across the three suite runs in the same job. Across separate CI invocations, the download repeats — adding a `chromedriver-cache` action key is a follow-up (out of scope; the 30 s is below the 30-min job budget).

## 7. Verification & Acceptance Gate

### 7.1 Pre-merge Local Smoke (Required)

A reviewer or implementer runs all of the following on a Linux dev host with a display:

```bash
# Static gates
npm run type-check
npm run lint
npm run format:check                       # warnings limited to src-tauri/bindings/
npx tsc --noEmit -p tests/e2e/tsconfig.json # type-check the 3 wdio configs + helper

# Vitest unit suite stays green
npm run test

# E2E build + the three suites
npm run test:e2e:build
npm run test:e2e
npm run test:e2e:terminal
npm run test:e2e:agent

# Or condensed
npm run test:e2e:all
```

Each suite must report `passing` for every spec. Specifically:

- **core** (4 specs): app-launch, files-to-editor, ipc-roundtrip, navigation
- **terminal** (6 specs): multi-tab-isolation, pane-lifecycle, pty-spawn, session-lifecycle, terminal-io, terminal-resize
- **agent** (1 spec): agent-detect-fake

### 7.2 Post-merge CI Gate

On main, the `e2e-linux` job in `.github/workflows/e2e.yml` must:

- Resolve all npm deps (`@wdio/electron-service@^10` reachable).
- Complete `npm run test:e2e:build` within the 30-min job budget.
- Pass all three suites under `xvfb-run`.
- Upload diagnostics on failure: `vimeflow-backend`, `dist/`, `dist-electron/`.

### 7.3 Manual Sanity Checks

- `npm run electron:dev` continues to launch sandboxed Electron pointing at Vite's dev server — confirms PR-D1's dev loop survives.
- `npm run tauri:dev` is allowed to break (PR-D3 deletes it). Reviewer may note this as expected.
- `rg -n "tauri-driver|TAURI_DRIVER_PORT" tests/ package.json .github/` returns zero hits.
- `rg -n "wdio:electronServiceOptions" tests/e2e/` returns three hits (one per wdio.conf.ts).

### 7.4 Out-of-Gate Verifications (deferred)

- macOS / Windows E2E parity. The current `e2e-linux` job is Linux-only; PR-D3 may add platform-matrix runs.
- Performance regression vs the Tauri/wry baseline. Subjectively the Electron path should be similar to faster (no separate webdriver process); not measured in PR-D2.
- chromedriver cache key — see §6.6. Out of scope; rebuild cost is small.

## 8. Risks & Rollback

### 8.1 Identified Risks

| Risk                                                                                                    | Likelihood                          | Impact                                        | Mitigation                                                                                                                         |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `@wdio/electron-service` chromedriver download fails in restricted CI (corporate proxy, network outage) | Low (GH-hosted runner has internet) | High (E2E job fails immediately)              | Document the `WDIO_CHROMEDRIVER_PATH` / service `chromedriverCustomPath` escape hatch in a follow-up README note if it ever bites. |
| Electron major-version bump silently breaks `@wdio/electron-service` chromedriver auto-match            | Low                                 | High                                          | Service is pinned via lockfile; bumping Electron is a deliberate action. Re-run `test:e2e:all` after any Electron-version PR.      |
| Pre-existing flaky agent spec (#71) re-surfaces under Electron                                          | Medium                              | Low (already gated by skip-guard in the spec) | No spec change in PR-D2; if flakiness regresses, the pre-existing skip-guard remains the recourse.                                 |
| `dist-electron/main.js` filename changes in a future vite-plugin-electron version                       | Low                                 | Medium (breaks `appEntryPoint` resolution)    | Helper points at the literal filename; bumping the plugin requires re-verifying the artifact name. Document in §4.1 comment.       |
| Codex/Claude review reads the misleading vite.config.ts comment as canonical (it currently does)        | Now (pre-PR-D2) → fixed             | Low (review noise, not correctness)           | Comment-fix is in PR-D2 scope (§4.4).                                                                                              |
| `xvfb-run` crash / pixel-format mismatch on CI runner image upgrade                                     | Low                                 | High (E2E job fails)                          | Outside PR-D2 — same risk as today's Tauri path. Add `--server-args=` tuning only if observed.                                     |

### 8.2 Rollback

If PR-D2 lands and the e2e-linux job is consistently red within 24 hours:

1. Revert the PR-D2 merge commit (`git revert <sha>`).
2. CI returns to the Tauri/wry path on the rolled-back state.
3. Open a follow-up issue documenting the failure mode (chromedriver / sandbox / config / unknown).

Rollback is mechanical because PR-D2 doesn't touch any Rust source, any spec file, or any renderer code — the diff is contained in 9 files (`electron-app.ts` new; 3 wdio configs rewritten; `tauri-driver.ts` deleted; `package.json`, `package-lock.json`, `vite.config.ts`, `tests/e2e/tsconfig.json`, `.github/workflows/e2e.yml` modified). Revert is a single revert commit.

### 8.3 Follow-ups Captured (Not Blocking Merge)

- Refactor: shared `wdio.base.conf.ts` to consolidate the three near-identical configs (Approach B from §2.3).
- CI: chromedriver cache key (~30 s saving per fresh runner).
- macOS / Windows runners in the E2E matrix.
- PR-D3: delete the entire `@tauri-apps/*` surface, Cargo Tauri dep, `tauri.conf.json`, `tauri:dev` / `tauri:build` scripts; add electron-builder packaging + signed binaries.
- Remove the `dist-electron/` mention from the vite-plugin-electron-renderer skip-list once we confirm we never want to enable it.

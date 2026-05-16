# PR-D2 — E2E driver swap to Electron Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap the WDIO E2E pipeline from Tauri/wry (`tauri-driver` + `browserName: 'wry'` + `tauri:options`) to Electron (`@wdio/electron-service` + `browserName: 'electron'` + `wdio:electronServiceOptions`) across the three suites (`core`, `terminal`, `agent`). All 11 existing E2E specs land unchanged; the underlying driver, build script, and CI workflow are rewritten to launch the Electron bundle from PR-D1 plus the unchanged Rust sidecar with the `e2e-test` Cargo feature.

**Architecture:** One new helper file (`tests/e2e/shared/electron-app.ts`) exposes `appEntryPoint` (the bundled main path) and `appArgs` (`--no-sandbox` + `--user-data-dir=<mkdtempSync>` for per-WDIO-session cache isolation). Three `wdio.conf.ts` files are rewritten to use the new capability shape. `tauri-driver.ts` is deleted. `test:e2e:build` rewrites to build the renderer + Electron bundles + sidecar instead of the Tauri binary. CI workflow drops `tauri-driver` install + `WEBKIT_DISABLE_DMABUF_RENDERER` env but keeps the GTK/webkit2gtk apt deps because the sidecar binary still link-pulls Tauri via the `vimeflow_lib` crate.

**Tech Stack:** Electron 42 (already pinned by PR-D1), `@wdio/electron-service@^10` (new devDep, scoped successor to `wdio-electron-service`), WDIO 9.27 (already installed), Mocha framework (unchanged), Rust sidecar binary `vimeflow-backend` (already supports the `e2e-test` feature).

**Spec:** `docs/superpowers/specs/2026-05-15-pr-d2-e2e-electron-driver-swap-design.md`

**Migration roadmap:** `docs/superpowers/plans/2026-05-13-electron-rust-backend-migration.md`. This plan implements PR-D2 (Task 9 of that roadmap). PR-D1 (#209) shipped the Electron shell + sidecar wiring; PR-D3 ships Tauri runtime removal + electron-builder packaging smoke.

---

## File Structure

### New (1 file)

- `tests/e2e/shared/electron-app.ts` — Two `path.resolve()` constants (`repoRoot`, `appEntryPoint`) and one `string[]` (`appArgs`) including `--no-sandbox` and a per-WDIO-session `--user-data-dir=<mkdtempSync>`. No process spawn — `@wdio/electron-service` owns the lifecycle.

### Modified (8 files)

- `package.json` — three deltas: add `"@wdio/electron-service": "^10"` to devDependencies; change `"main"` from `"dist-electron/main.mjs"` to `"dist-electron/main.js"`; rewrite the `"test:e2e:build"` script.
- `package-lock.json` — auto-updated by `npm install`. Committed alongside `package.json`.
- `vite.config.ts` — comment-only fix at lines 602-607. The current comment claims main emits as `dist-electron/main.mjs`; the actual emission is `main.js`. No behavior change.
- `tests/e2e/tsconfig.json` — add `"@wdio/electron-service"` to the `types` array; extend `include` to pick up `../../src/types/e2e.d.ts` so the `window.__VIMEFLOW_E2E__` global declaration is visible to specs.
- `tests/e2e/core/wdio.conf.ts` — full rewrite.
- `tests/e2e/terminal/wdio.conf.ts` — full rewrite. Same shape as core; differs in agent-detection comment, `waitforTimeout` (20s), and `mochaOpts.timeout` (60s).
- `tests/e2e/agent/wdio.conf.ts` — full rewrite. Same shape; differs in agent-detection env (`delete process.env.VIMEFLOW_DISABLE_AGENT_DETECTION` instead of `=1`) and longer timeouts (30s/90s).
- `.github/workflows/e2e.yml` — drop `tauri-driver` cache+install steps, drop `WEBKIT_DISABLE_DMABUF_RENDERER` env, drop Tauri-binary build; add `vite.config.ts` + `electron/**` to path triggers; replace the build step with `npm run test:e2e:build`; preserve GTK/webkit2gtk apt deps (see spec §6.1.1 — sidecar still link-pulls Tauri); add `dist-electron/` to diagnostics upload paths.

### Deleted (1 file)

- `tests/e2e/shared/tauri-driver.ts` — 89 lines including the port-wait loop and 4-path binary resolver. No remaining importers after Tasks 6-8.

### Files NOT touched

- `src/**`, `electron/**`, `src-tauri/**` Rust source — no functional changes in PR-D2.
- `src/lib/e2e-bridge.ts` — already migrated to `backend.invoke` during PR-C.
- `src/types/e2e.d.ts` — declaration body unchanged; only the tests tsconfig is updated to pick it up.
- `tests/e2e/*/specs/**` — all 11 spec files unchanged. They are DOM/bridge-only.
- `tests/e2e/shared/actions.ts`, `tests/e2e/shared/terminal.ts` — WebDriver action helpers, runtime-agnostic.

---

## Task 0: Baseline Verification

**Files:** none.

- [ ] **Step 1: Confirm working tree is clean and on a feature branch.**

```bash
cd /home/will/projects/vimeflow
git status
git branch --show-current
```

Expected: `nothing to commit, working tree clean`. Branch: `dev` or a feature branch like `feat/pr-d2-e2e-electron-swap` (create with `git checkout -b feat/pr-d2-e2e-electron-swap` if needed).

- [ ] **Step 2: Confirm static gates are green pre-PR-D2.**

```bash
npm run type-check
npm run lint
npm run format:check
npm run test
```

Expected: type-check + lint clean. `format:check` reports warnings only under `src-tauri/bindings/*` (pre-existing auto-generated files). `npm test` (vitest) green.

- [ ] **Step 3: Confirm the existing Tauri E2E baseline can build.**

```bash
(cd src-tauri && cargo build --bin vimeflow-backend --features e2e-test)
ls -la src-tauri/target/debug/vimeflow-backend
```

Expected: builds clean; binary present. PR-D2 will use the same sidecar binary; the only thing changing on the build side is which top-level artifact is consumed.

- [ ] **Step 4: Inventory the files PR-D2 will touch.**

```bash
ls tests/e2e/shared/
cat tests/e2e/core/wdio.conf.ts | head -5
grep -E '"main"|"test:e2e:build"' package.json
sed -n '602,607p' vite.config.ts
```

Expected: `tauri-driver.ts`, `actions.ts`, `terminal.ts` present in `shared/`; core wdio config imports from `'../shared/tauri-driver.js'`; `package.json:main = "dist-electron/main.mjs"`; vite comment says main emits as `.mjs`. All four "before" states confirm the changes are needed.

- [ ] **Step 5: Verify the build artifact reality (proves the spec's empirical claim).**

```bash
npx cross-env VITE_E2E=1 vite build --mode electron 2>&1 | grep -E "main\.|preload\."
ls dist-electron/
```

Expected: build log says `dist-electron/main.js` and `dist-electron/preload.mjs`. `ls` shows the same two files. Confirms the `package.json:main = .mjs` field is wrong.

- [ ] **Step 6: Clean the smoke build artifacts (they're gitignored but tidy).**

```bash
rm -rf dist dist-electron
git status -s
```

Expected: empty working tree.

---

## Task 1: Install `@wdio/electron-service`

**Files:**

- Modify: `package.json`
- Modify (auto): `package-lock.json`

- [ ] **Step 1: Verify the package exists and check the resolved version.**

```bash
npm view @wdio/electron-service version peerDependencies
```

Expected output:

```
version = '10.0.0'
peerDependencies = { electron: '*', webdriverio: '>9.0.0' }
```

Both peers (`electron@^42` and `webdriverio@^9.27`) are already installed.

- [ ] **Step 2: Install the package as a devDependency.**

```bash
npm install --save-dev @wdio/electron-service
```

Expected: `package.json` and `package-lock.json` both modified. No new warnings beyond standard "X moderate severity vulnerabilities" notice (pre-existing in the dep graph).

- [ ] **Step 3: Verify type-check still passes (sanity check after dep install).**

```bash
npm run type-check
```

Expected: green. The new dep changes nothing in the type-check scope until Task 5 wires it in.

- [ ] **Step 4: Inspect the package's type entry to confirm the augmentation path.**

```bash
head -3 node_modules/@wdio/electron-service/dist/esm/index.d.ts
```

Expected: first line is `import '@wdio/native-types';`. This side-effect import loads the `WebdriverIO.Capabilities` augmentation that adds `'wdio:electronServiceOptions'`.

- [ ] **Step 5: Commit.**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(deps): add @wdio/electron-service for PR-D2 E2E swap

Adds the WDIO service that replaces tauri-driver. The service
manages chromedriver, spawns Electron, and exposes browser-level
session control to WDIO. Peer deps (electron@^42, webdriverio@^9.27)
are already installed; package-lock.json carries the resolution.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Fix PR-D1 Leftover — `package.json:main` Field

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Confirm the mismatch.**

```bash
grep -n '"main"' package.json
```

Expected: line shows `"main": "dist-electron/main.mjs",`. The actual build artifact (verified in Task 0 Step 5) is `dist-electron/main.js`.

- [ ] **Step 2: Update the `main` field.**

Edit `package.json` — change the value of the `"main"` key from `"dist-electron/main.mjs"` to `"dist-electron/main.js"`. Final line should read:

```json
"main": "dist-electron/main.js",
```

- [ ] **Step 3: Verify there are no other references to the old path.**

```bash
rg -n 'dist-electron/main\.mjs' --glob '!node_modules/**' --glob '!docs/**' --glob '!.lifeline-planner/**'
```

Expected: zero hits. (The docs/spec files reference `.mjs` in historical context — those don't need changes.)

- [ ] **Step 4: Verify type-check + lint pass.**

```bash
npm run type-check
npm run lint
```

Expected: green.

- [ ] **Step 5: Commit (do NOT bundle with Task 3 yet; keep the two PR-D1 leftover fixes separate so git blame is clean).**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
fix(electron): correct package.json:main to dist-electron/main.js

PR-D1 set package.json:main to dist-electron/main.mjs, but
vite-plugin-electron's underlying lib config (formats: ['es'] +
fileName: () => '[name].js' at
node_modules/vite-plugin-electron/dist/index.mjs:17) emits
dist-electron/main.js, not .mjs. The .mjs extension is reserved
for preload (separate plugin override).

Empirically verified by running `vite build --mode electron` on
HEAD: dist-electron/main.js (10.54 KB) is produced.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Fix PR-D1 Leftover — `vite.config.ts` Comment Block

**Files:**

- Modify: `vite.config.ts`

- [ ] **Step 1: Read the current comment block to confirm its content.**

```bash
sed -n '602,611p' vite.config.ts
```

Expected: lines 602-611 contain the comment block claiming "the plugin emits main as ESM at dist-electron/main.mjs". This is wrong.

- [ ] **Step 2: Replace the comment block with the corrected version.**

Use the `Edit` tool on `vite.config.ts`. Find:

```ts
// Use vite-plugin-electron/simple's defaults. With root
// package.json:type=module, the plugin emits:
//   - main as ESM at dist-electron/main.mjs
//   - preload as CJS-content with .mjs extension at
//     dist-electron/preload.mjs (Electron's preload loader
//     handles this special case)
// Custom build/lib/rollupOptions configs fight the
// plugin's defaults because mergeConfig concatenates arrays
// like `lib.formats`, producing dual ESM+CJS builds that
// overwrite each other.
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
// Custom build/lib/rollupOptions configs fight the
// plugin's defaults because mergeConfig concatenates arrays
// like `lib.formats`, producing dual ESM+CJS builds that
// overwrite each other.
```

- [ ] **Step 3: Verify type-check, lint, and format pass.**

```bash
npm run type-check
npm run lint
npx prettier --check vite.config.ts
```

Expected: all green.

- [ ] **Step 4: Confirm `npm run electron:dev`'s startup path is unaffected.**

```bash
sed -n '614,640p' vite.config.ts
```

Expected: the `onstart` block and the `vite: { build: { outDir: 'dist-electron' } }` config are unchanged. Comment-only fix.

- [ ] **Step 5: Commit.**

```bash
git add vite.config.ts
git commit -m "$(cat <<'EOF'
docs(vite): correct misleading comment about main bundle filename

The vite.config.ts inline comment at lines 602-611 claimed the
plugin emits main as ESM at dist-electron/main.mjs. The actual
emission is dist-electron/main.js (vite-plugin-electron's lib
config hard-codes fileName: () => '[name].js'; the .mjs extension
is reserved for preload via a separate plugin override).

Comment-only fix; no behavior change. Same commit cadence as
Task 2 (package.json:main fix) but split because the two files
touch different concerns.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Create `tests/e2e/shared/electron-app.ts`

**Files:**

- Create: `tests/e2e/shared/electron-app.ts`

- [ ] **Step 1: Create the file with the full body.**

Write `tests/e2e/shared/electron-app.ts`:

```ts
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

// Per-WDIO-session app-data dir. Electron's --user-data-dir CLI flag
// reroutes app.getPath('userData'); the sidecar inherits the rerouted
// path via spawnSidecar({ appDataDir: app.getPath('userData') }) in
// electron/main.ts. Without this isolation, the e2e-test Cargo
// feature's cache-wipe doesn't fire on the sidecar code path (it only
// runs inside Tauri's lib.rs setup() block, which Electron skips), so
// sessions.json would leak between WDIO workers and break the
// terminal specs that assume a fresh default session. See spec §5.7.
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
  `--user-data-dir=${sessionUserDataDir}`,
]
```

- [ ] **Step 2: Verify the file formats clean.**

```bash
npx prettier --check tests/e2e/shared/electron-app.ts
```

Expected: clean. If it fails, run `npx prettier --write tests/e2e/shared/electron-app.ts`. ESLint is not invoked because `eslint.config.js` line 40 ignores `tests/e2e/**` (the suite has its own tsconfig + WDIO globals); the type-check in Task 14 covers the parts ESLint would catch.

- [ ] **Step 3: Smoke-test the module can import.**

```bash
npx tsx -e "import('./tests/e2e/shared/electron-app.ts').then(m => console.log(m.appEntryPoint, m.appArgs))"
```

Expected output: a line like `/home/will/projects/vimeflow/dist-electron/main.js [ '--no-sandbox', '--user-data-dir=/tmp/vimeflow-e2e-XXXXXX' ]`. The temp dir is created as a side effect of import — fine.

- [ ] **Step 4: Commit.**

```bash
git add tests/e2e/shared/electron-app.ts
git commit -m "$(cat <<'EOF'
feat(e2e): add electron-app helper for WDIO Electron service

Exposes appEntryPoint (the bundled dist-electron/main.js path) and
appArgs (--no-sandbox + --user-data-dir=<mkdtempSync>) for the
three wdio.conf.ts rewrites in Tasks 6-8. Replaces the deleted
tauri-driver.ts.

--user-data-dir isolates each WDIO worker's app-data so the
e2e-test Cargo feature's cache-wipe (which doesn't fire on the
Electron sidecar code path — see spec §5.7) doesn't cause
sessions.json leakage between specs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Update `tests/e2e/tsconfig.json`

**Files:**

- Modify: `tests/e2e/tsconfig.json`

- [ ] **Step 1: Read the current file.**

```bash
cat tests/e2e/tsconfig.json
```

Expected: the file has `"types": ["node", "mocha", "@wdio/globals/types", "expect-webdriverio"]` and `"include": ["**/*.ts"]`.

- [ ] **Step 2: Replace the file with the updated version.**

Write `tests/e2e/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": [
      "node",
      "mocha",
      "@wdio/globals/types",
      "expect-webdriverio",
      "@wdio/electron-service"
    ]
  },
  "include": ["**/*.ts", "../../src/types/e2e.d.ts"]
}
```

Two changes:

1. `"types"` array gains `"@wdio/electron-service"` — loads the `WebdriverIO.Capabilities` augmentation for `'wdio:electronServiceOptions'`.
2. `"include"` array gains `"../../src/types/e2e.d.ts"` — picks up the `window.__VIMEFLOW_E2E__` global declaration so spec files type-check.

- [ ] **Step 3: Verify the tsconfig-level type-check passes on the new wdio configs (after Tasks 6-8 land).**

This step is informational — the actual smoke happens at Task 14. After this task alone, the type-check would still fail on the unmodified wdio.conf.ts files (which still reference `tauri:options`). That's expected.

- [ ] **Step 4: Verify the project-level type-check still passes.**

```bash
npm run type-check
```

Expected: green. The root `tsc -b` and the electron tsconfig don't include `tests/e2e/`, so this change is invisible to them.

- [ ] **Step 5: Commit.**

```bash
git add tests/e2e/tsconfig.json
git commit -m "$(cat <<'EOF'
chore(e2e): wire @wdio/electron-service types + e2e.d.ts into E2E tsconfig

Adds @wdio/electron-service to the types array so the
'wdio:electronServiceOptions' capability key type-checks. Adds
../../src/types/e2e.d.ts to include so window.__VIMEFLOW_E2E__
is visible to specs (required for the §7.1 type-check smoke
gate after the wdio.conf.ts rewrites in Tasks 6-8).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Rewrite `tests/e2e/core/wdio.conf.ts`

**Files:**

- Modify: `tests/e2e/core/wdio.conf.ts`

- [ ] **Step 1: Replace the file with the new contents.**

Write `tests/e2e/core/wdio.conf.ts`:

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
    // Renderer was built with VITE_E2E=1 (see `test:e2e:build`); the
    // Electron main process gates E2E-only backend methods
    // (list_active_pty_sessions) on the same runtime env, so propagate
    // it before the service spawns Electron. Child-process inheritance
    // carries the value into main.ts.
    process.env.VITE_E2E = '1'
    // See #71: on a dev box with real Claude Code processes running, the
    // host-global agent detector can latch onto them and crash the
    // webview during startup. Disable for this suite which doesn't
    // exercise the detector.
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

- [ ] **Step 2: Verify the file formats clean.**

```bash
npx prettier --check tests/e2e/core/wdio.conf.ts
```

Expected: clean. If it fails, run `npx prettier --write tests/e2e/core/wdio.conf.ts`. ESLint not invoked (see Task 4 Step 2 for rationale).

- [ ] **Step 3: Verify the tests/e2e tsconfig has no errors for this file.**

```bash
output=$(npx tsc --noEmit -p tests/e2e/tsconfig.json 2>&1)
if echo "$output" | grep -q "core/wdio.conf"; then
  echo "FAIL: type errors in core/wdio.conf.ts:"
  echo "$output" | grep "core/wdio.conf"
else
  echo "PASS: core/wdio.conf.ts type-checks (errors in other suite configs may still exist until Tasks 7-8 land)"
fi
```

Expected: `PASS: core/wdio.conf.ts type-checks ...` line. The standalone `tsc` exit code will likely be non-zero because the other two suite configs still reference `tauri:options`; the wrapping `if/else` isolates the per-file check.

- [ ] **Step 4: Commit.**

```bash
git add tests/e2e/core/wdio.conf.ts
git commit -m "$(cat <<'EOF'
feat(e2e): swap core suite wdio.conf.ts to @wdio/electron-service

Replaces browserName:'wry' + tauri:options + tauri-driver lifecycle
with browserName:'electron' + wdio:electronServiceOptions +
services:['electron']. onPrepare now sets VITE_E2E=1 (so Electron
main unlocks list_active_pty_sessions) and keeps the existing
VIMEFLOW_DISABLE_AGENT_DETECTION toggle for #71.

Removed: hostname/port (service-managed), wdio:enforceWebDriverClassic
(no protocol coercion needed; chromedriver speaks classic
WebDriver), WEBKIT_DISABLE_DMABUF_RENDERER env (wry-specific).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Rewrite `tests/e2e/terminal/wdio.conf.ts`

**Files:**

- Modify: `tests/e2e/terminal/wdio.conf.ts`

- [ ] **Step 1: Replace the file with the new contents.**

Write `tests/e2e/terminal/wdio.conf.ts`:

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
    process.env.VITE_E2E = '1'
    // See tests/e2e/core/wdio.conf.ts onPrepare for the rationale —
    // skip agent detection in this suite so real claude processes on
    // the dev host don't destabilise unrelated terminal specs. See #71.
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

  waitforTimeout: 20_000,
  mochaOpts: { ui: 'bdd', timeout: 60_000 },
}
```

The differences vs core: shorter onPrepare comment (cross-references core), `waitforTimeout: 20_000` (vs 10), `mochaOpts.timeout: 60_000` (vs 30). Match the pre-PR-D2 file's per-suite tuning.

- [ ] **Step 2: Verify the file formats clean.**

```bash
npx prettier --check tests/e2e/terminal/wdio.conf.ts
```

Expected: clean. If it fails, run `npx prettier --write tests/e2e/terminal/wdio.conf.ts`. ESLint not invoked (see Task 4 Step 2 for rationale).

- [ ] **Step 3: Verify the tests/e2e tsconfig has no errors for this file.**

```bash
output=$(npx tsc --noEmit -p tests/e2e/tsconfig.json 2>&1)
if echo "$output" | grep -q "terminal/wdio.conf"; then
  echo "FAIL: type errors in terminal/wdio.conf.ts:"
  echo "$output" | grep "terminal/wdio.conf"
else
  echo "PASS: terminal/wdio.conf.ts type-checks (errors in agent/wdio.conf.ts may still exist until Task 8 lands)"
fi
```

Expected: `PASS: terminal/wdio.conf.ts type-checks ...` line.

- [ ] **Step 4: Commit.**

```bash
git add tests/e2e/terminal/wdio.conf.ts
git commit -m "$(cat <<'EOF'
feat(e2e): swap terminal suite wdio.conf.ts to @wdio/electron-service

Same shape as core/wdio.conf.ts. Suite-specific timeouts preserved:
waitforTimeout=20s, mocha=60s.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Rewrite `tests/e2e/agent/wdio.conf.ts`

**Files:**

- Modify: `tests/e2e/agent/wdio.conf.ts`

- [ ] **Step 1: Replace the file with the new contents.**

Write `tests/e2e/agent/wdio.conf.ts`:

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
    process.env.VITE_E2E = '1'
    // Agent suite wants detection enabled — explicitly clear the env
    // var in case it leaks in from the shell or a prior WDIO run. The
    // spec itself has a skip-guard for pre-existing host claude
    // processes (see agent-detect-fake.spec.ts and #71).
    delete process.env.VIMEFLOW_DISABLE_AGENT_DETECTION
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

  // Agent detection polls every ~2s; give it room.
  waitforTimeout: 30_000,
  mochaOpts: { ui: 'bdd', timeout: 90_000 },
}
```

Differences vs core: `delete process.env.VIMEFLOW_DISABLE_AGENT_DETECTION` instead of `= '1'`; `waitforTimeout: 30_000` and `mochaOpts.timeout: 90_000`.

- [ ] **Step 2: Verify the file formats clean.**

```bash
npx prettier --check tests/e2e/agent/wdio.conf.ts
```

Expected: clean. If it fails, run `npx prettier --write tests/e2e/agent/wdio.conf.ts`. ESLint not invoked (see Task 4 Step 2 for rationale).

- [ ] **Step 3: Verify the tests/e2e tsconfig has no errors for this file.**

```bash
output=$(npx tsc --noEmit -p tests/e2e/tsconfig.json 2>&1)
if echo "$output" | grep -q "agent/wdio.conf"; then
  echo "FAIL: type errors in agent/wdio.conf.ts:"
  echo "$output" | grep "agent/wdio.conf"
else
  echo "PASS: agent/wdio.conf.ts type-checks. After Tasks 6-8 all land, full `tsc -p tests/e2e/tsconfig.json` should be clean — Task 14 Step 1 verifies."
fi
```

Expected: `PASS: agent/wdio.conf.ts type-checks ...` line.

- [ ] **Step 4: Commit.**

```bash
git add tests/e2e/agent/wdio.conf.ts
git commit -m "$(cat <<'EOF'
feat(e2e): swap agent suite wdio.conf.ts to @wdio/electron-service

Same shape as core/wdio.conf.ts. Differs: clears
VIMEFLOW_DISABLE_AGENT_DETECTION (this suite needs detection on);
longer timeouts for the ~2s detection poll cadence (waitforTimeout=30s,
mocha=90s).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Delete `tests/e2e/shared/tauri-driver.ts`

**Files:**

- Delete: `tests/e2e/shared/tauri-driver.ts`

- [ ] **Step 1: Confirm no remaining importers.**

```bash
rg -n "from '../shared/tauri-driver" tests/
rg -n "from '../../shared/tauri-driver" tests/
rg -n "tauri-driver" src/ tests/ --glob '!*.md'
```

Expected: zero hits. (The deleted file's exports — `appBinary`, `startTauriDriver`, `stopTauriDriver`, `TAURI_DRIVER_PORT`, `repoRoot` — are all dead. `repoRoot` is republished from `electron-app.ts`.)

- [ ] **Step 2: Delete the file.**

```bash
rm tests/e2e/shared/tauri-driver.ts
```

- [ ] **Step 3: Confirm shared dir contents.**

```bash
ls tests/e2e/shared/
```

Expected output:

```
actions.ts
electron-app.ts
terminal.ts
```

- [ ] **Step 4: Verify lint + type-check pass.**

```bash
npm run lint
npm run type-check
npx tsc --noEmit -p tests/e2e/tsconfig.json
```

Expected: all green.

- [ ] **Step 5: Commit.**

```bash
git add -A tests/e2e/shared/
git commit -m "$(cat <<'EOF'
chore(e2e): delete tauri-driver.ts (no remaining importers)

After Tasks 6-8 rewrote the three wdio.conf.ts files to import from
electron-app.ts, every export of tauri-driver.ts is dead (appBinary,
startTauriDriver, stopTauriDriver, TAURI_DRIVER_PORT, repoRoot —
repoRoot is republished from electron-app.ts). 89 lines removed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Rewrite `test:e2e:build` npm script

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Read the current script value.**

```bash
grep -n '"test:e2e:build"' package.json
```

Expected: line shows the Tauri-binary build script:

```
"test:e2e:build": "cross-env VITE_E2E=1 npm run build && cd src-tauri && cargo build --features e2e-test,tauri/custom-protocol",
```

- [ ] **Step 2: Update the script.**

Use the `Edit` tool on `package.json`. Find the old line above and replace with:

```
"test:e2e:build": "tsc -b && cross-env VITE_E2E=1 vite build --mode electron && cd src-tauri && cargo build --bin vimeflow-backend --features e2e-test",
```

Changes:

1. `npm run build` → `tsc -b && cross-env VITE_E2E=1 vite build --mode electron`. Inlines tsc so VITE_E2E=1 reaches the renderer compile; adds `--mode electron` so `vite-plugin-electron` emits dist-electron bundles.
2. `cargo build --features e2e-test,tauri/custom-protocol` → `cargo build --bin vimeflow-backend --features e2e-test`. Drops the Tauri custom-protocol feature (not needed for the Electron sidecar path); restricts the build to just the sidecar binary.

- [ ] **Step 3: Run the build to verify it produces the right artifacts.**

```bash
npm run test:e2e:build
```

Expected: completes without error. After ~30-60s on first run:

- `dist/index.html` + `dist/assets/*` (renderer)
- `dist-electron/main.js` (~10 KB)
- `dist-electron/preload.mjs` (~0.4 KB)
- `src-tauri/target/debug/vimeflow-backend` (sidecar)

Verify:

```bash
ls dist/index.html dist-electron/main.js dist-electron/preload.mjs src-tauri/target/debug/vimeflow-backend
```

All four paths should exist.

- [ ] **Step 4: Commit.**

```bash
git add package.json
git commit -m "$(cat <<'EOF'
feat(e2e): rewrite test:e2e:build for Electron pipeline

Builds renderer (with VITE_E2E=1) + Electron main/preload bundles
(via vite --mode electron) + sidecar binary (--bin vimeflow-backend
--features e2e-test) instead of the Tauri app binary.

Drops the tauri/custom-protocol feature flag (irrelevant for the
Electron sidecar path) and scopes cargo build to just the sidecar
binary to avoid pulling in the soon-to-be-deleted Tauri main entry.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Update `.github/workflows/e2e.yml`

**Files:**

- Modify: `.github/workflows/e2e.yml`

- [ ] **Step 1: Replace the workflow file with the new version.**

Write `.github/workflows/e2e.yml`:

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

# Cancel in-flight runs for the same ref — E2E is expensive enough that
# superseding reruns is the right default.
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
          # Key the cargo cache against the e2e-test feature so the shared
          # cache with `tauri-build` (which doesn't enable e2e-test) doesn't
          # mask recompiles triggered by this job.
          shared-key: e2e-test

      - name: Install system dependencies
        # libwebkit2gtk / libgtk / libappindicator / librsvg / patchelf are
        # still required at link time because the sidecar binary
        # (cargo build --bin vimeflow-backend) compiles against the
        # vimeflow_lib crate, which still pulls in the Tauri dependency
        # graph (tauri → wry → webkit2gtk-rs). PR-D3 removes the Tauri
        # dep itself, after which these system packages can be dropped
        # too. xvfb is required by xvfb-run for headless Electron runs.
        run: |
          sudo apt-get update
          sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            libgtk-3-dev \
            libappindicator3-dev \
            librsvg2-dev \
            patchelf \
            xvfb

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

Removed vs the old workflow: `Cache tauri-driver` + `Install tauri-driver` steps, `webkit2gtk-driver` apt dep, `WEBKIT_DISABLE_DMABUF_RENDERER` env on each WDIO step, separate "Build frontend" and "Build Tauri debug binary" steps (consolidated into `npm run test:e2e:build`). Diagnostics path `src-tauri/target/debug/vimeflow` (Tauri binary) → `src-tauri/target/debug/vimeflow-backend` (sidecar); `dist-electron/` added.

Preserved: GTK/webkit2gtk/appindicator/librsvg/patchelf apt deps (required for sidecar link; PR-D3 cleans these up); xvfb dep; rust-cache shared-key; concurrency group; cancel-in-progress.

- [ ] **Step 2: Validate the YAML.**

```bash
npx js-yaml .github/workflows/e2e.yml > /dev/null && echo "YAML valid"
```

Expected output: `YAML valid`. If `js-yaml` isn't a local devDep, use `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/e2e.yml'))" && echo YAML valid` instead.

- [ ] **Step 3: Format check.**

```bash
npx prettier --check .github/workflows/e2e.yml
```

Expected: clean. If not, `npx prettier --write .github/workflows/e2e.yml`.

- [ ] **Step 4: Commit.**

```bash
git add .github/workflows/e2e.yml
git commit -m "$(cat <<'EOF'
ci(e2e): swap workflow to Electron pipeline

Drops the tauri-driver install + cache steps, the
WEBKIT_DISABLE_DMABUF_RENDERER env, the webkit2gtk-driver apt dep,
and the separate Tauri-binary build step. Adds vite.config.ts +
electron/** to the path triggers. Replaces the two-step
build-frontend + build-Tauri-binary with a single
`npm run test:e2e:build`. Diagnostics paths updated to point at
vimeflow-backend (sidecar) and dist-electron/.

Preserves the GTK/webkit2gtk/appindicator/librsvg/patchelf apt
deps because the sidecar binary still link-pulls the Tauri
dependency graph via vimeflow_lib. PR-D3 removes the Tauri dep
itself, after which these can also be dropped.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Smoke-Run `test:e2e:build` End-to-End

**Files:** none (verification only).

- [ ] **Step 1: Clean any stale build artifacts first.**

```bash
rm -rf dist dist-electron
ls dist dist-electron 2>&1
```

Expected: `cannot access` errors for both.

- [ ] **Step 2: Run the full build.**

```bash
npm run test:e2e:build
```

Expected: completes in 30-90s (longer on cold cache). Output ends with:

```
   Compiling vimeflow v0.1.0 (...)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in ...
```

- [ ] **Step 3: Verify all four artifacts exist.**

```bash
ls -la dist/index.html dist-electron/main.js dist-electron/preload.mjs src-tauri/target/debug/vimeflow-backend
```

All four paths should be regular files.

- [ ] **Step 4: Confirm `VITE_E2E=1` baked into the renderer.**

```bash
grep -c "VIMEFLOW_E2E" dist/assets/index-*.js
```

Expected: non-zero. The bridge attachment (`if (import.meta.env.VITE_E2E)`) is in the bundle.

- [ ] **Step 5: Confirm `dist-electron/main.js` contains the Electron entry.**

```bash
grep -E "spawnSidecar|BACKEND_INVOKE" dist-electron/main.js | head -3
```

Expected: at least one hit per pattern.

No commit for this task — verification only.

---

## Task 13: Smoke-Run Each E2E Suite Locally

**Files:** none (verification only).

This task runs the three suites on a local Linux dev host with a display. CI parity is validated by Task 11's workflow change but only fires after merge.

- [ ] **Step 1: Run the core suite.**

```bash
npm run test:e2e
```

Expected: all 4 specs pass (app-launch, files-to-editor, ipc-roundtrip, navigation). First run may take ~30 s extra while `@wdio/electron-service` downloads chromedriver.

- [ ] **Step 2: Run the terminal suite.**

```bash
npm run test:e2e:terminal
```

Expected: all 6 specs pass (multi-tab-isolation, pane-lifecycle, pty-spawn, session-lifecycle, terminal-io, terminal-resize).

- [ ] **Step 3: Run the agent suite.**

```bash
npm run test:e2e:agent
```

Expected: the 1 spec (agent-detect-fake) passes. The spec has its own skip-guard for pre-existing host claude processes; if a real `claude` process is running, the spec auto-skips with a logged note rather than failing.

- [ ] **Step 4 (optional): Run all three at once.**

```bash
npm run test:e2e:all
```

Expected: same outcome as Steps 1-3 chained. Takes the longest.

No commit for this task — verification only. If a suite fails, debug before proceeding to Task 14.

---

## Task 14: Final Verification Gate

**Files:** none (verification only).

Run the full pre-PR gate per spec §7.

- [ ] **Step 1: Static gates.**

```bash
npm run format:check
npm run lint
npm run type-check
npx tsc --noEmit -p tests/e2e/tsconfig.json
```

Expected: lint + type-check + e2e tsconfig all clean. `format:check` warnings limited to the pre-existing `src-tauri/bindings/` set (auto-generated).

- [ ] **Step 2: Unit test suite.**

```bash
npm run test
```

Expected: vitest green.

- [ ] **Step 3: Rust tests (smoke; Rust unchanged in PR-D2).**

```bash
(cd src-tauri && cargo test)
```

Expected: green. Count should match pre-PR-D2 baseline byte-for-byte (no source changes).

- [ ] **Step 4: E2E build + all three suites.**

```bash
npm run test:e2e:build
npm run test:e2e
npm run test:e2e:terminal
npm run test:e2e:agent
```

Expected: each suite reports `passing` on every spec.

- [ ] **Step 5: Coupling inventory — confirm tauri-driver references are gone.**

```bash
rg -n "tauri-driver|TAURI_DRIVER_PORT" tests/ package.json .github/ \
  --glob '!docs/**'
```

Expected: zero hits. (Documentation under `docs/` may still mention `tauri-driver` in historical context.)

- [ ] **Step 6: Confirm the new capability shape is present in all three configs.**

```bash
rg -n "wdio:electronServiceOptions" tests/e2e/
```

Expected: 3 hits (one per `wdio.conf.ts`).

- [ ] **Step 7: Confirm `npm run electron:dev` still launches (manual sanity).**

Open a separate terminal in the project root and run:

```bash
npm run electron:dev
```

Expected: Vite dev server logs appear, then an Electron window opens at 1400×900 with title "Vimeflow" within ~5s. The renderer + sidecar should both be functional (default terminal pane spawns; `pwd` echoes).

Quit Electron via the OS's normal quit shortcut (Cmd/Ctrl+Q, or close the window on non-macOS). The Vite server should exit cleanly when the Electron process detaches; if it doesn't, Ctrl+C in the terminal stops it.

If running headless / on a CI agent without a display, skip this step and explicitly note it in the PR description — the CI workflow change in Task 11 covers the headless smoke.

This step is intentionally manual: a scripted smoke that does `timeout N npm run electron:dev | head` + a `pkill` cleanup would (1) swallow real launch failures via the pipe-to-head pattern, and (2) the `pkill` pattern can match unrelated Electron processes the operator is running on the same machine. Manual quit is safer.

- [ ] **Step 8: Confirm `package.json:main` and the new test:e2e:build match the spec.**

```bash
grep -E '"main"|"test:e2e:build"' package.json
```

Expected:

```
"main": "dist-electron/main.js",
"test:e2e:build": "tsc -b && cross-env VITE_E2E=1 vite build --mode electron && cd src-tauri && cargo build --bin vimeflow-backend --features e2e-test",
```

No commit for this task — verification only. If everything passes, the PR is ready.

---

## PR Description Checklist

When opening the PR, the description must:

- [ ] State "PR-D2 swaps the WDIO E2E pipeline from Tauri/wry (`tauri-driver` + `browserName: 'wry'` + `tauri:options`) to Electron (`@wdio/electron-service` + `browserName: 'electron'` + `wdio:electronServiceOptions`)."
- [ ] List the new files (`tests/e2e/shared/electron-app.ts`).
- [ ] List the modified files (`package.json`, `package-lock.json`, `vite.config.ts`, `tests/e2e/tsconfig.json`, `tests/e2e/{core,terminal,agent}/wdio.conf.ts`, `.github/workflows/e2e.yml`).
- [ ] List the deleted files (`tests/e2e/shared/tauri-driver.ts`).
- [ ] State explicitly: "Tauri runtime remains through end of PR-D2; PR-D3 removes it (Cargo deps, `tauri.conf.json`, `tauri:dev` / `tauri:build` scripts)."
- [ ] Call out the PR-D1 leftover fixes that landed here:
  - `package.json:main` corrected from `dist-electron/main.mjs` to `dist-electron/main.js`.
  - `vite.config.ts:602-611` comment block rewritten to describe the actual emission.
- [ ] Note the `--user-data-dir=<mkdtempSync>` isolation strategy and why it's needed (spec §5.7 — the `e2e-test` Cargo feature's cache-wipe doesn't fire on the sidecar code path).
- [ ] Note the deliberate preservation of `libwebkit2gtk-4.1-dev` and other GTK apt deps in CI (spec §6.1.1 — sidecar still link-pulls Tauri via the `vimeflow_lib` crate).
- [ ] Include the verification gate output (paste the Task 14 step results so reviewers can spot-check).
- [ ] Call out high-risk areas:
  - chromedriver download timing on a fresh CI runner (~30s)
  - Electron `--no-sandbox` on Linux
  - The PTY-orphan limitation from PR-D1 still applies (out of scope; PR-D3 packaging).
- [ ] List deferred follow-ups:
  - Shared `wdio.base.conf.ts` to consolidate the three near-identical configs (Approach B from spec §2.3).
  - chromedriver cache action key (~30s saving per fresh runner).
  - macOS/Windows runners in the E2E matrix.
  - PR-D3: full Tauri runtime removal + electron-builder packaging.

---

## Risk Notes (cross-reference)

See spec §8 for the full risk breakdown. Plan-time TL;DR:

- **Sidecar still link-pulls Tauri** — the `cargo build --bin vimeflow-backend --features e2e-test` step in Task 10/11 needs the GTK/webkit2gtk apt deps until PR-D3 removes the `tauri` Cargo dep. The CI workflow update in Task 11 preserves them deliberately.
- **`--user-data-dir` isolation is load-bearing** — Task 4's `electron-app.ts` computes a fresh `mkdtempSync` per WDIO worker. Without this, the `e2e-test` Cargo feature's cache wipe doesn't fire (it only runs from Tauri's `lib.rs` setup block, which the sidecar skips) and stale `sessions.json` leaks between WDIO sessions.
- **chromedriver download** — first CI run pays ~30s. Within job-budget. Cross-job cache is a follow-up.
- **`@wdio/electron-service` is the scoped successor** to the older unscoped `wdio-electron-service` package; both exist on npm. Older docs reference the unscoped name; the scoped v10 is what PR-D2 uses.

---

## Self-Review Notes

Run-through against the spec's §1.1 In-Scope list:

| Spec bullet                                   | Plan task                                    |
| --------------------------------------------- | -------------------------------------------- |
| Add `@wdio/electron-service` as a devDep      | Task 1                                       |
| Create `tests/e2e/shared/electron-app.ts`     | Task 4                                       |
| Rewrite 3 wdio.conf.ts files                  | Tasks 6, 7, 8                                |
| Update `tests/e2e/tsconfig.json:types`        | Task 5                                       |
| Rewrite `test:e2e:build`                      | Task 10                                      |
| Propagate `VITE_E2E=1` to Electron at runtime | Tasks 6/7/8 (onPrepare in each wdio.conf.ts) |
| Update `.github/workflows/e2e.yml`            | Task 11                                      |
| Fix `package.json:main` to `.js`              | Task 2                                       |
| Fix vite.config.ts comment                    | Task 3                                       |

Run-through against the spec's §3 file structure: every file in New (1) / Modified (8) / Deleted (1) maps to a task. The `tests/e2e/tsconfig.json:include` extension for `e2e.d.ts` is captured in Task 5.

<!-- codex-reviewed: 2026-05-15T15:46:38Z -->

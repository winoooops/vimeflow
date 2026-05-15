# PR-C — Frontend backend bridge (renderer migration)

## 1. Overview

**Goal.** Decouple the React renderer from `@tauri-apps/api` by introducing
`src/lib/backend.ts` as the runtime-neutral IPC seam. Migrate 7 renderer
files (3 services, 3 hooks, 1 e2e-bridge module — enumerated in §3) off
direct Tauri imports onto the bridge. Tauri host stays the live runtime
through the whole PR — the bridge falls back to `@tauri-apps/api` when
`window.vimeflow` isn't set (the PR-C steady state). PR-D ships the
Electron preload that sets `window.vimeflow` and drops the fallback.

**Non-goals.**

- No Electron shell. No sidecar spawning. No `window.vimeflow` producer.
- No Rust changes (PR-A locked the runtime-neutral surface; PR-B locked
  the sidecar + IPC wire shape).
- No class / file renames (`TauriTerminalService`, `TauriGitService`,
  `TauriFileSystemService` and the matching `tauriXxxService.ts`
  filenames keep their identity through PR-C — they're renamed to
  `DesktopXxx` in PR-D when `@tauri-apps/*` actually leaves the tree).
  The `isTauri` → `isDesktop` environment-helper API rename IS in scope
  because the helper's semantics genuinely change (see §2.4 and §3.2).
- No E2E driver swap (`tests/e2e/shared/tauri-driver.ts` stays; PR-D
  moves the harness to Electron).
- No `package.json` dep removal — `@tauri-apps/api` stays through PR-C
  because the bridge's fallback branch still imports it.
- No `src-tauri/**`, no `tests/e2e/**`, no `src/bindings/**` touches.

**Roadmap context.** Implements a strict subset of Task 2 + Task 8 + the
`e2e-bridge` slice of Task 9 from
`docs/superpowers/plans/2026-05-13-electron-rust-backend-migration.md`.

The subset cuts:

- Task 2 — only the renderer-side `BackendApi` surface lands; the
  `window.vimeflow` producer is deferred to PR-D's Electron preload.
- Task 8 — only the import-path migration lands. `TauriXxx` → `DesktopXxx`
  class/file renames and `@tauri-apps/*` dep removal are deferred to PR-D.
- Task 9 — only `src/lib/e2e-bridge.ts` migrates onto the bridge. The
  `tauri-driver` → Electron launcher swap stays in PR-D.

The bridge's renderer-side surface is designed to satisfy §5.1 (IPC wire
envelope) of
`docs/superpowers/specs/2026-05-13-pr-b-rust-sidecar-ipc-design.md` so
that PR-D's `window.vimeflow` producer (Electron preload + `ipcMain`
dispatch to the Rust sidecar) plugs in without further renderer churn.
PR-C itself does NOT exercise §5.1 — the Tauri fallback path bypasses
the wire envelope entirely.

## 2. Cross-PR contract

### 2.1 `BackendApi` shape (the seam)

`src/lib/backend.ts` exports module-level `invoke` and `listen` functions
and the `BackendApi` interface they implement:

```ts
export type UnlistenFn = () => void

export interface BackendApi {
  invoke: <T>(method: string, args?: Record<string, unknown>) => Promise<T>

  listen: <T>(
    event: string,
    callback: (payload: T) => void
  ) => Promise<UnlistenFn>
}
```

Contract details:

- `invoke<T>(method, args?)` returns `Promise<T>`. The `T` parameter is
  the deserialized `result` field of the response frame (PR-B §5.1.2).
  The `args` parameter is optional at the renderer-facing surface
  (`args?: Record<string, unknown>`) because many command call sites
  pass no payload (`invoke('list_sessions')`). The bridge MUST pass
  `args` through to the underlying transport unchanged — Tauri's
  `tauriInvoke(method, undefined)` already handles undefined; PR-D's
  `window.vimeflow.invoke` producer (Electron preload) MUST normalize
  to `params: args ?? {}` when serializing the request frame, because
  PR-B §5.1.1 requires the `params` field to be an object (the sidecar
  router decodes empty objects per-method, but rejects missing keys).
  This normalization lives in the preload, not the bridge.
- Errors reject the promise with **the underlying transport's reject
  value, passed through unchanged**. The bridge MUST NOT wrap, transform,
  or normalize the rejection shape. Today that means Tauri's invoke
  rejects with a string (Rust's `Result<T, String>` Err arm reaches JS
  as a bare string, not an `Error`). In PR-D, `window.vimeflow.invoke`
  MUST reject with the sidecar response frame's `error` field as a bare
  string, preserving the same shape. Call sites today read rejections as
  `catch (err: unknown)` and coerce via `String(err)` / `err instanceof Error`
  — that pattern stays valid.
- `listen<T>(event, callback)` returns `Promise<UnlistenFn>`. The
  function MUST resolve only after the underlying transport listener is
  fully attached, so callers can `await listen(...)` before triggering
  IPC that would otherwise race the attachment (currently load-bearing
  in `TauriTerminalService.ensureListeners` and `useAgentStatus` —
  preserving this is a hard requirement, not a nice-to-have).
- The `callback(payload)` argument is the bare `payload` field of the
  event frame, never Tauri's `Event<T>` wrapper. Existing call sites
  that destructure `event.payload` must update — the bridge unwraps
  on the Tauri fallback path so all consumers code against the same
  shape PR-D will ship natively.
- The returned `UnlistenFn` detaches the transport listener AND is
  idempotent (calling it twice is a no-op). Consumers store it in
  refs / arrays and invoke it during effect cleanup; double-fire is
  observed today in StrictMode dev paths.

### 2.2 Layered implementation

`window.vimeflow?: BackendApi` is the production target. PR-C's bridge
checks `window.vimeflow` at call-time and delegates if present;
otherwise it falls back to `@tauri-apps/api/core` (`invoke`) and
`@tauri-apps/api/event` (`listen`), unwrapping `Event<T>.payload` so
the callback surface stays uniform.

During PR-C, `window.vimeflow` is never set in production — Tauri is
the host and there is no preload to install it. The branch exists for
two reasons:

1. **PR-D edit minimality.** PR-D removes the `@tauri-apps` imports and
   both fallback `else` branches in a 4-to-6-line delete. No reshape
   of the function signatures.
2. **Test ergonomics.** Unit tests exercise both paths by fabricating
   a `window.vimeflow` (the production target shape) and by leaving it
   unset (the current Tauri fallback). Both paths must be tested or
   PR-D's edit could regress the live path.

### 2.4 `isDesktop()` semantics

`src/lib/environment.ts` exports `isDesktop()` (renamed from
`isTauri()`). The function returns `true` when EITHER signal is
present on `window`:

```ts
export const isDesktop = (): boolean => {
  if (typeof window === 'undefined') {
    return false
  }
  return window.__TAURI_INTERNALS__ != null || window.vimeflow != null
}
```

The signal check uses `!= null` (not `in window`) so that an explicit
`window.vimeflow = undefined` — which tests set when exercising the
fallback path — does NOT trip the detection. Tauri sets
`__TAURI_INTERNALS__` to a real object; Electron preload (PR-D) will
set `vimeflow` to the `BackendApi` instance. Anything else is browser
/ Vitest.

The OR makes the factory pattern correct in both PR-C and PR-D:

- **PR-C (Tauri host).** `__TAURI_INTERNALS__` is set, `vimeflow` is
  not. Factories return `TauriXxx` services. Bridge falls back to
  `@tauri-apps/api`.
- **PR-D (Electron host).** `vimeflow` is set, `__TAURI_INTERNALS__`
  is not. Factories return the same `TauriXxx` services (renamed to
  `DesktopXxx` in PR-D). Bridge uses `window.vimeflow` directly.
- **Browser / Vitest jsdom.** Neither signal is set. Factories
  return `MockXxx` / `HttpXxx`. Bridge functions are never called.

`isBrowser()` stays as `!isDesktop()`. `getEnvironment()` returns
`'desktop' | 'browser'` (the `'tauri'` literal is retired). The
rename is API-visible: every consumer of `isTauri()` /
`getEnvironment() === 'tauri'` must update. There are exactly 3
production call sites (`terminalService.ts:388`,
`fileSystemService.ts:110`, `gitService.ts:180` — the last reads
`__TAURI_INTERNALS__` directly) plus the test file, so no compat
alias is provided.

### 2.5 What PR-D consumes

- PR-D will provide `window.vimeflow: BackendApi` from Electron preload,
  forwarding to `ipcMain.handle('backend:invoke', ...)`. `ipcMain` then
  speaks PR-B §5.1's LSP-style IPC frames to the Rust sidecar's stdin /
  stdout.
- PR-D will register a `webContents.send('backend:event', ...)` fan-out
  so sidecar event frames reach every renderer that called
  `window.vimeflow.listen(...)`.
- PR-D will delete the `@tauri-apps/api/core` + `@tauri-apps/api/event`
  imports from `src/lib/backend.ts` and the fallback branches that
  wrap them. PR-D MUST ALSO either:
  - (a) tighten `Window.vimeflow?` to `Window.vimeflow` (required) in
    `src/types/vimeflow.d.ts` — appropriate because Electron preload
    guarantees the global is set before the renderer boots; OR
  - (b) keep the `typeof window !== 'undefined' && window.vimeflow`
    guard and throw a clear error when the global is missing,
    preserving the optional `?` annotation.

  (a) is preferred — it shrinks the bridge body to a one-liner per
  function and matches the runtime invariant the preload installs.
  (b) is the safe fallback if the typings should keep room for a
  partially-bootstrapped renderer (e.g. early-load diagnostic paths).
  Either way, the bridge body is no larger than three lines per
  function and the idempotency guard from §4.1 stays put.

## 3. File structure & touch list

### 3.1 New (3 files)

- `src/lib/backend.ts` — defines `BackendApi`, `UnlistenFn`, and the
  module-level `invoke` + `listen` functions. Does NOT redeclare
  `Window.vimeflow` — that ambient augmentation lives in
  `src/types/vimeflow.d.ts` (single owner; see below). `backend.ts`
  reads `window.vimeflow` at call-time; the augmentation makes the
  access type-safe.
- `src/lib/backend.test.ts` — Vitest unit tests covering both layered
  paths (synthetic `window.vimeflow` + Tauri fallback), payload
  unwrap on the fallback, `UnlistenFn` idempotency, listener
  attach-before-resolve contract.
- `src/types/vimeflow.d.ts` — the **single owner** of the
  `Window.vimeflow?: BackendApi` ambient global augmentation. Kept in
  `src/types/` (the project's existing global-types directory) so
  every file in the renderer sees the augmentation without importing
  the bridge module. The file does `import type { BackendApi } from '../lib/backend'`
  to reference the type; it is the only file with a `declare global`
  block for `Window.vimeflow`. Avoiding a duplicate declaration in
  `backend.ts` keeps the global single-owner so a third reader
  (e.g. a future debug helper) can't accidentally end up with two
  conflicting augmentations.

### 3.2 Modified (16 files)

`src/lib/`

- `environment.ts` — rename `isTauri` → `isDesktop`; `isBrowser` becomes
  `!isDesktop`; `getEnvironment` returns `'desktop' | 'browser'`. No
  compat alias (blast radius is 3 production call sites — full rename
  is cheaper than a deprecation cycle).
- `environment.test.ts` — rename existing `isTauri` test cases to
  match the new export name AND add coverage for the new OR-detection
  semantics (§2.4):
  - `isDesktop()` is `true` when `window.__TAURI_INTERNALS__ = {}`
    is set (existing Tauri-detection case, renamed).
  - `isDesktop()` is `true` when `window.vimeflow = { invoke: ..., listen: ... }`
    is set, `__TAURI_INTERNALS__` absent (the PR-D / Electron signal).
  - `isDesktop()` is `false` when `window.vimeflow = undefined`,
    `__TAURI_INTERNALS__` absent (loose-comparison case — locks the
    distinction between "property unset" and "property set to undefined").
  - `isDesktop()` is `false` when neither global is present (browser /
    Vitest baseline).
    Renaming the existing test cases without adding the new ones leaves
    the Electron-signal path uncovered; the migration MUST add the new
    cases.
- `e2e-bridge.ts` — replace the `@tauri-apps/api/core` `invoke` import
  with `import { invoke } from './backend'`.

`src/features/terminal/services/`

- `terminalService.ts` — factory at line 388 swaps `isTauri()` for
  `isDesktop()`. Class names + factory return shape unchanged.
- `tauriTerminalService.ts` — imports flip to `src/lib/backend`.
  Three `listen` callbacks (`pty-data`, `pty-exit`, `pty-error`)
  refactor `(event) => { ... event.payload ... }` to
  `(payload) => { ... payload ... }`. Class identifier stays
  `TauriTerminalService` (PR-D renames).
- `tauriTerminalService.test.ts` — `vi.mock('@tauri-apps/api/core', ...)`
  and `vi.mock('@tauri-apps/api/event', ...)` become
  `vi.mock('../../../lib/backend', ...)`; assertion helpers update to
  the bare-payload shape.

`src/features/files/services/`

- `fileSystemService.ts` — drop dynamic `await import('@tauri-apps/api/core')`
  inside each method; replace with a top-level `import { invoke } from '../../../lib/backend'`.
  Factory at line 110 swaps `isTauri()` for `isDesktop()`. Three
  call sites (`list_dir`, `read_file`, `write_file`) lose their
  dynamic import boilerplate.
- `fileSystemService.test.ts` — mock `../../../lib/backend` instead
  of `@tauri-apps/api/core`.

`src/features/diff/services/`

- `gitService.ts` — factory at line 174-185 swaps
  `'__TAURI_INTERNALS__' in window` for `isDesktop()` (importing
  from `src/lib/environment`). `TauriGitService` class imports flip
  to `src/lib/backend`. `MockGitService` and `HttpGitService` stay
  unchanged.
- `gitService.test.ts` — the test at line 401-416 that toggles
  `__TAURI_INTERNALS__` is rewritten to toggle `isDesktop()` via a
  `vi.mock('../../../lib/environment', ...)` spy; bridge mocks
  replace `@tauri-apps/api/core`.

`src/features/diff/hooks/`

- `useGitBranch.ts` — single `invoke` import flips to `src/lib/backend`.
  No `listen` calls in this hook.
- `useGitBranch.test.ts` — mock `../../../lib/backend`.
- `useGitStatus.ts` — `invoke` + `listen` + `UnlistenFn` imports
  flip to `src/lib/backend`. One `listen<GitStatusChangedPayload>`
  callback refactors `event.payload` → bare payload.
- `useGitStatus.test.ts` — mock `../../../lib/backend`.

`src/features/agent-status/hooks/`

- `useAgentStatus.ts` — `invoke` + `listen` imports flip to
  `src/lib/backend`. Four `listen` callbacks
  (`agent-status`, `agent-tool-call`, `agent-turn`, `test-run`)
  refactor `(event) => { ... event.payload ... }` to
  `(payload) => { ... payload ... }`. This is the highest-touch
  file in the PR.
- `useAgentStatus.test.ts` — mock `../../../lib/backend`.

### 3.3 NOT touched

- `src-tauri/**` — Rust runtime locked by PR-A/B; no IPC shape
  changes mean no Rust diff.
- `electron/**` — does not exist; PR-D creates it.
- `tests/e2e/**` — driver swap stays in PR-D. The frontend bridge
  migration of `src/lib/e2e-bridge.ts` is the only E2E-adjacent
  touch (and it's a renderer-side file, not a harness file).
- `src/bindings/**` — no Rust IPC shape changes; ts-rs output is
  byte-identical.
- `package.json` — `@tauri-apps/api` stays in `dependencies`
  through PR-C because the bridge's fallback branch still imports
  from it. `@tauri-apps/cli` and the `tauri:*` npm scripts also
  stay — they're the local dev runtime.
- `vite.config.ts` — no plugin / alias / `base` changes. The bridge
  is a pure source-level abstraction.
- `MockGitService`, `HttpGitService`, `MockTerminalService`,
  `MockFileSystemService` — unchanged. Mock services don't import
  `@tauri-apps/api` today; only the Tauri-flavored services do.

## 4. Bridge implementation sketch

### 4.1 `src/lib/backend.ts` (~60 lines)

```ts
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen as tauriListen } from '@tauri-apps/api/event'

/**
 * Detach a previously-registered listener. Idempotent — a second call is
 * a no-op. PR-D removes the `@tauri-apps/event` import and the
 * `tauriUnlisten` branch below; the bridge's `called` guard wrapper
 * (in `listen()` below) stays so StrictMode double-cleanup remains
 * safe regardless of which transport produced `rawUnlisten`.
 */
export type UnlistenFn = () => void

export interface BackendApi {
  invoke: <T>(method: string, args?: Record<string, unknown>) => Promise<T>

  listen: <T>(
    event: string,
    callback: (payload: T) => void
  ) => Promise<UnlistenFn>
}

/**
 * Invoke a backend command. Prefers `window.vimeflow.invoke` (PR-D's
 * Electron preload target) when set; otherwise falls back to
 * `@tauri-apps/api/core` so the Tauri host keeps working through end
 * of PR-C. Rejection value is the transport's reject value, passed
 * through unchanged — Tauri rejects with a bare string, sidecar
 * (PR-D) MUST reject with the same shape.
 */
export const invoke = async <T>(
  method: string,
  args?: Record<string, unknown>
): Promise<T> => {
  if (typeof window !== 'undefined' && window.vimeflow) {
    return window.vimeflow.invoke<T>(method, args)
  }
  return tauriInvoke<T>(method, args)
}

/**
 * Subscribe to a backend event. Callback receives the bare payload
 * (NOT Tauri's `Event<T>` envelope). The returned promise resolves
 * only after the underlying transport listener is attached, so
 * callers can `await listen(...)` before triggering IPC that would
 * otherwise race the attachment. The returned `UnlistenFn` detaches
 * the listener AND is idempotent — the bridge wraps the transport's
 * unlisten with a `called` guard so React StrictMode's
 * mount→cleanup→remount double-fire is safe regardless of whether
 * the transport itself is idempotent.
 */
export const listen = async <T>(
  event: string,
  callback: (payload: T) => void
): Promise<UnlistenFn> => {
  const rawUnlisten =
    typeof window !== 'undefined' && window.vimeflow
      ? await window.vimeflow.listen<T>(event, callback)
      : // Tauri fallback: unwrap `Event<T>.payload` so the callback shape
        // is uniform across both paths. `tauriListen` resolves after the
        // listener has attached on the Rust side, so awaiting preserves
        // the load-bearing attach-before-resolve contract.
        await tauriListen<T>(event, (e) => callback(e.payload))

  // Idempotency guard: a second invocation is a no-op. Defends against
  // StrictMode double-cleanup AND against transports that throw on
  // double-detach (no guarantee `tauriListen` / `window.vimeflow.listen`
  // tolerate it).
  let called = false
  return () => {
    if (called) return
    called = true
    rawUnlisten()
  }
}
```

Notes:

- The bridge does NOT import `UnlistenFn` from `@tauri-apps/api/event`.
  It defines its own `UnlistenFn = () => void` so PR-D's @tauri-apps
  removal touches the bridge module only.
- `typeof window !== 'undefined'` guards against SSR / Node-only
  contexts. The bridge is renderer-only today, but the guard is cheap
  and matches the existing `isTauri()` pattern.
- No singleton state, no init promise — the bridge is fully stateless.
  Per-listener attach state lives in the underlying transport
  (`@tauri-apps/api/event` for now, `window.vimeflow` in PR-D).

### 4.2 `src/types/vimeflow.d.ts` (~10 lines)

```ts
import type { BackendApi } from '../lib/backend'

declare global {
  interface Window {
    /**
     * Electron preload's contextBridge exposes the backend API here
     * starting in PR-D. Undefined during PR-C — the bridge in
     * `src/lib/backend.ts` falls back to `@tauri-apps/api` in that
     * case. Tests fabricate this object to exercise the
     * production-target code path.
     */
    vimeflow?: BackendApi
  }
}

export {}
```

The trailing `export {}` makes the file a module so the `import type`
above is legal; the `declare global` block extends `Window`
program-wide.

### 4.3 `src/lib/backend.test.ts` testbed (~10 cases)

Two top-level `describe` blocks — one per code path:

**`describe('backend (window.vimeflow path)')` — 6 cases:**

1. `invoke` delegates to `window.vimeflow.invoke` with the same
   `method` + `args` arguments. Assert called-with shape; assert
   resolved value passes through.
2. `invoke<T>` rejection passes through unchanged when
   `window.vimeflow.invoke` rejects.
3. `listen` delegates to `window.vimeflow.listen`. Assert
   `window.vimeflow.listen` was called once with the bridge's event
   name + a function arg. (No identity check on the returned
   `UnlistenFn` — the bridge wraps with a `called` guard per §4.1, so
   `listen`'s return value is a new function, not the transport's
   raw unlisten.)
4. `listen` callback is invoked with the bare payload object when
   `window.vimeflow.listen`'s implementation fires it — no
   `Event<T>` wrapping done by the bridge.
5. `listen` resolves only after `window.vimeflow.listen` has
   resolved. Same deferred-mock pattern as case #10 — locks the
   attach-before-resolve contract on the production-target path too,
   not only the Tauri fallback. This is the case that catches a
   PR-D regression where the preload's `listen` resolves before
   `ipcRenderer.on` has attached.
6. `UnlistenFn` from the `window.vimeflow` path is idempotent. Same
   spy-on-raw-unlisten assertion as case #9, against
   `window.vimeflow.listen`'s returned unlisten. The bridge's
   `called` guard wraps regardless of which path produced
   `rawUnlisten`, so this test confirms the guard runs on both
   paths.

**`describe('backend (@tauri-apps fallback path)')` — 6 cases:**

5. `invoke` delegates to `tauriInvoke` when `window.vimeflow` is
   undefined; method + args preserved.
6. `invoke` rejection passes through Tauri's bare-string rejection
   shape unchanged.
7. `listen` wraps `tauriListen` — the callback registered with
   Tauri unwraps `Event<T>.payload` before calling the bridge's
   callback. Fire a synthetic `Event<T>` through the Tauri mock
   and assert the bridge callback received `event.payload`, not
   the whole event.
8. The `UnlistenFn` returned by `listen` calls through to the
   `tauriListen`-resolved unlisten function on invocation. Mocking
   spy on the raw unlisten verifies the call-through. (No identity
   check — bridge's `called` guard from §4.1 makes the returned
   function a wrapper, not the raw transport function.)
9. `UnlistenFn` is idempotent. A second invocation is a no-op:
   assert the spy on the raw transport unlisten was called exactly
   once after two invocations of the bridge's `UnlistenFn`. The
   idempotency lives in the bridge's `called` guard, NOT in the
   transport — `tauriListen` / `window.vimeflow.listen` may or may
   not be idempotent themselves; the bridge's wrapper makes the
   guarantee unconditional.
10. `listen` resolves only after `tauriListen` has resolved. Use
    a deferred mock that resolves on demand; assert the bridge's
    `listen` promise stays pending until the underlying resolve
    fires. This locks the load-bearing attach-before-resolve
    contract (currently relied on by `TauriTerminalService` and
    `useAgentStatus`).

`beforeEach` for the `window.vimeflow` block fabricates an object
matching `BackendApi` and assigns it to `window.vimeflow`. `beforeEach`
for the fallback block calls `delete (window as Window).vimeflow`.
Both forms (`delete` and `= undefined`) actually satisfy §2.4's
`!= null` check because `undefined != null` is `false` under loose
comparison — the `delete` form is preferred only because it's more
idiomatic for "this global isn't installed". Both blocks use
`vi.mock('@tauri-apps/api/core', ...)` + `vi.mock('@tauri-apps/api/event', ...)`
to inject deterministic fakes for the Tauri path; the
`window.vimeflow` block additionally exercises a synthetic global so
the fallback mocks are present but never called.

## 5. Migration strategy

### 5.1 Common pattern (5 of 7 files)

Three-step migration:

1. Replace `import { invoke } from '@tauri-apps/api/core'` and
   `import { listen, type UnlistenFn } from '@tauri-apps/api/event'`
   with a single `import { invoke, listen, type UnlistenFn } from '<path>/lib/backend'`
   (using the correct relative path for the file).
2. For each `listen<T>(name, (event) => { ... event.payload ... })`
   callback, refactor to `(payload) => { ... payload ... }`. The
   destructure-from-payload form is preferred over destructure-in-
   params (`({ a, b }) => ...`) because it keeps `payload` available
   when callbacks need to read additional fields conditionally
   (see `useAgentStatus`).
3. Update the sibling test:
   - `vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))` and
     `vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))`
     become a single
     `vi.mock('<path>/lib/backend', () => ({ invoke: vi.fn(), listen: vi.fn() }))`.
   - Any test that constructed a synthetic `Event<T>` wrapper
     (`{ event, id, payload, windowLabel }`) to pass into the listener
     callback now passes the bare payload object.
   - `mockedInvoke` / `mockedListen` references stay valid via
     `vi.mocked(invoke)` / `vi.mocked(listen)` against the new module.

Files fitting the pattern: `e2e-bridge.ts` (invoke only), `useGitBranch.ts`
(invoke only), `useGitStatus.ts` (invoke + 1 listen), `useAgentStatus.ts`
(invoke + 4 listens), `tauriTerminalService.ts` (invoke + 3 listens).

### 5.2 Special case — `fileSystemService.ts` (dynamic → static import)

Today each of the three methods (`listDir`, `readFile`, `writeFile`)
has a top-level `const { invoke } = await import('@tauri-apps/api/core')`.
The dynamic import was a workaround so the @tauri-apps bundle didn't
ship to mock callers in browser builds.

After migration: a single top-level
`import { invoke } from '../../../lib/backend'`. The dynamic-import
boilerplate disappears from all three methods.

The dynamic import is NOT load-bearing today: `useAgentStatus.ts`,
`useGitStatus.ts`, `useGitBranch.ts`, `gitService.ts`, and
`tauriTerminalService.ts` all import `@tauri-apps/api` at module-top
and are themselves imported eagerly by `WorkspaceView` /
`createTerminalService` / `createGitService`. So `@tauri-apps/api`
is already in every production bundle — `fileSystemService`'s
dynamic-import workaround is an isolated outlier, not a bundle-wide
discipline. Making it consistent with the other six files (all
static via the bridge) does NOT introduce a regression. PR-D's
removal of `@tauri-apps/api` from the bridge — and from
`package.json` — is what actually shrinks the bundle.

### 5.3 Special case — `gitService.ts` (factory branching)

Today lines 174-185 read:

```ts
if (import.meta.env.MODE === 'test') return new MockGitService()
if ('__TAURI_INTERNALS__' in window) return new TauriGitService(cwd)
return new HttpGitService()
```

After:

```ts
if (import.meta.env.MODE === 'test') return new MockGitService()
if (isDesktop()) return new TauriGitService(cwd)
return new HttpGitService()
```

`TauriGitService` keeps its name through PR-C (PR-D renames). The
factory's `isDesktop()` call detects BOTH Tauri (today, via
`__TAURI_INTERNALS__`) AND Electron (PR-D, via `window.vimeflow`),
so the factory branch stays correct across both runtimes.

The sibling test at `gitService.test.ts:401-416` currently sets
`__TAURI_INTERNALS__` directly to drive the factory. After migration,
the test mocks `isDesktop()` via
`vi.mock('../../../lib/environment', () => ({ isDesktop: vi.fn() }))`
and uses `mockedIsDesktop.mockReturnValue(true|false)`. No more
direct manipulation of the global object — the abstraction is the
seam the test should poke.

The factory's first branch (`if (import.meta.env.MODE === 'test') return new MockGitService()`)
short-circuits before `isDesktop()` runs, so the test MUST also
override `MODE` before mocking `isDesktop()` to true. The existing
suite at `gitService.test.ts:380-420` already does this via
`vi.stubEnv('MODE', 'development')` / a similar mechanism — the
migration MUST preserve that override; mocking `isDesktop()` alone
will still hit the `MockGitService` branch and the test will pass
silently on the wrong implementation.

### 5.4 Test mocking pattern (canonical form)

Before:

```ts
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))

const mockedInvoke = vi.mocked(invoke)
const mockedListen = vi.mocked(listen)
```

After:

```ts
import { invoke, listen } from '../../../lib/backend'

vi.mock('../../../lib/backend', () => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}))

const mockedInvoke = vi.mocked(invoke)
const mockedListen = vi.mocked(listen)
```

When a test fires a listener callback through `mockedListen`, it now
passes the bare payload:

```ts
// Before: synthesizes the Event<T> envelope.
const callback = mockedListen.mock.calls[0][1]
callback({ event: 'pty-data', id: 0, payload: { ... }, windowLabel: '' })

// After: callback receives the bare payload.
const callback = mockedListen.mock.calls[0][1]
callback({ ... })   // ← the payload object directly
```

### 5.5 Ordering (10 tasks, bridge-first, per-file)

1. `backend.ts` + `backend.test.ts` + `vimeflow.d.ts`.
2. `environment.ts` `isTauri` → `isDesktop` (rename + OR-detection).
3. `e2e-bridge.ts` — single-line invoke migration; warmup.
4. `useGitBranch.ts` — single-invoke hook; no listen.
5. `useGitStatus.ts` — invoke + 1 listen callback refactor.
6. `useAgentStatus.ts` — invoke + 4 listen callback refactors;
   heaviest single file in the PR.
7. `fileSystemService.ts` — dynamic-import → static-import sweep.
8. `gitService.ts` — factory branching + class import flips.
9. `tauriTerminalService.ts` + `terminalService.ts` factory.
10. Final sweep + verification gate (`rg -n '@tauri-apps/api' src tests`
    should leave one production hit — the bridge fallback — and the
    matching test-only imports inside `backend.test.ts`).

Order is not load-bearing — tasks 3-9 each touch independent files
once Task 1 (the bridge) exists. Subagent-driven-development can
parallelize tasks 3-9; sequencing only matters for local-dev
convenience and bisect granularity.

## 6. Verification gate

### 6.1 Local commands

```bash
npm run format:check
npm run lint
npm run type-check
npm run test
(cd src-tauri && cargo test)    # smoke — Rust unchanged; count must match PR-B baseline
```

All must be green. The Rust suite is a paranoia check — PR-C does not
touch `src-tauri/**`, so the count should be byte-identical to the
post-PR-B baseline. A diff there means the bridge migration
accidentally tripped the Rust build (e.g., a stray edit; the gate
catches that).

### 6.2 Coupling inventory

```bash
rg -nE "@tauri-apps/api|__TAURI_INTERNALS__" src tests
```

Expected residual hits live ONLY in these four files (line counts
not pinned — JSDoc comments may also reference `@tauri-apps/api`
inside `backend.ts` to explain the fallback, and the rg pattern
matches those too):

- `src/lib/backend.ts` — `@tauri-apps/api/core` +
  `@tauri-apps/api/event` import statements (the fallback's
  runtime dependency) AND any JSDoc that names the modules for
  context.
- `src/lib/backend.test.ts` — `vi.mock('@tauri-apps/api/core', ...)`
  and `/event` mock targets, plus any synthetic `Event<T>` fixtures
  the fallback tests pass to the mocked listener.
- `src/lib/environment.ts` — the `window.__TAURI_INTERNALS__ != null`
  probe inside `isDesktop()`, plus the `Window` ambient augmentation
  that declares `__TAURI_INTERNALS__`.
- `src/lib/environment.test.ts` — fixtures writing
  `__TAURI_INTERNALS__` to drive `isDesktop()` truthy / falsy.

No other file under `src/**` should match. Anything else is a leak —
i.e. a service or hook that bypassed the bridge migration. Fix it
before continuing the verification gate. `src-tauri/**` hits are out
of PR-C scope (PR-A/B locked the Rust side).

### 6.3 Manual smoke (`npm run tauri:dev`)

1. App window opens, default workspace renders.
2. Default terminal session spawns and reaches a prompt.
3. Type into the terminal — characters echo.
4. File Explorer lists the working directory; click a file — editor
   shows its content.
5. Diff panel shows the current branch + uncommitted status.
6. Spawn a second terminal pane via the existing flow; switch panes;
   close the second pane.
7. Cmd/Ctrl+Q — clean exit; relaunch and verify session-cache parity
   with the pre-PR-C baseline.

If any step regresses, bisect by reverting the most recent task's
commits. Bridge bugs typically surface at step 2 (PTY event flow) or
step 5 (git watcher) because those exercise the listener path most
aggressively.

### 6.4 E2E (`npm run test:e2e:build && npm run test:e2e`)

E2E specs MUST pass without any change — the `e2e-bridge` migration
replaces one `invoke` import with another semantically identical
import; the runtime path through `tauri-driver` + Wry is unchanged.

If a spec fails, that's a real regression in the bridge fallback
path. Do not paper it over by adjusting the spec.

## 7. Risks

### 7.1 Listener attach-before-resolve race

`TauriTerminalService.ensureListeners`,
`useAgentStatus.subscribe`, and `useGitStatus`'s watcher path all
`await listen(...)` before triggering IPC that would otherwise race
the attachment. The bridge's `listen` preserves this by awaiting the
underlying `tauriListen` before returning (§4.1). Test case #10
(§4.3) locks the contract. **PR-D regression risk:** the Electron
preload's `window.vimeflow.listen` MUST also resolve only after
`ipcRenderer.on` has attached on the main process. PR-D's preload
tests must mirror test case #10 against the new transport.

### 7.2 StrictMode double-cleanup

React 18 StrictMode mounts → cleans up → remounts in dev. The
bridge's `UnlistenFn` idempotency guard (§4.1) ensures the second
cleanup is a no-op even if the underlying transport throws on
double-detach. Production behavior is unchanged (StrictMode is
dev-only).

### 7.3 Test mocking pattern churn

All 7 sibling test files currently mock `@tauri-apps/api/core` and
`@tauri-apps/api/event`. After PR-C they mock `src/lib/backend`. The
diff in test files is large (mock factory rewrites + payload-shape
simplification). Reviewers may flag this as scope creep — it is
load-bearing and matches Task 8 of the migration roadmap. Call it
out in the PR description.

### 7.4 `useAgentStatus` is the highest-risk single file

4 `listen` callbacks (`agent-status`, `agent-tool-call`, `agent-turn`,
`test-run`), a complex state machine, multiple refs guarding async
continuations. The migration is mechanical (each `event.payload.X`
becomes `payload.X`) but a typo in any of the 4 callbacks could
silently break agent detection. Test coverage on this hook is high
(`useAgentStatus.test.ts` has 1200+ lines); per-callback assertions
catch most regressions. Run the spec for this file alone after the
migration: `npx vitest run src/features/agent-status/hooks/useAgentStatus.test.ts`.

### 7.5 `UnlistenFn` type drift

`tauriListen` returns `Promise<UnlistenFn>` where `UnlistenFn` is
imported from `@tauri-apps/api/event`. The bridge defines its own
`UnlistenFn = () => void` (§4.1) so PR-D's `@tauri-apps/api` removal
is a clean delete. If a future file accidentally imports
`UnlistenFn` from `@tauri-apps/api/event` instead of from
`src/lib/backend`, PR-D will fail to compile. §8.1 captures the
ESLint rule that prevents this.

## 8. Open questions / follow-ups

### 8.1 ESLint `no-restricted-imports` rule

Add an `eslint-plugin-import` `no-restricted-imports` rule that bans
`@tauri-apps/api*` imports outside `src/lib/backend.ts` and
`src/lib/backend.test.ts`. Locks the abstraction so future code
can't bypass the bridge. **Deferred to PR-D** because adding the rule
in PR-C would also need to touch `eslint.config.ts` (which is
otherwise out of scope), and the rule would be more obviously valuable
once `@tauri-apps/api` removal is the actual goal.

### 8.2 `Window.vimeflow` optionality in PR-D

PR-D chooses between two contracts (§2.5):

- **(a) `vimeflow: BackendApi` (non-optional).** Bridge body shrinks
  to one line per function. Matches the runtime invariant the
  Electron preload installs.
- **(b) `vimeflow?: BackendApi` (optional + bridge guard).** Bridge
  keeps a `typeof window !== 'undefined' && window.vimeflow` guard
  and throws when missing. Preserves typing room for partially-
  bootstrapped renderer states.

Recommended default: (a). The preload is the source of truth for
"this global exists"; the typing should match.

### 8.3 `BackendApi` versioning

PR-C's `BackendApi` is unversioned. If the IPC wire envelope changes
in a future PR (e.g. adds frame kinds, changes the response/error
shape), the bridge will need a version negotiation. Out of scope for
PR-C; flagged here so a future planner pass can pick it up.

### 8.4 `e2e-bridge.ts` co-location

`src/lib/e2e-bridge.ts` currently lives alongside the bridge module
in `src/lib/`. After PR-D, the e2e-bridge will be the only file in
`src/lib/` that uses `backend.invoke`. Consider relocating it to
`tests/e2e/shared/` or `src/test/` so renderer-runtime code and
test-instrumentation code live in different directories. Defer to a
follow-up PR; not blocking PR-C or PR-D.

<!-- codex-reviewed: 2026-05-14T09:17:09Z -->

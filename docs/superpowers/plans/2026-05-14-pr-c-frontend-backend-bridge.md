# PR-C — Frontend backend bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple the React renderer from `@tauri-apps/api` by adding `src/lib/backend.ts` (the runtime-neutral IPC seam) + `src/types/vimeflow.d.ts` (the `Window.vimeflow` global), then migrate the 7 renderer files that currently import `@tauri-apps/api` directly onto the bridge. Tauri remains the live host through end of PR-C; the bridge falls back to `@tauri-apps/api` when `window.vimeflow` isn't set, so the renderer behaves identically pre- and post-PR.

**Architecture:** Layered bridge — `invoke` / `listen` check `window.vimeflow` at call-time and delegate to it if present (PR-D target); otherwise they fall back to `@tauri-apps/api/core` (`invoke`) + `@tauri-apps/api/event` (`listen`) and unwrap `Event<T>.payload` so consumers always see the bare-payload shape PR-D ships natively. The bridge wraps the transport's unlisten function in a `called` guard so `UnlistenFn` is idempotent across both paths (load-bearing for React 18 StrictMode dev-mode double-cleanup). PR-D's bridge edit is a 4-to-6-line delete of the `@tauri-apps` imports and the fallback branches.

**Tech Stack:** TypeScript 5.9, React 19, Vitest 3, jsdom, `@tauri-apps/api` (transitional through PR-C; removed in PR-D).

**Spec:** `docs/superpowers/specs/2026-05-14-pr-c-frontend-backend-bridge-design.md`

**Migration roadmap:** `docs/superpowers/plans/2026-05-13-electron-rust-backend-migration.md` (the 4-PR index). This plan implements a strict subset of Tasks 2 + 8 + 9 of that roadmap (see spec §1 "Roadmap context" for the cut list).

---

## File Structure

### New (3 files)

- `src/lib/backend.ts` — defines `BackendApi`, `UnlistenFn`, and the module-level `invoke` + `listen` functions. Layered: prefers `window.vimeflow`, falls back to `@tauri-apps/api`.
- `src/lib/backend.test.ts` — Vitest unit tests; 12 cases across two `describe` blocks (window.vimeflow path × 6, Tauri fallback path × 6).
- `src/types/vimeflow.d.ts` — ambient declaration of `Window.vimeflow?: BackendApi`. Single owner.

### Modified (16 files)

- `src/lib/environment.ts` — `isTauri` → `isDesktop` (OR-detection: `__TAURI_INTERNALS__ != null || window.vimeflow != null`); `getEnvironment` returns `'desktop' | 'browser'`.
- `src/lib/environment.test.ts` — rename existing cases + add 4 new cases for the Electron-signal semantics.
- `src/lib/e2e-bridge.ts` — single `invoke` import flips.
- `src/features/terminal/services/terminalService.ts` — factory line 388: `isTauri()` → `isDesktop()`.
- `src/features/terminal/services/tauriTerminalService.ts` — imports flip; 3 `listen` callbacks refactor `event.payload` → bare payload.
- `src/features/terminal/services/tauriTerminalService.test.ts` — mocks flip; payload-shape assertions simplify.
- `src/features/files/services/fileSystemService.ts` — drop 3 dynamic imports; static top-level `import { invoke } from '../../../lib/backend'`; factory line 110: `isTauri()` → `isDesktop()`.
- `src/features/files/services/fileSystemService.test.ts` — mock flip.
- `src/features/diff/services/gitService.ts` — factory line 180: `'__TAURI_INTERNALS__' in window` → `isDesktop()`. `TauriGitService` imports flip.
- `src/features/diff/services/gitService.test.ts` — `__TAURI_INTERNALS__` direct manipulation rewritten to `vi.mock(environment).mockReturnValue` with `MODE` override preserved.
- `src/features/diff/hooks/useGitBranch.ts` — single `invoke` import flip.
- `src/features/diff/hooks/useGitBranch.test.ts` — mock flip.
- `src/features/diff/hooks/useGitStatus.ts` — `invoke` + `listen` + `UnlistenFn` imports flip; 1 listen callback refactor.
- `src/features/diff/hooks/useGitStatus.test.ts` — mock flip; synthetic Event<T> assertions simplify to bare-payload.
- `src/features/agent-status/hooks/useAgentStatus.ts` — `invoke` + `listen` imports flip; 4 listen callbacks refactor.
- `src/features/agent-status/hooks/useAgentStatus.test.ts` — mock flip; 4 places' synthetic Event<T> assertions simplify.

### Files NOT touched

- `src-tauri/**` — Rust runtime locked by PR-A/B.
- `electron/**` — does not exist; PR-D creates it.
- `tests/e2e/**` — driver swap stays in PR-D.
- `src/bindings/**` — no Rust IPC shape changes.
- `package.json` — `@tauri-apps/api` stays through PR-C.
- `vite.config.ts` — no plugin / alias / `base` changes.
- `eslint.config.ts` — no-restricted-imports rule deferred to PR-D (spec §8.1).

---

## Task 0: Baseline Verification

**Files:** none.

- [ ] **Step 1: Confirm working tree is clean and on a PR-C branch**

```bash
cd /home/will/projects/vimeflow
git status
git branch --show-current
```

Expected: `nothing to commit, working tree clean`. Branch: `dev` (or `feat/pr-c-frontend-backend-bridge` if a feature branch is preferred — create it BEFORE Task 1 via `git checkout -b feat/pr-c-frontend-backend-bridge`).

- [ ] **Step 2: Confirm TS tests + type-check + lint + format are green**

```bash
npm run test
npm run type-check
npm run lint
npm run format:check
```

Expected: all green. Record the Vitest test count for comparison in Task 10 (the PR adds ~16 new bridge/environment tests; total should climb by that amount).

- [ ] **Step 3: Confirm Rust tests are green (smoke; Rust unchanged in PR-C)**

```bash
(cd src-tauri && cargo test)
```

Expected: all green. PR-C does not touch `src-tauri/**`, so the count must match the post-PR-B baseline byte-for-byte.

- [ ] **Step 4: Inventory current `@tauri-apps/api` coupling**

```bash
rg -nE "@tauri-apps/api|__TAURI_INTERNALS__" src tests > /tmp/pr-c-baseline.txt
wc -l /tmp/pr-c-baseline.txt
```

Expected: hits in 12 files — `e2e-bridge.ts`, `environment.ts`, `environment.test.ts`, `fileSystemService.ts`, `useAgentStatus.ts` (+`.test.ts`), `gitService.ts` (+`.test.ts`), `useGitStatus.ts` (+`.test.ts`), `useGitBranch.ts` (+`.test.ts`), `tauriTerminalService.ts` (+`.test.ts`). Save for Task 10's diff comparison.

- [ ] **Step 5: Smoke-check the Tauri host before any change**

```bash
npm run tauri:dev
```

Open the app, confirm: default terminal spawns, file explorer lists, git diff panel shows status, Cmd/Ctrl+Q closes cleanly. Kill the dev server. This is the "renderer cannot tell the difference" baseline.

---

## Task 1: Create `src/lib/backend.ts` + `vimeflow.d.ts` + tests

**Files:**

- Create: `src/lib/backend.ts`
- Create: `src/lib/backend.test.ts`
- Create: `src/types/vimeflow.d.ts`

This task implements the bridge from spec §4.1-4.3. TDD: write the failing tests first, watch them fail, then implement.

- [ ] **Step 1: Create the ambient `Window.vimeflow` declaration**

Create `src/types/vimeflow.d.ts`:

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

The trailing `export {}` makes the file a module so `import type` is legal.

- [ ] **Step 2: Verify `tsconfig.json` includes `src/types/**`\*\*

```bash
grep -nE '"include"|"src/types"' tsconfig.json tsconfig.app.json 2>/dev/null
```

Expected: `src` is included by `tsconfig.app.json` (or whichever app-level config Vite uses), which covers `src/types/**` transitively. If not, the new ambient declaration won't load — add `"src/types/**/*.d.ts"` to the `"include"` array of the app-level tsconfig.

- [ ] **Step 3: Write the failing tests in `src/lib/backend.test.ts`**

```ts
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { invoke, listen, type BackendApi } from './backend'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}))

// Import the mocked symbols AFTER vi.mock so they're the spies.
import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen as tauriListen } from '@tauri-apps/api/event'

const mockedTauriInvoke = vi.mocked(tauriInvoke)
const mockedTauriListen = vi.mocked(tauriListen)

describe('backend (window.vimeflow path)', () => {
  let mockInvoke: ReturnType<typeof vi.fn>
  let mockListen: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockedTauriInvoke.mockReset()
    mockedTauriListen.mockReset()
    mockInvoke = vi.fn()
    mockListen = vi.fn()
    ;(window as Window).vimeflow = {
      invoke: mockInvoke,
      listen: mockListen,
    } as unknown as BackendApi
  })

  afterEach(() => {
    delete (window as Window).vimeflow
  })

  test('invoke delegates to window.vimeflow.invoke with same args', async () => {
    mockInvoke.mockResolvedValueOnce({ id: 'abc' })

    const result = await invoke<{ id: string }>('spawn_pty', {
      sessionId: 's1',
    })

    expect(mockInvoke).toHaveBeenCalledTimes(1)
    expect(mockInvoke).toHaveBeenCalledWith('spawn_pty', { sessionId: 's1' })
    expect(result).toEqual({ id: 'abc' })
    expect(mockedTauriInvoke).not.toHaveBeenCalled()
  })

  test('invoke rejection passes through unchanged', async () => {
    mockInvoke.mockRejectedValueOnce('sidecar error')

    await expect(invoke('git_status', { cwd: '/x' })).rejects.toBe(
      'sidecar error'
    )
  })

  test('listen delegates to window.vimeflow.listen', async () => {
    const rawUnlisten = vi.fn()
    mockListen.mockResolvedValueOnce(rawUnlisten)

    const unlisten = await listen<{ a: number }>('agent-status', () => {})

    expect(mockListen).toHaveBeenCalledTimes(1)
    expect(mockListen).toHaveBeenCalledWith(
      'agent-status',
      expect.any(Function)
    )
    expect(typeof unlisten).toBe('function')
    // Bridge wraps with a `called` guard, so identity check would fail —
    // assert behavior instead in cases #5 and #6.
  })

  test('listen callback receives bare payload', async () => {
    mockListen.mockImplementationOnce(async (_event, cb) => {
      cb({ sessionId: 's1', data: 'hi' })
      return vi.fn()
    })
    const cb = vi.fn()

    await listen<{ sessionId: string; data: string }>('pty-data', cb)

    expect(cb).toHaveBeenCalledWith({ sessionId: 's1', data: 'hi' })
  })

  test('listen resolves only after window.vimeflow.listen resolves', async () => {
    let resolveTransport!: (unlisten: () => void) => void
    mockListen.mockReturnValueOnce(
      new Promise<() => void>((res) => {
        resolveTransport = res
      })
    )

    const bridgePromise = listen('x', () => {})
    let resolved = false
    void bridgePromise.then(() => {
      resolved = true
    })

    await Promise.resolve()
    expect(resolved).toBe(false)
    resolveTransport(vi.fn())
    await bridgePromise
    expect(resolved).toBe(true)
  })

  test('UnlistenFn from window.vimeflow path is idempotent', async () => {
    const rawUnlisten = vi.fn()
    mockListen.mockResolvedValueOnce(rawUnlisten)

    const unlisten = await listen('x', () => {})
    unlisten()
    unlisten()

    expect(rawUnlisten).toHaveBeenCalledTimes(1)
  })
})

describe('backend (@tauri-apps fallback path)', () => {
  beforeEach(() => {
    mockedTauriInvoke.mockReset()
    mockedTauriListen.mockReset()
    delete (window as Window).vimeflow
  })

  test('invoke delegates to tauriInvoke when window.vimeflow is unset', async () => {
    mockedTauriInvoke.mockResolvedValueOnce({ ok: true })

    const result = await invoke<{ ok: boolean }>('list_sessions')

    expect(mockedTauriInvoke).toHaveBeenCalledTimes(1)
    expect(mockedTauriInvoke).toHaveBeenCalledWith('list_sessions', undefined)
    expect(result).toEqual({ ok: true })
  })

  test('invoke rejection passes through tauri string error unchanged', async () => {
    mockedTauriInvoke.mockRejectedValueOnce('PTY session not found')

    await expect(invoke('write_pty', { id: 'x' })).rejects.toBe(
      'PTY session not found'
    )
  })

  test('listen unwraps Event<T>.payload on the Tauri callback', async () => {
    mockedTauriListen.mockImplementationOnce(async (_name, cb) => {
      cb({
        event: 'pty-data',
        id: 0,
        payload: { sessionId: 's1', data: 'hi' },
        windowLabel: '',
      } as unknown as Parameters<typeof cb>[0])
      return vi.fn()
    })
    const cb = vi.fn()

    await listen<{ sessionId: string; data: string }>('pty-data', cb)

    expect(cb).toHaveBeenCalledWith({ sessionId: 's1', data: 'hi' })
  })

  test('UnlistenFn calls through to tauriListen-resolved unlisten', async () => {
    const rawUnlisten = vi.fn()
    mockedTauriListen.mockResolvedValueOnce(rawUnlisten)

    const unlisten = await listen('pty-exit', () => {})
    unlisten()

    expect(rawUnlisten).toHaveBeenCalledTimes(1)
  })

  test('UnlistenFn from fallback path is idempotent', async () => {
    const rawUnlisten = vi.fn()
    mockedTauriListen.mockResolvedValueOnce(rawUnlisten)

    const unlisten = await listen('x', () => {})
    unlisten()
    unlisten()

    expect(rawUnlisten).toHaveBeenCalledTimes(1)
  })

  test('listen resolves only after tauriListen resolves (attach-before-resolve)', async () => {
    let resolveTransport!: (unlisten: () => void) => void
    mockedTauriListen.mockReturnValueOnce(
      new Promise<() => void>((res) => {
        resolveTransport = res
      })
    )

    const bridgePromise = listen('x', () => {})
    let resolved = false
    void bridgePromise.then(() => {
      resolved = true
    })

    await Promise.resolve()
    expect(resolved).toBe(false)
    resolveTransport(vi.fn())
    await bridgePromise
    expect(resolved).toBe(true)
  })
})
```

- [ ] **Step 4: Run the failing tests**

```bash
npx vitest run src/lib/backend.test.ts
```

Expected: FAIL with `cannot find module './backend'` (or similar — `backend.ts` doesn't exist yet).

- [ ] **Step 5: Implement `src/lib/backend.ts`**

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
      : await tauriListen<T>(event, (e) => callback(e.payload))

  let called = false
  return () => {
    if (called) return
    called = true
    rawUnlisten()
  }
}
```

- [ ] **Step 6: Run the tests, expect pass**

```bash
npx vitest run src/lib/backend.test.ts
```

Expected: all 12 tests pass. If any fail, fix the implementation in Step 5 before continuing.

- [ ] **Step 7: Type-check + lint**

```bash
npm run type-check
npm run lint src/lib/backend.ts src/lib/backend.test.ts src/types/vimeflow.d.ts
```

Expected: clean. Common gotcha: `@typescript-eslint/explicit-function-return-type` requires `Promise<T>` annotations on the exported functions — already present in the sketch above.

- [ ] **Step 8: Commit**

```bash
git add src/lib/backend.ts src/lib/backend.test.ts src/types/vimeflow.d.ts
git commit -m "$(cat <<'EOF'
feat(frontend): add src/lib/backend.ts IPC bridge with Tauri fallback

Adds the runtime-neutral renderer-side IPC seam. invoke/listen prefer
window.vimeflow when set (PR-D target); fall back to @tauri-apps/api
when not (current PR-C state). UnlistenFn wraps the transport's
unlisten with a `called` guard so StrictMode double-cleanup is safe.

Adds 12 unit tests (6 per code path) including attach-before-resolve
and idempotency on both paths.

Spec: docs/superpowers/specs/2026-05-14-pr-c-frontend-backend-bridge-design.md §4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Rename `isTauri` → `isDesktop` with OR-detection

**Files:**

- Modify: `src/lib/environment.ts`
- Modify: `src/lib/environment.test.ts`

- [ ] **Step 1: Rewrite `src/lib/environment.ts`**

Replace the file contents with:

```ts
/**
 * Environment detection utilities for VIBM
 *
 * Provides functions to detect the runtime environment (desktop app
 * vs browser). "Desktop" covers both the current Tauri host AND the
 * Electron host introduced in PR-D — see spec §2.4.
 */

interface TauriInternals {
  metadata?: {
    currentWindow?: {
      label?: string
    }
  }
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals
  }
}

/**
 * True when the renderer is running inside a desktop host (Tauri today,
 * Electron in PR-D). Uses `!= null` (not `in`) so an explicit
 * `window.vimeflow = undefined` does NOT trip the check.
 */
export const isDesktop = (): boolean => {
  if (typeof window === 'undefined') {
    return false
  }
  return window.__TAURI_INTERNALS__ != null || window.vimeflow != null
}

/** True when the renderer is in a browser / Vitest context. */
export const isBrowser = (): boolean => !isDesktop()

/** 'desktop' covers both Tauri and Electron; 'browser' is everything else. */
export const getEnvironment = (): 'desktop' | 'browser' =>
  isDesktop() ? 'desktop' : 'browser'

export const isTest = (): boolean => import.meta.env.MODE === 'test'
```

(The `Window.vimeflow` augmentation lives in `src/types/vimeflow.d.ts` — added in Task 1 — and is in-scope here without an explicit import. Do NOT redeclare it.)

- [ ] **Step 2: Rewrite `src/lib/environment.test.ts`**

Replace with:

```ts
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { isDesktop, isBrowser, getEnvironment, isTest } from './environment'
import type { BackendApi } from './backend'

describe('environment', () => {
  let originalTauriInternals: typeof window.__TAURI_INTERNALS__
  let originalVimeflow: typeof window.vimeflow

  beforeEach(() => {
    originalTauriInternals = (window as Window).__TAURI_INTERNALS__
    originalVimeflow = (window as Window).vimeflow
  })

  afterEach(() => {
    if (originalTauriInternals === undefined) {
      delete (window as Window).__TAURI_INTERNALS__
    } else {
      ;(window as Window).__TAURI_INTERNALS__ = originalTauriInternals
    }
    if (originalVimeflow === undefined) {
      delete (window as Window).vimeflow
    } else {
      ;(window as Window).vimeflow = originalVimeflow
    }
  })

  describe('isDesktop', () => {
    test('returns true when __TAURI_INTERNALS__ is set (Tauri host)', () => {
      ;(window as Window).__TAURI_INTERNALS__ = {}
      delete (window as Window).vimeflow

      expect(isDesktop()).toBe(true)
    })

    test('returns true when window.vimeflow is set (Electron host)', () => {
      delete (window as Window).__TAURI_INTERNALS__
      ;(window as Window).vimeflow = {
        invoke: () => Promise.resolve(),
        listen: () => Promise.resolve(() => {}),
      } as unknown as BackendApi

      expect(isDesktop()).toBe(true)
    })

    test('returns false when window.vimeflow is explicitly undefined', () => {
      delete (window as Window).__TAURI_INTERNALS__
      ;(window as Window).vimeflow = undefined

      expect(isDesktop()).toBe(false)
    })

    test('returns false when neither signal is present (browser)', () => {
      delete (window as Window).__TAURI_INTERNALS__
      delete (window as Window).vimeflow

      expect(isDesktop()).toBe(false)
    })

    test('returns true when __TAURI_INTERNALS__ has metadata', () => {
      ;(window as Window).__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'main' } },
      }

      expect(isDesktop()).toBe(true)
    })
  })

  describe('isBrowser', () => {
    test('returns false when desktop signal is set', () => {
      ;(window as Window).__TAURI_INTERNALS__ = {}

      expect(isBrowser()).toBe(false)
    })

    test('returns true when no desktop signal is set', () => {
      delete (window as Window).__TAURI_INTERNALS__
      delete (window as Window).vimeflow

      expect(isBrowser()).toBe(true)
    })
  })

  describe('getEnvironment', () => {
    test('returns desktop when Tauri signal is present', () => {
      ;(window as Window).__TAURI_INTERNALS__ = {}

      expect(getEnvironment()).toBe('desktop')
    })

    test('returns desktop when vimeflow signal is present', () => {
      delete (window as Window).__TAURI_INTERNALS__
      ;(window as Window).vimeflow = {
        invoke: () => Promise.resolve(),
        listen: () => Promise.resolve(() => {}),
      } as unknown as BackendApi

      expect(getEnvironment()).toBe('desktop')
    })

    test('returns browser when no signal is present', () => {
      delete (window as Window).__TAURI_INTERNALS__
      delete (window as Window).vimeflow

      expect(getEnvironment()).toBe('browser')
    })
  })

  describe('isTest', () => {
    test('returns true when MODE is test', () => {
      expect(isTest()).toBe(true)
    })
  })
})
```

- [ ] **Step 3: Run environment tests**

```bash
npx vitest run src/lib/environment.test.ts
```

Expected: all tests pass. If a Vitest jsdom global is missing for `Window.vimeflow`, ensure Task 1 created `src/types/vimeflow.d.ts` and the file is in the tsconfig include path.

- [ ] **Step 4: Verify nothing in the repo still imports the old `isTauri`**

```bash
rg -n "isTauri\b" src tests
```

Expected: the 3 production hits remain — they'll be migrated in Tasks 4-9. (`isTauri` still exists as a symbol; Tasks 4-9 swap each caller to `isDesktop`.)

Wait — that's wrong. We've removed `isTauri` from `environment.ts` entirely in Step 1. After Step 1, the 3 callers will fail to compile. Fix: migrate the callers in this same task before committing, OR temporarily re-export `isTauri = isDesktop` as a deprecated alias for the rest of the PR.

Per spec §2.4 ("There are exactly 3 production call sites ... so no compat alias is provided"), do the rename atomically. Update the 3 callers in this task:

- [ ] **Step 5: Update `src/features/terminal/services/terminalService.ts:388`**

```ts
// Before:
import { isTauri } from '../../../lib/environment'
// ...
if (isTauri()) {

// After:
import { isDesktop } from '../../../lib/environment'
// ...
if (isDesktop()) {
```

- [ ] **Step 6: Update `src/features/files/services/fileSystemService.ts:110`**

```ts
// Before:
import { isTauri } from '../../../lib/environment'
// ...
if (isTauri()) {

// After:
import { isDesktop } from '../../../lib/environment'
// ...
if (isDesktop()) {
```

- [ ] **Step 7: Update `src/features/diff/services/gitService.ts:180`**

```ts
// Before:
// Check if running under Tauri
if ('__TAURI_INTERNALS__' in window) {
  return new TauriGitService(cwd)
}

// After:
// Check if running on the desktop host (Tauri today, Electron in PR-D)
if (isDesktop()) {
  return new TauriGitService(cwd)
}
```

Add `import { isDesktop } from '../../../lib/environment'` at the top of the file (with the other imports).

- [ ] **Step 8: Type-check + targeted test sweep**

```bash
npm run type-check
npx vitest run src/lib/environment.test.ts src/features/terminal/services/terminalService.test.ts src/features/files/services/ src/features/diff/services/gitService.test.ts
```

Expected: type-check clean. The service tests may still fail because they mock `@tauri-apps/api` rather than the bridge — those failures are addressed in Tasks 4-9. For now, only confirm the type-check is clean and the environment tests pass.

If gitService.test.ts has a test that sets `__TAURI_INTERNALS__` directly to drive the factory, it will probably still pass because `__TAURI_INTERNALS__` is in the OR. Don't refactor those tests in this task — Task 8 does it.

- [ ] **Step 9: Commit**

```bash
git add src/lib/environment.ts src/lib/environment.test.ts \
  src/features/terminal/services/terminalService.ts \
  src/features/files/services/fileSystemService.ts \
  src/features/diff/services/gitService.ts
git commit -m "$(cat <<'EOF'
refactor(frontend): rename isTauri → isDesktop with OR-detection

Renames the environment helper from isTauri to isDesktop and changes
its semantics: it now returns true when EITHER __TAURI_INTERNALS__
(today) OR window.vimeflow (PR-D / Electron) is set. The OR makes the
factory pattern correct across both runtime eras — same `TauriXxx`
service implementation, two different transports underneath.

Updates 3 production call sites: terminalService.ts (factory),
fileSystemService.ts (factory), gitService.ts (factory; previously
checked `'__TAURI_INTERNALS__' in window` directly — now goes through
the helper).

Adds 4 new isDesktop test cases for the Electron-signal path and the
`vimeflow = undefined` distinction. The `'tauri'` literal is retired
from getEnvironment's return type.

Spec: docs/superpowers/specs/2026-05-14-pr-c-frontend-backend-bridge-design.md §2.4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Migrate `src/lib/e2e-bridge.ts`

**Files:**

- Modify: `src/lib/e2e-bridge.ts`

This is the smallest migration — a single `invoke` call. Use it as the warmup for the pattern that Tasks 4-9 repeat.

- [ ] **Step 1: Edit `src/lib/e2e-bridge.ts`**

Change the first import line:

```ts
// Before:
import { invoke } from '@tauri-apps/api/core'

// After:
import { invoke } from './backend'
```

No other change. The single call site (`invoke<string[]>('list_active_pty_sessions')`) keeps its shape.

- [ ] **Step 2: Type-check**

```bash
npm run type-check
```

Expected: clean. The `invoke` signature is identical on both sides (`<T>(method, args?) => Promise<T>`), so no call-site change is needed.

- [ ] **Step 3: Smoke-check the file isn't otherwise referenced**

```bash
rg -n "e2e-bridge" src tests
```

Expected: hits in `src/main.tsx` (or wherever the side-effect import happens). The file isn't imported for its API — only for side-effect (it conditionally installs `window.__VIMEFLOW_E2E__`). No call-site refactor needed.

- [ ] **Step 4: Commit**

```bash
git add src/lib/e2e-bridge.ts
git commit -m "$(cat <<'EOF'
refactor(e2e): route e2e-bridge invoke through src/lib/backend

Replaces the direct @tauri-apps/api/core import in src/lib/e2e-bridge.ts
with the runtime-neutral bridge from src/lib/backend.ts. No behavioral
change — under Tauri the bridge falls back to the same tauri.invoke
call that this file used directly before.

Spec: docs/superpowers/specs/2026-05-14-pr-c-frontend-backend-bridge-design.md §5.1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Migrate `useGitBranch.ts`

**Files:**

- Modify: `src/features/diff/hooks/useGitBranch.ts`
- Modify: `src/features/diff/hooks/useGitBranch.test.ts`

This hook has a single `invoke` call, no `listen`. Mechanically identical to Task 3 with a test-mock flip.

- [ ] **Step 1: Edit `useGitBranch.ts` import**

```ts
// Before:
import { invoke } from '@tauri-apps/api/core'

// After:
import { invoke } from '../../../lib/backend'
```

No call-site change.

- [ ] **Step 2: Edit `useGitBranch.test.ts` mock**

Find the existing mock block (near the top of the file). Replace:

```ts
// Before:
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const mockedInvoke = vi.mocked(invoke)
```

with:

```ts
// After:
import { invoke } from '../../../lib/backend'

vi.mock('../../../lib/backend', () => ({
  invoke: vi.fn(),
}))

const mockedInvoke = vi.mocked(invoke)
```

If the test file imports `listen` too, include it in the mock factory (but for `useGitBranch.ts` only `invoke` is used — confirm by reading the test file first).

- [ ] **Step 3: Run the hook test**

```bash
npx vitest run src/features/diff/hooks/useGitBranch.test.ts
```

Expected: all tests pass. If a test fails because it asserts the underlying tauri invoke was called, update the assertion to spy on the bridge's `invoke` instead — same shape (`mockedInvoke.mock.calls[0]` etc.).

- [ ] **Step 4: Type-check**

```bash
npm run type-check
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/hooks/useGitBranch.ts \
  src/features/diff/hooks/useGitBranch.test.ts
git commit -m "$(cat <<'EOF'
refactor(diff): route useGitBranch through src/lib/backend

Replaces the direct @tauri-apps/api/core import with the bridge.
Test mock flips from @tauri-apps/api/core to src/lib/backend; same
assertion shape.

Spec: docs/superpowers/specs/2026-05-14-pr-c-frontend-backend-bridge-design.md §5.1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Migrate `useGitStatus.ts`

**Files:**

- Modify: `src/features/diff/hooks/useGitStatus.ts`
- Modify: `src/features/diff/hooks/useGitStatus.test.ts`

`useGitStatus` adds one `listen` callback (`git-status-changed`) on top of the invoke pattern. The callback currently destructures `event.payload.cwds`; after migration, it destructures the bare payload.

- [ ] **Step 1: Edit `useGitStatus.ts` imports**

```ts
// Before:
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'

// After:
import { invoke, listen, type UnlistenFn } from '../../../lib/backend'
```

- [ ] **Step 2: Edit the listen callback (search for `listen<GitStatusChangedPayload>` or the git-status-changed listener)**

Find the existing callback. The current shape (in the source file's git watcher section):

```ts
const unlisten = await listen<GitStatusChangedPayload>(
  'git-status-changed',
  (event) => {
    const cwds = event.payload.cwds
    // ... rest of logic ...
  }
)
```

Replace with bare-payload form:

```ts
const unlisten = await listen<GitStatusChangedPayload>(
  'git-status-changed',
  (payload) => {
    const cwds = payload.cwds
    // ... rest of logic UNCHANGED ...
  }
)
```

Be careful to update only the destructuring access (`event.payload.X` → `payload.X`); don't touch any other code in the callback body.

- [ ] **Step 3: Edit `useGitStatus.test.ts` mock + listen-callback fixtures**

Replace the mock block:

```ts
// Before:
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}))

// After:
import { invoke, listen } from '../../../lib/backend'

vi.mock('../../../lib/backend', () => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}))
```

Then find every place the test fires the listener manually via the captured callback. Today's pattern:

```ts
eventHandler!({ payload: { cwds: ['/home/test/project'] } })
```

Becomes:

```ts
eventHandler!({ cwds: ['/home/test/project'] })
```

(Drop the synthetic `payload:` wrapper. The bridge already unwraps; tests pass the bare payload directly.)

Also update the `EventCallback` type alias used in the test (if any). Today:

```ts
type EventCallback = (event: { payload: { cwds: string[] } }) => void
```

Becomes:

```ts
type EventCallback = (payload: { cwds: string[] }) => void
```

- [ ] **Step 4: Run the hook test**

```bash
npx vitest run src/features/diff/hooks/useGitStatus.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/hooks/useGitStatus.ts \
  src/features/diff/hooks/useGitStatus.test.ts
git commit -m "$(cat <<'EOF'
refactor(diff): route useGitStatus through src/lib/backend

Replaces direct @tauri-apps/api imports with the bridge. The
git-status-changed listener callback refactors `event.payload.cwds`
to `payload.cwds` (bridge unwraps Tauri's Event<T> envelope).

Test fixtures drop the synthetic { payload: ... } wrapper around
listener arguments; EventCallback type alias matches the bridge's
bare-payload signature.

Spec: docs/superpowers/specs/2026-05-14-pr-c-frontend-backend-bridge-design.md §5.1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Migrate `useAgentStatus.ts`

**Files:**

- Modify: `src/features/agent-status/hooks/useAgentStatus.ts`
- Modify: `src/features/agent-status/hooks/useAgentStatus.test.ts`

This is the heaviest single migration — 4 listen callbacks (`agent-status`, `agent-tool-call`, `agent-turn`, `test-run`) plus multiple invoke call sites. The mechanical change is uniform: each `event.payload.X` becomes `payload.X` (or simply `payload` where the whole thing is consumed). Move carefully — a typo in any of the 4 callbacks could silently break agent detection.

- [ ] **Step 1: Edit `useAgentStatus.ts` imports**

```ts
// Before:
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

// After:
import { invoke, listen } from '../../../lib/backend'
```

- [ ] **Step 2: Refactor the 4 listen callbacks**

For each callback in `useAgentStatus.ts`'s `subscribe()` function, replace `event` → `payload` in the argument name AND drop the `event.payload` access pattern.

**Callback 1 — `agent-status`** (around line 355-425):

```ts
// Before:
const unlistenStatus = await listen<AgentStatusEvent>(
  'agent-status',
  (event) => {
    if (event.payload.sessionId !== resolvePtyId()) {
      return
    }

    const p = event.payload
    // ... rest unchanged ...
  }
)

// After:
const unlistenStatus = await listen<AgentStatusEvent>(
  'agent-status',
  (payload) => {
    if (payload.sessionId !== resolvePtyId()) {
      return
    }

    const p = payload
    // ... rest unchanged ...
  }
)
```

**Callback 2 — `agent-tool-call`** (around line 429-490):

```ts
// Before:
const unlistenToolCall = await listen<AgentToolCallEvent>(
  'agent-tool-call',
  (event) => {
    const ptyId = getPtySessionId(sessionId)
    if (event.payload.sessionId !== ptyId) {
      return
    }
    const p = event.payload
    // ... rest unchanged ...
  }
)

// After:
const unlistenToolCall = await listen<AgentToolCallEvent>(
  'agent-tool-call',
  (payload) => {
    const ptyId = getPtySessionId(sessionId)
    if (payload.sessionId !== ptyId) {
      return
    }
    const p = payload
    // ... rest unchanged ...
  }
)
```

**Callback 3 — `agent-turn`** (around line 494-518):

```ts
// Before:
const unlistenTurn = await listen<AgentTurnEvent>('agent-turn', (event) => {
  if (event.payload.sessionId !== resolvePtyId()) {
    return
  }
  const nextTurns = event.payload.numTurns
  // ... rest unchanged ...
})

// After:
const unlistenTurn = await listen<AgentTurnEvent>('agent-turn', (payload) => {
  if (payload.sessionId !== resolvePtyId()) {
    return
  }
  const nextTurns = payload.numTurns
  // ... rest unchanged ...
})
```

**Callback 4 — `test-run`** (around line 525-537):

```ts
// Before:
const unlistenTestRun = await listen<TestRunSnapshot>('test-run', (event) => {
  if (event.payload.sessionId !== resolvePtyId()) {
    return
  }
  setStatus((prev) => ({
    ...prev,
    testRun: event.payload,
  }))
})

// After:
const unlistenTestRun = await listen<TestRunSnapshot>('test-run', (payload) => {
  if (payload.sessionId !== resolvePtyId()) {
    return
  }
  setStatus((prev) => ({
    ...prev,
    testRun: payload,
  }))
})
```

- [ ] **Step 3: Sanity grep — no `event.payload` should remain in this file**

```bash
rg -n "event\.payload" src/features/agent-status/hooks/useAgentStatus.ts
```

Expected: zero hits. If any remain, fix before continuing.

- [ ] **Step 4: Edit `useAgentStatus.test.ts` mock + listener fixtures**

Replace the mock block at the top of the file:

```ts
// Before:
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))

// After:
import { invoke, listen } from '../../../lib/backend'

vi.mock('../../../lib/backend', () => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}))
```

Update the `EventCallback` type alias at top of file:

```ts
// Before:
type EventCallback<T = unknown> = (event: { payload: T }) => void

// After:
type EventCallback<T = unknown> = (payload: T) => void
```

Update the `emit` helper (around line 52):

```ts
// Before:
const emit = <T>(eventName: string, payload: T): void => {
  // Find the listener callback that was registered for this event,
  // fire it with a synthetic Event<T> envelope.
  const call = mockedListen.mock.calls.find((c) => c[0] === eventName)
  const cb = call?.[1] as EventCallback<T>
  cb({ payload })
}

// After:
const emit = <T>(eventName: string, payload: T): void => {
  const call = mockedListen.mock.calls.find((c) => c[0] === eventName)
  const cb = call?.[1] as EventCallback<T>
  cb(payload)
}
```

Find every test that constructs a `{ payload: ... }` shape to pass to the listener — they're the `testRunHandler` / `eventHandler!` calls around lines 1139-1202 and elsewhere. Each:

```ts
// Before:
testRunHandler?.({ payload: snap })

// After:
testRunHandler?.(snap)
```

And every `handler:` type annotation:

```ts
// Before:
handler: (e: { payload: TestRunSnapshot }) => void

// After:
handler: (payload: TestRunSnapshot) => void
```

This is a sweep — search the test file for every `payload:` literal that wraps a listener argument, and unwrap.

- [ ] **Step 5: Sanity grep — no `event.payload` or `{ payload:` listener fixtures should remain**

```bash
rg -n "event\.payload|\{ payload:" src/features/agent-status/hooks/useAgentStatus.test.ts
```

Expected: zero matches (or, if any remain, they MUST be legitimately the agent-status `payload` shape — not a synthetic Event<T> wrapper).

- [ ] **Step 6: Run the hook test in isolation**

```bash
npx vitest run src/features/agent-status/hooks/useAgentStatus.test.ts
```

Expected: all tests pass. If a test fails on a specific callback's payload assertion, the most likely cause is missing the `event.payload` → `payload` rewrite in either the .ts or the .test.ts file. Re-check Steps 2 and 4.

- [ ] **Step 7: Run all tests to catch any cross-file regression**

```bash
npm run test
```

Expected: all green. The useAgentStatus migration is large; running the full suite catches any indirect breakage.

- [ ] **Step 8: Commit**

```bash
git add src/features/agent-status/hooks/useAgentStatus.ts \
  src/features/agent-status/hooks/useAgentStatus.test.ts
git commit -m "$(cat <<'EOF'
refactor(agent-status): route useAgentStatus through src/lib/backend

Heaviest single-file migration in PR-C. Replaces direct @tauri-apps
imports with the bridge. Refactors 4 listener callbacks (agent-status,
agent-tool-call, agent-turn, test-run) from `event.payload.X` to
`payload.X` since the bridge unwraps Tauri's Event<T> envelope on the
fallback path.

Test fixtures: EventCallback type, emit() helper, and 4+ inline
listener calls all drop the synthetic { payload: ... } wrapper.

Spec: docs/superpowers/specs/2026-05-14-pr-c-frontend-backend-bridge-design.md §5.1 + §7.4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Migrate `fileSystemService.ts` (dynamic → static import)

**Files:**

- Modify: `src/features/files/services/fileSystemService.ts`
- Modify: `src/features/files/services/fileSystemService.test.ts`

`fileSystemService` uses dynamic `await import('@tauri-apps/api/core')` inside each method. The migration converts to a single top-level static import.

- [ ] **Step 1: Edit `fileSystemService.ts`**

Add a top-level import of the bridge (with the other top-level imports near line 1-5):

```ts
import type { FileNode } from '../types'
import type { FileEntry } from '../../../bindings'
import { isDesktop } from '../../../lib/environment' // (already updated in Task 2)
import { invoke } from '../../../lib/backend' // ← NEW
import { mockFileTree } from '../data/mockFileTree'
```

Then strip the dynamic `await import(...)` from all three methods inside `TauriFileSystemService` (lines 42-67). After the edit:

```ts
class TauriFileSystemService implements IFileSystemService {
  async listDir(path: string): Promise<FileNode[]> {
    const entries = await invoke<FileEntry[]>('list_dir', {
      request: { path },
    })

    return entries.map((entry) => toFileNode(entry, path))
  }

  async readFile(path: string): Promise<string> {
    return invoke<string>('read_file', {
      request: { path },
    })
  }

  async writeFile(path: string, content: string): Promise<void> {
    await invoke<void>('write_file', {
      request: { path, content },
    })
  }
}
```

(Three `const { invoke } = await import('@tauri-apps/api/core')` lines disappear. The factory was already updated to `isDesktop()` in Task 2.)

- [ ] **Step 2: Edit `fileSystemService.test.ts` mock**

Replace:

```ts
// Before:
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

// After:
vi.mock('../../../lib/backend', () => ({
  invoke: vi.fn(),
}))
```

Update the import too:

```ts
// Before:
import { invoke } from '@tauri-apps/api/core'

// After:
import { invoke } from '../../../lib/backend'
```

- [ ] **Step 3: Run the test**

```bash
npx vitest run src/features/files/services/fileSystemService.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/features/files/services/fileSystemService.ts \
  src/features/files/services/fileSystemService.test.ts
git commit -m "$(cat <<'EOF'
refactor(files): route fileSystemService through src/lib/backend

Replaces the 3-method dynamic-import workaround with a single
top-level static import of the bridge. The dynamic import was no
longer load-bearing — useAgentStatus, gitService, and
tauriTerminalService already pull @tauri-apps/api eagerly into the
production bundle, so making fileSystemService consistent does not
regress the bundle. PR-D shrinks the bundle by removing @tauri-apps
entirely.

Spec: docs/superpowers/specs/2026-05-14-pr-c-frontend-backend-bridge-design.md §5.2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Migrate `gitService.ts` (factory branching + class imports)

**Files:**

- Modify: `src/features/diff/services/gitService.ts`
- Modify: `src/features/diff/services/gitService.test.ts`

`gitService` has both a factory branching pattern (Task 2 already updated the factory's `isDesktop()` check) AND a `TauriGitService` class that imports `invoke`. This task migrates the class's imports and rewrites the factory branching test.

- [ ] **Step 1: Edit `gitService.ts` import**

```ts
// Before:
import { invoke } from '@tauri-apps/api/core'

// After:
import { invoke } from '../../../lib/backend'
```

(The factory's `isDesktop()` check was already added in Task 2; no factory edit here.)

- [ ] **Step 2: Edit `gitService.test.ts` — top-level mocks**

Replace:

```ts
// Before:
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

const mockedInvoke = vi.mocked(invoke)

// After:
import { invoke } from '../../../lib/backend'
import { isDesktop } from '../../../lib/environment'

vi.mock('../../../lib/backend', () => ({
  invoke: vi.fn(),
}))

vi.mock('../../../lib/environment', () => ({
  isDesktop: vi.fn(),
  isBrowser: vi.fn(),
  getEnvironment: vi.fn(),
  isTest: vi.fn(),
}))

const mockedInvoke = vi.mocked(invoke)
const mockedIsDesktop = vi.mocked(isDesktop)
```

- [ ] **Step 3: Rewrite the factory test at `gitService.test.ts:401-416`**

Today's test (paraphrased):

```ts
test('returns TauriGitService when __TAURI_INTERNALS__ exists', () => {
  type WindowWithTauri = Window & { __TAURI_INTERNALS__?: unknown }
  const tauriWindow = window as WindowWithTauri
  try {
    tauriWindow.__TAURI_INTERNALS__ = {}
    // ... assert createGitService returns TauriGitService ...
  } finally {
    delete tauriWindow.__TAURI_INTERNALS__
  }
})
```

After:

```ts
test('returns TauriGitService when isDesktop() is true', () => {
  const prevMode = import.meta.env.MODE
  vi.stubEnv('MODE', 'development')
  mockedIsDesktop.mockReturnValue(true)
  try {
    const svc = createGitService('/some/cwd')
    expect(svc).toBeInstanceOf(TauriGitService)
  } finally {
    vi.unstubAllEnvs()
  }
})
```

(The `MODE` override is critical — the factory's first branch returns `MockGitService` when `MODE === 'test'`, so the test must bypass that branch to reach the `isDesktop()` check. The previous `__TAURI_INTERNALS__` test must have had a similar override; preserve it.)

Add a companion test for the Electron / vimeflow case:

```ts
test('returns TauriGitService when isDesktop() is true (via vimeflow)', () => {
  vi.stubEnv('MODE', 'development')
  mockedIsDesktop.mockReturnValue(true)
  try {
    const svc = createGitService('/some/cwd')
    expect(svc).toBeInstanceOf(TauriGitService)
  } finally {
    vi.unstubAllEnvs()
  }
})
```

(Both Tauri and Electron drive the same `isDesktop = true` path; the factory doesn't distinguish them. The test for the Electron case mocks `isDesktop` true the same way and asserts the same outcome.)

- [ ] **Step 4: Run the test**

```bash
npx vitest run src/features/diff/services/gitService.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/diff/services/gitService.ts \
  src/features/diff/services/gitService.test.ts
git commit -m "$(cat <<'EOF'
refactor(diff): route gitService through src/lib/backend

Replaces direct @tauri-apps/api/core import in TauriGitService with
the bridge. Factory's __TAURI_INTERNALS__ check was already swapped
to isDesktop() in the environment rename commit; this commit migrates
the class's invoke import.

Rewrites the factory branching test to mock isDesktop() instead of
manipulating __TAURI_INTERNALS__ directly — the seam the test should
poke. Preserves the MODE=development override (the factory's
MODE='test' branch otherwise short-circuits to MockGitService).
Adds a companion test for the Electron / vimeflow path.

Spec: docs/superpowers/specs/2026-05-14-pr-c-frontend-backend-bridge-design.md §5.3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Migrate `tauriTerminalService.ts` (+ terminalService.ts factory verified)

**Files:**

- Modify: `src/features/terminal/services/tauriTerminalService.ts`
- Modify: `src/features/terminal/services/tauriTerminalService.test.ts`

`TauriTerminalService` has 3 listen callbacks (`pty-data`, `pty-exit`, `pty-error`) and a `UnlistenFn` type import. The terminalService.ts factory was already updated in Task 2.

- [ ] **Step 1: Edit `tauriTerminalService.ts` imports**

```ts
// Before:
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

// After:
import { invoke, listen, type UnlistenFn } from '../../../lib/backend'
```

- [ ] **Step 2: Refactor the 3 listen callbacks in `ensureListeners()`**

**Callback 1 — `pty-data`** (around line 59-69):

```ts
// Before:
const unlistenData = await listen<PtyDataEvent>('pty-data', (event) => {
  const { sessionId, data, offsetStart, byteLen } = event.payload
  // ...
})

// After:
const unlistenData = await listen<PtyDataEvent>('pty-data', (payload) => {
  const { sessionId, data, offsetStart, byteLen } = payload
  // ...
})
```

**Callback 2 — `pty-exit`** (around line 71-74):

```ts
// Before:
const unlistenExit = await listen<PtyExitEvent>('pty-exit', (event) => {
  const { sessionId, code } = event.payload
  this.exitCallbacks.forEach((cb) => cb(sessionId, code))
})

// After:
const unlistenExit = await listen<PtyExitEvent>('pty-exit', (payload) => {
  const { sessionId, code } = payload
  this.exitCallbacks.forEach((cb) => cb(sessionId, code))
})
```

**Callback 3 — `pty-error`** (around line 76-82):

```ts
// Before:
const unlistenError = await listen<PtyErrorEvent>('pty-error', (event) => {
  const { sessionId, message } = event.payload
  this.errorCallbacks.forEach((cb) => cb(sessionId, message))
})

// After:
const unlistenError = await listen<PtyErrorEvent>('pty-error', (payload) => {
  const { sessionId, message } = payload
  this.errorCallbacks.forEach((cb) => cb(sessionId, message))
})
```

- [ ] **Step 3: Sanity grep — no `event.payload` should remain in this file**

```bash
rg -n "event\.payload" src/features/terminal/services/tauriTerminalService.ts
```

Expected: zero hits.

- [ ] **Step 4: Edit `tauriTerminalService.test.ts` mock + fixtures**

Replace the top-level mocks:

```ts
// Before:
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))

// After:
import { invoke, listen } from '../../../lib/backend'

vi.mock('../../../lib/backend', () => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}))
```

Update the `EventCallback` type alias:

```ts
// Before:
type EventCallback = (event: { payload: unknown }) => void

// After:
type EventCallback = (payload: unknown) => void
```

Update the `emitTauriEvent` helper (around line 34):

```ts
// Before:
const emitTauriEvent = (eventName: string, payload: unknown): void => {
  const call = mockedListen.mock.calls.find((c) => c[0] === eventName)
  const cb = call?.[1] as EventCallback
  cb({ payload })
}

// After:
const emitTauriEvent = (eventName: string, payload: unknown): void => {
  const call = mockedListen.mock.calls.find((c) => c[0] === eventName)
  const cb = call?.[1] as EventCallback
  cb(payload)
}
```

(The helper name `emitTauriEvent` is now slightly stale — the emission isn't Tauri-specific anymore — but renaming it is a drive-by; leave it.)

- [ ] **Step 5: Sanity grep**

```bash
rg -n "event\.payload|\{ payload:" src/features/terminal/services/tauriTerminalService.test.ts
```

Expected: zero matches (or, if any remain, legitimate non-listener `payload` literals).

- [ ] **Step 6: Run the test**

```bash
npx vitest run src/features/terminal/services/tauriTerminalService.test.ts
```

Expected: all tests pass.

- [ ] **Step 7: Run all terminal tests to confirm `terminalService.ts` factory still works**

```bash
npx vitest run src/features/terminal/services/
```

Expected: all green. The factory was updated to `isDesktop()` in Task 2; this confirms nothing regressed.

- [ ] **Step 8: Commit**

```bash
git add src/features/terminal/services/tauriTerminalService.ts \
  src/features/terminal/services/tauriTerminalService.test.ts
git commit -m "$(cat <<'EOF'
refactor(terminal): route TauriTerminalService through src/lib/backend

Replaces direct @tauri-apps imports with the bridge. The 3 listener
callbacks (pty-data, pty-exit, pty-error) refactor `event.payload.X`
to `payload.X` since the bridge unwraps Tauri's Event<T> envelope on
the fallback path.

Test fixtures: EventCallback type and emitTauriEvent helper drop the
synthetic { payload: ... } wrapper. (The helper retains its name to
avoid drive-by churn; it now wraps the bridge's listen, not Tauri's.)

terminalService.ts factory line was already swapped to isDesktop()
in the earlier environment rename commit.

Spec: docs/superpowers/specs/2026-05-14-pr-c-frontend-backend-bridge-design.md §5.1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Final verification gate

**Files:** none (verification only).

- [ ] **Step 1: Format + lint sweep**

```bash
npm run format:check
npm run lint
```

Expected: clean. If `format:check` fails on the modified files, run `npm run format` and commit the formatting fix separately as `style(frontend): prettier sweep` (do NOT bundle with feature commits — see `rules/common/pr-scope.md`).

- [ ] **Step 2: Full TS test suite**

```bash
npm run test
```

Expected: all green. Test count should climb by ~16 vs Task 0 baseline (12 in `backend.test.ts` + 4 new cases in `environment.test.ts`).

- [ ] **Step 3: Type-check**

```bash
npm run type-check
```

Expected: clean.

- [ ] **Step 4: Rust smoke (PR-C did not touch Rust; the count must match PR-B baseline)**

```bash
(cd src-tauri && cargo test)
```

Expected: byte-identical test count to the post-PR-B baseline. A diff here means something accidentally tripped the Rust build (e.g., a stray edit elsewhere). Bisect.

- [ ] **Step 5: Coupling-inventory diff vs Task 0 baseline**

```bash
rg -nE "@tauri-apps/api|__TAURI_INTERNALS__" src tests > /tmp/pr-c-final.txt
diff /tmp/pr-c-baseline.txt /tmp/pr-c-final.txt
```

Expected: production hits remain in exactly these files (no others):

- `src/lib/backend.ts` — the bridge's fallback imports (+ JSDoc).
- `src/lib/backend.test.ts` — the Vitest mock targets (+ synthetic Event<T> fixtures in the fallback tests).
- `src/lib/environment.ts` — the `__TAURI_INTERNALS__` probe inside `isDesktop()` + the `Window` ambient declaration.
- `src/lib/environment.test.ts` — fixtures writing `__TAURI_INTERNALS__` to drive `isDesktop()` truthy.

Any other file is a leak — open the file, find the import, route it through the bridge. Do NOT close PR-C with leaks.

- [ ] **Step 6: Manual smoke — `npm run tauri:dev`**

```bash
npm run tauri:dev
```

Walk through:

1. App window opens. Default workspace renders. ✓
2. Default terminal session spawns; prompt is visible. ✓
3. Type in the terminal; characters echo. ✓
4. File Explorer lists the working directory. Click a file → editor shows its content. ✓
5. Diff panel shows current branch + uncommitted status. ✓
6. Spawn a second terminal pane via the existing flow; switch panes; close the second pane. ✓
7. Cmd/Ctrl+Q → clean exit; relaunch → session cache behaves identically to pre-PR-C. ✓

If any step regresses, bisect by reverting the most recent commits one at a time. Bridge-fallback bugs typically surface at step 2 (PTY event flow) or step 5 (git watcher) because those exercise the listener path most aggressively.

- [ ] **Step 7: E2E smoke**

```bash
npm run test:e2e:build
npm run test:e2e
```

Expected: all green. The `e2e-bridge.ts` migration is a one-line import swap; the runtime path through `tauri-driver` + Wry is unchanged. If a spec fails, it's a real regression — do not paper it over by adjusting the spec.

- [ ] **Step 8: Frontend-only Tauri references — should be zero outside the bridge**

```bash
rg -n "from '@tauri-apps/api" src
```

Expected: 2 hits, both in `src/lib/backend.ts` (the fallback's runtime imports). Anything else means a renderer file still imports `@tauri-apps/api` directly — fix before opening the PR.

```bash
rg -n "from '@tauri-apps/api" src/lib/backend.test.ts
```

Expected: 2 hits (the test mocks the same two modules the bridge consumes). These ARE expected — the test exercises the fallback path explicitly.

- [ ] **Step 9: No drive-by formatting in feature commits**

```bash
git log --oneline 6a0a3f2..HEAD
```

(Replace `6a0a3f2` with the pre-Task-1 SHA recorded in Task 0.) Walk the commit list; every commit should be one of the conventional types from spec §5.5's ordering (`feat(frontend)`, `refactor(frontend|terminal|diff|files|agent-status|e2e)`). Any `style(...)` commit must be its own atomic commit, not bundled with a refactor.

If any commit bundles formatting drive-bys with feature work, `git reset --mixed <SHA>` to before it and re-split. (Use `git reflog` to recover if needed.)

- [ ] **Step 10: Spec-claims sanity check**

```bash
grep -nE "^#\[tauri::command\]" src-tauri/src/ -r | wc -l
```

Expected: ~19 (unchanged from PR-B). PR-C does not touch Rust wrappers.

```bash
rg -n "isTauri\b" src tests
```

Expected: zero hits. The rename is complete; no leftover callers.

```bash
rg -n "TauriXxx|DesktopXxx" src 2>&1 | head -5
```

(Sanity check that we did NOT rename the class identifiers — those wait for PR-D.) Expected: `TauriTerminalService`, `TauriGitService`, `TauriFileSystemService` all still exist; `DesktopXxx` symbols do NOT yet exist.

- [ ] **Step 11: Update `CHANGELOG.md` + `CHANGELOG.zh-CN.md`**

Add a top-of-file entry (or extend the active section if one is in flight) describing PR-C's renderer-side IPC seam. Mirror the entry in `CHANGELOG.zh-CN.md`. Cross-link the entry to the relevant `docs/reviews/` patterns if any reviews surface during the PR (defer if none yet).

---

## Final Verification Checklist

After Task 10 completes:

- [ ] `npm run test` test count climbed by ~16 vs Task 0 baseline.
- [ ] `cargo test` count byte-identical to PR-B baseline (PR-C touches no Rust).
- [ ] `rg -n "from '@tauri-apps/api" src` returns exactly 2 hits (both in `src/lib/backend.ts`).
- [ ] `rg -n "isTauri\b" src tests` returns zero hits.
- [ ] `TauriTerminalService`, `TauriGitService`, `TauriFileSystemService` class names + filenames unchanged (PR-D renames).
- [ ] Manual smoke (`npm run tauri:dev`) walks all 7 steps from Task 10 Step 6 without regression.
- [ ] E2E (`npm run test:e2e`) green; harness unchanged.
- [ ] No `style(...)` commits bundled with feature commits.

When everything above is green, open the PR via `/lifeline:request-pr` (or manually):

```bash
git push -u origin <pr-c-branch>
gh pr create \
  --base dev \
  --title "feat(frontend): PR-C — frontend backend bridge (Tauri host stays)" \
  --body "$(cat <<'EOF'
## Summary

PR-C of the 4-PR Tauri → Electron migration. Decouples the React
renderer from `@tauri-apps/api` by introducing `src/lib/backend.ts`
as the runtime-neutral IPC seam. Tauri host stays live through
PR-C — the bridge falls back to `@tauri-apps/api` when
`window.vimeflow` isn't set (PR-D ships the preload that sets it).

## Spec + migration roadmap

- Spec: `docs/superpowers/specs/2026-05-14-pr-c-frontend-backend-bridge-design.md`
- Plan: `docs/superpowers/plans/2026-05-14-pr-c-frontend-backend-bridge.md`
- Roadmap (4-PR index): `docs/superpowers/plans/2026-05-13-electron-rust-backend-migration.md`

## Test plan

- [x] `npm run test` — green (+16 unit tests across `backend.test.ts` and `environment.test.ts`)
- [x] `npm run type-check` + `npm run lint` + `npm run format:check` — clean
- [x] `cargo test` — green; count byte-identical to PR-B baseline
- [x] Manual smoke: `npm run tauri:dev` — all 7 baseline flows work identically
- [x] E2E: `npm run test:e2e` — green; harness unchanged
- [x] Coupling inventory: `@tauri-apps/api` imports remain only in the bridge + bridge tests + environment's `__TAURI_INTERNALS__` probe

## Cross-PR contract

§2 of the spec locks three contracts PR-D consumes:

- §2.1 — `BackendApi { invoke, listen }` surface (PR-D's `window.vimeflow` producer satisfies this)
- §2.4 — `isDesktop()` OR-detection (correct under both Tauri-today and Electron-PR-D)
- §2.5 — PR-D's bridge edit minimality: 4-to-6-line delete of the fallback imports + branches

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(Adjust `--base dev` if the integration branch uses a different name.)

After PR-C merges to `dev`:

- The PR-D planner session can start. PR-D consumes §2.1, §2.4, and §2.5 of this PR's spec.
- Local dev continues against Tauri (`npm run tauri:dev`) — PR-C didn't change the desktop shell.
- `npm run test` test count climbed by ~16; `cargo test` count unchanged.

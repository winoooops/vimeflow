# PR-D1 — Electron shell + sidecar wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Electron as a parallel desktop runtime to Tauri. Spawn the existing `vimeflow-backend` sidecar from `electron/main.ts`, expose `window.vimeflow.invoke` / `.listen` via `electron/preload.ts`'s `contextBridge`, and let PR-C's renderer bridge auto-route through the sidecar IPC path. Tauri stays alive — `npm run tauri:dev` and the new `npm run electron:dev` both work side-by-side.

**Architecture:** Three new files under `electron/`: a `Sidecar` deep module (`sidecar.ts`) owning the child process, LSP-framed stdout reader, pending-request map, and listener registry; a preload script (`preload.ts`) exposing a 2-method `contextBridge` allowlist; a main process (`main.ts`) wiring `ipcMain.handle` to `sidecar.invoke` (envelope-wrapped, never rethrows) and `sidecar.onEvent` to `webContents.send`. Build path: `vite-plugin-electron/simple` gated by `mode === 'electron'` produces `dist-electron/main.cjs` + `dist-electron/preload.cjs` (CommonJS so Electron loads them under the root `"type": "module"` package).

**Tech Stack:** Electron (latest stable major), `vite-plugin-electron` (the `/simple` API), TypeScript 5, Vitest. No new renderer-side dependencies. The sidecar binary `vimeflow-backend` lands unchanged from PR-B.

**Spec:** `docs/superpowers/specs/2026-05-14-pr-d1-electron-shell-sidecar-wiring-design.md`

**Migration roadmap:** `docs/superpowers/plans/2026-05-13-electron-rust-backend-migration.md`. This plan implements PR-D1 (Tasks 1 + 7 of that roadmap). PR-D2 ships E2E driver swap; PR-D3 ships Tauri runtime removal + packaging smoke.

---

## File Structure

### New (6 files)

- `electron/main.ts` — Electron entry. App lifecycle, `BrowserWindow`, sidecar orchestration, `ipcMain.handle('backend:invoke')` with envelope, event fan-out to `webContents.send('backend:event')`.
- `electron/preload.ts` — Sole `contextBridge.exposeInMainWorld('vimeflow', { invoke, listen })` call. Unwraps the `{ ok, result, error }` envelope and throws bare `error` strings.
- `electron/sidecar.ts` — Deep module. Owns child process, frame codec (LSP `Content-Length` with PR-B parity), pending-request map, listener registry, exit/spawn-error/stderr handling, `shutdown()`.
- `electron/sidecar.test.ts` — Vitest unit suite. 16 tests covering codec, invoke/response, exit/disabled, events, fatal limits, spawn error, stderr drain, shutdown.
- `electron/ipc-channels.ts` — Two channel-name constants (`BACKEND_INVOKE`, `BACKEND_EVENT`).
- `electron/tsconfig.json` — Stand-alone CommonJS `noEmit` config (IDE + `tsc -p electron/tsconfig.json` for type-check).

### Modified (5 files)

- `package.json` — Add devDeps (`electron`, `vite-plugin-electron`), `main: "dist-electron/main.cjs"`, scripts (`electron:dev`, `backend:build`), modify `type-check` to chain electron tsconfig.
- `vite.config.ts` — Additive: import + conditionally append `vite-plugin-electron/simple` plugin under `mode === 'electron'`; add `server.strictPort` and `server.watch.ignored` entry for `dist-electron`. ALL existing plugins/keys preserved verbatim.
- `.gitignore` — Add `dist-electron/`.
- `vitest.config.ts` — Add `electron/main.ts` and `electron/preload.ts` to `coverage.exclude`.
- `package-lock.json` — Auto-updated by `npm install`. Committed alongside `package.json`.

### Files NOT touched

- `src/**` (renderer is unchanged; PR-C's bridge already detects `window.vimeflow`).
- `src-tauri/**` (Rust unchanged; sidecar binary already built by PR-B's `[[bin]]`).
- `tests/e2e/**` (Tauri driver stays through PR-D2).
- `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` (Tauri config stays through PR-D3).
- `tsconfig.json` (root) (its `include: ["src"]` already excludes `electron/**`).
- `eslint.config.ts` (no new lint rules in PR-D1).

---

## Task 0: Baseline Verification

**Files:** none.

- [ ] **Step 1: Confirm working tree is clean and on the correct branch**

```bash
cd /home/will/projects/vimeflow
git status
git branch --show-current
```

Expected: `nothing to commit, working tree clean`. Branch: `dev` (or `feat/pr-d1-electron-shell` if a feature branch is preferred — create it BEFORE Task 1 via `git checkout -b feat/pr-d1-electron-shell`).

- [ ] **Step 2: Confirm Vitest + type-check + lint are green**

```bash
npm run test
npm run type-check
npm run lint
npm run format:check
```

Expected: all green. Record the Vitest test count — PR-D1 adds 16 new cases in `electron/sidecar.test.ts` (12 from spec §4.7 covering codec / invoke / exit / events / fatal limits / spawn error, plus 1 stderr-drain assertion and 3 shutdown cases), so the post-PR-D1 count should climb by exactly 16.

- [ ] **Step 3: Confirm Rust tests are green (smoke; Rust unchanged in PR-D1)**

```bash
(cd src-tauri && cargo test)
```

Expected: all green. PR-D1 does not touch `src-tauri/**`, so the count must match the post-PR-C baseline byte-for-byte.

- [ ] **Step 4: Confirm the sidecar binary builds**

```bash
(cd src-tauri && cargo build --bin vimeflow-backend)
ls -la src-tauri/target/debug/vimeflow-backend
```

Expected: clean build, binary present. PR-D1 spawns this binary from Electron main — if cargo build is broken, stop and fix before proceeding.

- [ ] **Step 5: Inventory existing Tauri coupling for diff comparison at Task 15**

```bash
rg -n "@tauri-apps/api|__TAURI_INTERNALS__" src tests > /tmp/pr-d1-baseline.txt
wc -l /tmp/pr-d1-baseline.txt
```

Expected: hits in roughly the post-PR-C set (12 files — see PR-C plan Task 0 Step 4 for the list). PR-D1 does NOT remove these hits — that's PR-D3. The diff for this PR must leave this count UNCHANGED.

---

## Task 1: package.json — Electron devDeps, `main` field, scripts

**Files:**

- Modify: `package.json`
- Modify (auto): `package-lock.json`

- [ ] **Step 1: Install `electron` and `vite-plugin-electron` as devDependencies**

```bash
npm install --save-dev electron vite-plugin-electron
```

This adds two entries under `devDependencies` and regenerates `package-lock.json`. Pin to whatever the latest stable Electron major resolves to; the lockfile records the exact version.

- [ ] **Step 2: Add the top-level `"main"` field**

Edit `package.json`. Add `"main": "dist-electron/main.cjs"` next to the existing `"type": "module"` entry:

```jsonc
{
  "name": "vibm",
  "version": "0.1.0",
  // …
  "type": "module",
  "main": "dist-electron/main.cjs", // ADDED
  "engines": { "node": ">=22" },
  // …
}
```

The file does not exist yet; Electron only reads `main` at launch time, so a missing target is fine during plan iteration. `electron:dev` (Task 13) will produce it.

- [ ] **Step 3: Add the new scripts**

In the existing `"scripts": { ... }` block, add two new keys (alphabetize-friendly placement near `tauri:dev`):

```jsonc
"scripts": {
  // …existing entries…
  "electron:dev": "npm run backend:build && vite --mode electron",
  "backend:build": "cd src-tauri && cargo build --bin vimeflow-backend",
  // …existing entries…
}
```

Leave `tauri:dev` and `tauri:build` untouched.

- [ ] **Step 4: Confirm `npm install` left the project healthy**

```bash
npm install      # idempotent verification
npm run dev      # renderer dev server should still come up on http://localhost:5173
```

Press Ctrl+C to stop the dev server. The renderer must launch unmodified — `vite` is unchanged at this task.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(deps): add electron + vite-plugin-electron devDeps for PR-D1

Adds the desktop runtime and bundler dependencies that PR-D1's
electron/ files will consume. Also adds the `main` field pointing at
the (not-yet-built) dist-electron/main.cjs and two new scripts:
- electron:dev: build sidecar binary, then run vite --mode electron
- backend:build: cargo build --bin vimeflow-backend

Tauri scripts (tauri:dev, tauri:build) are untouched.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: electron/tsconfig.json (config-only; no type-check change yet)

**Files:**

- Create: `electron/tsconfig.json`

Note: the `npm run type-check` script is updated in Task 3, not
here, because `tsc -p electron/tsconfig.json` errors with TS18003
("No inputs were found") when the `electron/` directory has no `.ts`
files. Task 3 creates `ipc-channels.ts` and ships the script
modification + verification together.

- [ ] **Step 1: Create the directory**

```bash
mkdir -p electron
```

- [ ] **Step 2: Create `electron/tsconfig.json` (stand-alone, CommonJS)**

```jsonc
{
  "compilerOptions": {
    "target": "es2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["es2022"],
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "types": ["node"],
  },
  "include": ["./**/*.ts"],
}
```

This does NOT extend `../tsconfig.json` — the root uses `moduleResolution: "bundler"` which is incompatible with `commonjs`. The `noEmit` keeps tsc check-only; actual bundling is done by `vite-plugin-electron` (Task 13).

- [ ] **Step 3: Commit (config only — script change comes in Task 3)**

```bash
git add electron/tsconfig.json
git commit -m "$(cat <<'EOF'
chore(electron): add stand-alone CommonJS tsconfig for electron/

Stand-alone CommonJS noEmit config (the root tsconfig's
moduleResolution: 'bundler' is incompatible with module: 'commonjs'
that Electron main/preload need).

The `npm run type-check` script is NOT modified in this commit —
running `tsc -p electron/tsconfig.json` against an empty directory
errors with TS18003. Task 3 adds the first .ts file
(electron/ipc-channels.ts) and ships the type-check chain change
together so verification succeeds atomically.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: electron/ipc-channels.ts + extend type-check script

**Files:**

- Create: `electron/ipc-channels.ts`
- Modify: `package.json`

- [ ] **Step 1: Create the file**

```ts
// electron/ipc-channels.ts
//
// Shared channel names used by electron/main.ts (sender) and
// electron/preload.ts (receiver / forwarder). Centralized to avoid
// stringly-typed channel mismatch.

export const BACKEND_INVOKE = 'backend:invoke'
export const BACKEND_EVENT = 'backend:event'
```

- [ ] **Step 2: Update the `type-check` script**

Edit `package.json`. Change the existing `type-check` script from
`"tsc -b"` to:

```jsonc
"type-check": "tsc -b && tsc -p electron/tsconfig.json"
```

This makes `npm run type-check` cover the renderer (root tsconfig
project references) AND the electron files. `ipc-channels.ts` is the
one input needed to avoid TS18003.

- [ ] **Step 3: Verify type-check passes**

```bash
npm run type-check
```

Expected: clean. Both passes run; the electron pass finds
`ipc-channels.ts` and succeeds.

- [ ] **Step 4: Commit**

```bash
git add electron/ipc-channels.ts package.json
git commit -m "$(cat <<'EOF'
feat(electron): add ipc-channels + chain type-check to cover electron/

BACKEND_INVOKE ('backend:invoke') and BACKEND_EVENT ('backend:event')
are imported by both main.ts and preload.ts so the channel names
have one source of truth.

Modifies `npm run type-check` to chain
`tsc -b && tsc -p electron/tsconfig.json` so every .ts file in the
repo is type-checked exactly once. ipc-channels.ts is the one
electron/ input that prevents TS18003 'No inputs were found'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: electron/sidecar.ts — skeleton (types + unimplemented factories)

**Files:**

- Create: `electron/sidecar.ts`

This task creates the public surface so subsequent TDD tasks can import the types. Implementations throw `not implemented` so the first test in Task 5 has something to fail against.

- [ ] **Step 1: Create the skeleton file**

```ts
// electron/sidecar.ts
//
// Owns the child process running vimeflow-backend, the LSP-framed
// stdout reader, the pending-request map, the listener registry,
// and the exit/spawn-error/stderr-drain machinery. See spec §4 for
// the full contract.

export interface Sidecar {
  invoke<T>(method: string, args?: Record<string, unknown>): Promise<T>
  onEvent(handler: (event: string, payload: unknown) => void): () => void
  shutdown(): Promise<void>
}

export interface SidecarOptions {
  binary: string
  appDataDir: string
  stderr?: NodeJS.WritableStream
}

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

export interface SidecarDeps {
  spawnFn: (binary: string, args: string[]) => SpawnedChild
}

export const createSidecar = (
  _options: SidecarOptions & SidecarDeps
): Sidecar => {
  throw new Error('not implemented')
}

export const spawnSidecar = (_options: SidecarOptions): Sidecar => {
  throw new Error('not implemented')
}
```

- [ ] **Step 2: Verify type-check passes**

```bash
npm run type-check
```

Expected: clean. The unused-parameter rule does not flag `_options`-prefixed params per repo convention.

- [ ] **Step 3: Commit**

```bash
git add electron/sidecar.ts
git commit -m "$(cat <<'EOF'
feat(electron): scaffold Sidecar interfaces + unimplemented factories

Public surface: Sidecar interface (invoke / onEvent / shutdown),
SidecarOptions (binary, appDataDir, optional stderr), SpawnedChild
(narrow surface that both real spawn return values and test mocks
satisfy), SidecarDeps (test-only spawnFn injection).

createSidecar() and spawnSidecar() throw 'not implemented' so the
TDD tasks in PR-D1 have a failing-by-default starting point.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: TDD — Frame codec (encode + decoder state machine)

**Files:**

- Modify: `electron/sidecar.ts`
- Create: `electron/sidecar.test.ts`

This task implements the LSP `Content-Length` framing per spec §4.3 / §4.4. TDD: write failing tests first, watch them fail, implement, watch pass.

- [ ] **Step 1: Write the failing tests in `electron/sidecar.test.ts`**

```ts
// electron/sidecar.test.ts
import { describe, test, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createSidecar, type SpawnedChild } from './sidecar'

class MockChildProcess extends EventEmitter implements SpawnedChild {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr: PassThrough | null = new PassThrough()
  readonly pid = 12345
  kill = vi.fn().mockReturnValue(true)
}

const makeSidecar = (): {
  mock: MockChildProcess
  sidecar: ReturnType<typeof createSidecar>
} => {
  const mock = new MockChildProcess()
  const sidecar = createSidecar({
    binary: '/fake/vimeflow-backend',
    appDataDir: '/fake/data',
    spawnFn: () => mock,
  })
  return { mock, sidecar }
}

const encodeFrame = (body: object): Buffer => {
  const json = Buffer.from(JSON.stringify(body), 'utf8')
  const header = Buffer.from(`Content-Length: ${json.length}\r\n\r\n`, 'ascii')
  return Buffer.concat([header, json])
}

describe('Sidecar — frame codec', () => {
  test('1. response frame roundtrip resolves matching invoke', async () => {
    const { mock, sidecar } = makeSidecar()
    const promise = sidecar.invoke<{ ok: string }>('list_sessions')
    // The sidecar wrote id "1" — assert by responding with that id.
    mock.stdout.write(
      encodeFrame({
        kind: 'response',
        id: '1',
        ok: true,
        result: { ok: 'yes' },
      })
    )
    await expect(promise).resolves.toEqual({ ok: 'yes' })
  })

  test('2. partial-frame buffering across two stdout writes', async () => {
    const { mock, sidecar } = makeSidecar()
    const promise = sidecar.invoke<{ x: number }>('git_status')
    const full = encodeFrame({
      kind: 'response',
      id: '1',
      ok: true,
      result: { x: 42 },
    })
    const mid = Math.floor(full.length / 2)
    let resolved = false
    // eslint-disable-next-line promise/prefer-await-to-then
    promise
      .then(() => {
        resolved = true
      })
      .catch(() => {})
    mock.stdout.write(full.subarray(0, mid))
    await new Promise((r) => setImmediate(r))
    expect(resolved).toBe(false)
    mock.stdout.write(full.subarray(mid))
    await expect(promise).resolves.toEqual({ x: 42 })
    expect(resolved).toBe(true)
  })

  test('3. two frames concatenated in one stdout write dispatch in order', async () => {
    const { mock, sidecar } = makeSidecar()
    const p1 = sidecar.invoke<number>('a')
    const p2 = sidecar.invoke<number>('b')
    const f1 = encodeFrame({ kind: 'response', id: '1', ok: true, result: 1 })
    const f2 = encodeFrame({ kind: 'response', id: '2', ok: true, result: 2 })
    mock.stdout.write(Buffer.concat([f1, f2]))
    await expect(p1).resolves.toBe(1)
    await expect(p2).resolves.toBe(2)
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

```bash
npx vitest run electron/sidecar.test.ts
```

Expected: 3 failures with `Error: not implemented` from `createSidecar`.

- [ ] **Step 3: Implement `createSidecar` with encode + decoder state machine**

Replace `electron/sidecar.ts` with a real implementation. The file should end up matching the surface contract in spec §4.1 — invoke writes a request frame, dispatcher reads response frames and resolves the pending promise:

```ts
// electron/sidecar.ts
import { spawn as childSpawn } from 'node:child_process'

export interface Sidecar {
  invoke<T>(method: string, args?: Record<string, unknown>): Promise<T>
  onEvent(handler: (event: string, payload: unknown) => void): () => void
  shutdown(): Promise<void>
}

export interface SidecarOptions {
  binary: string
  appDataDir: string
  stderr?: NodeJS.WritableStream
}

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

export interface SidecarDeps {
  spawnFn: (binary: string, args: string[]) => SpawnedChild
}

const MAX_FRAME_BYTES = 16 * 1024 * 1024
const MAX_HEADER_SECTION_BYTES = 1024 * 1024
const MAX_HEADER_LINE_BYTES = 8 * 1024

interface Pending {
  resolve: (value: unknown) => void
  reject: (reason: string) => void
}

const encode = (body: object): Buffer => {
  const json = Buffer.from(JSON.stringify(body), 'utf8')
  const header = Buffer.from(`Content-Length: ${json.length}\r\n\r\n`, 'ascii')
  return Buffer.concat([header, json])
}

export const createSidecar = (
  options: SidecarOptions & SidecarDeps
): Sidecar => {
  const errStream = options.stderr ?? process.stderr
  const child = options.spawnFn(options.binary, [
    '--app-data-dir',
    options.appDataDir,
  ])

  const pending = new Map<string, Pending>()
  const listeners = new Set<(event: string, payload: unknown) => void>()
  let buffer = Buffer.alloc(0)
  let nextId = 1
  let disabled = false

  const disable = (reason: string): void => {
    if (disabled) return
    disabled = true
    for (const p of pending.values()) p.reject(reason)
    pending.clear()
  }

  const dispatch = (frame: unknown): void => {
    if (typeof frame !== 'object' || frame === null) return
    const f = frame as Record<string, unknown>
    if (f.kind === 'response') {
      const id = f.id
      if (typeof id !== 'string' || !('ok' in f)) {
        disable('malformed response frame: missing id or ok')
        return
      }
      const entry = pending.get(id)
      if (!entry) {
        errStream.write(`[sidecar] dropping response for unknown id ${id}\n`)
        return
      }
      pending.delete(id)
      if (f.ok === true) {
        if (!('result' in f)) {
          entry.reject('malformed response frame: missing result')
          return
        }
        entry.resolve(f.result)
        return
      }
      if (f.ok === false) {
        if (!('error' in f)) {
          entry.reject('malformed response frame: missing error')
          return
        }
        if (typeof f.error !== 'string') {
          entry.reject('malformed response frame: error not a string')
          return
        }
        entry.reject(f.error)
        return
      }
      entry.reject('malformed response frame: ambiguous ok flag')
      return
    }
    if (f.kind === 'event') {
      const eventName = f.event
      if (typeof eventName !== 'string') return
      for (const l of listeners) l(eventName, f.payload)
      return
    }
    errStream.write(`[sidecar] unknown frame kind: ${JSON.stringify(f.kind)}\n`)
  }

  const processBuffer = (): void => {
    while (!disabled) {
      const headerEnd = buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) {
        if (buffer.length > MAX_HEADER_SECTION_BYTES) {
          disable('header section exceeded MAX_HEADER_SECTION_BYTES')
        }
        return
      }
      const headerText = buffer.subarray(0, headerEnd).toString('ascii')
      const headerLines = headerText.split('\r\n')
      if (
        headerLines.some(
          (line) => Buffer.byteLength(line, 'ascii') > MAX_HEADER_LINE_BYTES
        )
      ) {
        disable('header line exceeds MAX_HEADER_LINE_BYTES (8 KiB)')
        return
      }
      const match = /Content-Length:\s*(\d+)/i.exec(headerText)
      if (!match) {
        disable('missing or malformed Content-Length header')
        return
      }
      const length = Number(match[1])
      if (!Number.isFinite(length) || length > MAX_FRAME_BYTES) {
        disable(`frame too large or invalid: ${match[1]}`)
        return
      }
      const bodyStart = headerEnd + 4
      const bodyEnd = bodyStart + length
      if (buffer.length < bodyEnd) return // wait for more bytes
      const bodyBuf = buffer.subarray(bodyStart, bodyEnd)
      buffer = buffer.subarray(bodyEnd)
      let frame: unknown
      try {
        frame = JSON.parse(bodyBuf.toString('utf8'))
      } catch {
        disable('frame body is not valid JSON')
        return
      }
      dispatch(frame)
    }
  }

  child.stdout.on('data', (chunk: Buffer) => {
    if (disabled) return
    buffer = Buffer.concat([buffer, chunk])
    processBuffer()
  })

  return {
    invoke: <T>(method, args) => {
      return new Promise<T>((resolve, reject) => {
        if (disabled) {
          reject('backend unavailable')
          return
        }
        const id = String(nextId++)
        pending.set(id, {
          resolve: resolve as (v: unknown) => void,
          reject,
        })
        const frame = encode({
          kind: 'request',
          id,
          method,
          params: args ?? {},
        })
        child.stdin.write(frame)
      })
    },
    onEvent: (handler) => {
      listeners.add(handler)
      return () => {
        listeners.delete(handler)
      }
    },
    shutdown: () => Promise.resolve(), // implemented in Task 10
  }
}

export const spawnSidecar = (options: SidecarOptions): Sidecar =>
  createSidecar({ ...options, spawnFn: childSpawn as SidecarDeps['spawnFn'] })
```

- [ ] **Step 4: Re-run the tests and verify they pass**

```bash
npx vitest run electron/sidecar.test.ts
```

Expected: 3/3 pass.

- [ ] **Step 5: Verify nothing else regressed**

```bash
npm run type-check
npm run test
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add electron/sidecar.ts electron/sidecar.test.ts
git commit -m "$(cat <<'EOF'
feat(electron/sidecar): implement LSP frame codec + invoke roundtrip

TDD task — adds 3 tests covering response-frame roundtrip,
partial-frame buffering, and concatenated-frames-in-one-write
dispatch.

Implementation:
- encode() wraps JSON body in Content-Length header (PR-B parity)
- incremental decoder state machine with MAX_FRAME_BYTES (16 MiB)
  and MAX_HEADER_SECTION_BYTES (1 MiB) caps
- invoke() writes request frame, stores resolve/reject in pending map
- dispatch routes 'response' frames to matching pending entries

shutdown() and onEvent listener registry are stubs at this task;
filled in by Tasks 8 (events) and 10 (shutdown).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: TDD — invoke error path (bare-string rejection)

**Files:**

- Modify: `electron/sidecar.test.ts`
- Modify: `electron/sidecar.ts` (no change expected — dispatch already handles `ok: false`)

- [ ] **Step 1: Add tests 4 and 5**

Append to `electron/sidecar.test.ts`:

```ts
describe('Sidecar — invoke result/error', () => {
  test('4. multiple resolutions clean up pending entries between calls', async () => {
    const { mock, sidecar } = makeSidecar()
    const p1 = sidecar.invoke<number>('m')
    mock.stdout.write(
      encodeFrame({ kind: 'response', id: '1', ok: true, result: 1 })
    )
    await expect(p1).resolves.toBe(1)

    const p2 = sidecar.invoke<number>('m')
    mock.stdout.write(
      encodeFrame({ kind: 'response', id: '2', ok: true, result: 2 })
    )
    await expect(p2).resolves.toBe(2)
  })

  test('5. ok:false response rejects with bare error string (no Error wrap)', async () => {
    const { mock, sidecar } = makeSidecar()
    const promise = sidecar.invoke('write_pty', { id: 'missing' })
    mock.stdout.write(
      encodeFrame({
        kind: 'response',
        id: '1',
        ok: false,
        error: 'PTY session not found',
      })
    )
    await expect(promise).rejects.toBe('PTY session not found')
  })
})
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run electron/sidecar.test.ts
```

Expected: 5/5 pass. (The Task 5 dispatcher already handles `ok: false` with bare-string rejection.)

- [ ] **Step 3: Commit**

```bash
git add electron/sidecar.test.ts
git commit -m "$(cat <<'EOF'
test(electron/sidecar): cover bare-string rejection + pending cleanup

Adds 2 tests verifying that consecutive invokes are not cross-talking
in the pending map, and that ok:false responses reject with the bare
error string (no Error wrap) so PR-C's bridge rejection contract is
preserved end to end.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: TDD — Exit handling + post-exit invoke

**Files:**

- Modify: `electron/sidecar.test.ts`
- Modify: `electron/sidecar.ts`

- [ ] **Step 1: Add tests 6 and 7**

Append to `electron/sidecar.test.ts`:

```ts
describe('Sidecar — exit handling', () => {
  test('6. unexpected exit drains pending with sidecar exited unexpectedly', async () => {
    const { mock, sidecar } = makeSidecar()
    const p1 = sidecar.invoke('a')
    const p2 = sidecar.invoke('b')
    mock.emit('exit', 1, null)
    await expect(p1).rejects.toBe('sidecar exited unexpectedly')
    await expect(p2).rejects.toBe('sidecar exited unexpectedly')
  })

  test('7. invoke after exit rejects with backend unavailable + does not write', async () => {
    const { mock, sidecar } = makeSidecar()
    mock.emit('exit', 1, null)
    const stdinSpy = vi.spyOn(mock.stdin, 'write')
    await expect(sidecar.invoke('m')).rejects.toBe('backend unavailable')
    expect(stdinSpy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests and verify failures**

```bash
npx vitest run electron/sidecar.test.ts
```

Expected: tests 6 and 7 fail — there is no `child.on('exit')` registration yet.

- [ ] **Step 3: Add the exit handler to `createSidecar`**

In `electron/sidecar.ts`, inside `createSidecar` after the `child.stdout.on('data', ...)` block and before the `return { ... }`, add:

```ts
let cooperativeShutdown = false
child.on('exit', () => {
  if (cooperativeShutdown) return
  disable('sidecar exited unexpectedly')
})
```

Hoist the `cooperativeShutdown` flag so Task 10's `shutdown()` can flip it before closing stdin.

- [ ] **Step 4: Re-run the tests**

```bash
npx vitest run electron/sidecar.test.ts
```

Expected: 7/7 pass.

- [ ] **Step 5: Commit**

```bash
git add electron/sidecar.ts electron/sidecar.test.ts
git commit -m "$(cat <<'EOF'
feat(electron/sidecar): drain pending invokes on unexpected child exit

TDD — 2 tests covering pending-map drain on unexpected exit and
backend-unavailable rejection for post-exit invokes (with stdin
write spy confirming no protocol bytes are emitted after disable).

Implementation adds child.on('exit') handler gated by a
`cooperativeShutdown` flag (Task 10's shutdown() will flip the flag
before clean-EOF close).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: TDD — onEvent + listener teardown

**Files:**

- Modify: `electron/sidecar.test.ts`
- Modify: `electron/sidecar.ts` (no change needed — already implemented in Task 5)

- [ ] **Step 1: Add tests 8 and 9**

Append to `electron/sidecar.test.ts`:

```ts
describe('Sidecar — onEvent', () => {
  test('8. event frame fans out to every registered listener in order', () => {
    const { mock, sidecar } = makeSidecar()
    const calls: Array<[string, unknown]> = []
    sidecar.onEvent((e, p) => calls.push([e, p]))
    sidecar.onEvent((e, p) => calls.push([e, p]))
    mock.stdout.write(
      encodeFrame({
        kind: 'event',
        event: 'pty-data',
        payload: { sessionId: 's1', data: 'hi' },
      })
    )
    expect(calls).toEqual([
      ['pty-data', { sessionId: 's1', data: 'hi' }],
      ['pty-data', { sessionId: 's1', data: 'hi' }],
    ])
  })

  test('9. listener teardown is idempotent and stops further deliveries', () => {
    const { mock, sidecar } = makeSidecar()
    const cb = vi.fn()
    const unlisten = sidecar.onEvent(cb)
    unlisten()
    unlisten() // second call must NOT throw
    mock.stdout.write(
      encodeFrame({ kind: 'event', event: 'pty-data', payload: {} })
    )
    expect(cb).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests**

```bash
npx vitest run electron/sidecar.test.ts
```

Expected: 9/9 pass (the Task 5 `dispatch` and `onEvent` registry already handle this).

- [ ] **Step 3: Commit**

```bash
git add electron/sidecar.test.ts
git commit -m "$(cat <<'EOF'
test(electron/sidecar): cover onEvent fan-out + listener teardown

Adds 2 tests verifying that registered listeners receive
(event, payload) in registration order and that unsubscribe is
idempotent + stops delivery.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: TDD — Fatal codec limits + spawn error + stderr drain

**Files:**

- Modify: `electron/sidecar.test.ts`
- Modify: `electron/sidecar.ts`

- [ ] **Step 1: Add tests 10, 11, 12 and the stderr drain test**

Append to `electron/sidecar.test.ts`:

```ts
describe('Sidecar — fatal limits + spawn errors + stderr', () => {
  test('10. oversize Content-Length disables sidecar', async () => {
    const { mock, sidecar } = makeSidecar()
    // 17 MB exceeds MAX_FRAME_BYTES (16 MiB)
    mock.stdout.write(Buffer.from('Content-Length: 17000000\r\n\r\n', 'ascii'))
    await expect(sidecar.invoke('m')).rejects.toBe('backend unavailable')
  })

  test('11. spawn error rejects pending invoke with bare string', async () => {
    const mock = new MockChildProcess()
    const sidecar = createSidecar({
      binary: '/missing/bin',
      appDataDir: '/fake',
      spawnFn: () => mock,
    })
    const p = sidecar.invoke('m')
    queueMicrotask(() =>
      mock.emit('error', new Error('ENOENT: vimeflow-backend'))
    )
    await expect(p).rejects.toBe(
      'sidecar spawn failed: ENOENT: vimeflow-backend'
    )
  })

  test('12. header section overflow without \\r\\n\\r\\n disables sidecar', async () => {
    const { mock, sidecar } = makeSidecar()
    // 2 MiB of bytes with no \r\n\r\n
    mock.stdout.write(Buffer.alloc(2 * 1024 * 1024, 0x61)) // 'a' fill
    await expect(sidecar.invoke('m')).rejects.toBe('backend unavailable')
  })

  test('12b. oversize single header line disables sidecar', async () => {
    const { mock, sidecar } = makeSidecar()
    // A single header line of 9 KiB exceeds MAX_HEADER_LINE_BYTES (8 KiB)
    const longLine = 'X-Long: ' + 'a'.repeat(9 * 1024)
    mock.stdout.write(Buffer.from(longLine + '\r\n\r\n', 'ascii'))
    await expect(sidecar.invoke('m')).rejects.toBe('backend unavailable')
  })

  test('13. child stderr is drained continuously to the configured stream', async () => {
    const mock = new MockChildProcess()
    const stderrBuf: Buffer[] = []
    const stderrSink: NodeJS.WritableStream = {
      write: (chunk: string | Buffer) => {
        stderrBuf.push(Buffer.from(chunk))
        return true
      },
    } as unknown as NodeJS.WritableStream
    createSidecar({
      binary: '/fake',
      appDataDir: '/fake',
      stderr: stderrSink,
      spawnFn: () => mock,
    })
    mock.stderr!.write('rust log line\n')
    await new Promise((r) => setImmediate(r)) // let the data event fire
    expect(Buffer.concat(stderrBuf).toString('utf8')).toBe('rust log line\n')
  })
})
```

- [ ] **Step 2: Run the tests and verify failures**

```bash
npx vitest run electron/sidecar.test.ts
```

Expected: test 11 fails (no `child.on('error')` handler yet), test 13 fails (no stderr drain yet). Tests 10 and 12 may pass if Task 5's decoder already enforces the caps — verify by reading the failure output.

- [ ] **Step 3: Add stderr drain + spawn-error handler**

In `electron/sidecar.ts`, inside `createSidecar` between the `child` declaration and the `child.stdout.on(...)` block, add:

```ts
// Stderr drainage — without this the pipe buffer fills (~64 KB on
// Linux) and env_logger writes block the sidecar.
child.stderr?.on('data', (chunk: Buffer) => {
  errStream.write(chunk)
})

child.on('error', (err: Error) => {
  disable(`sidecar spawn failed: ${err.message}`)
})
```

Confirm Task 5's decoder already raises `frame too large or invalid` for `Content-Length` exceeding `MAX_FRAME_BYTES` (test 10) and raises `header section exceeded MAX_HEADER_SECTION_BYTES` when no `\r\n\r\n` arrives within 1 MiB (test 12). If either case is missing, add the missing branch in `processBuffer` before re-running.

- [ ] **Step 4: Re-run the tests**

```bash
npx vitest run electron/sidecar.test.ts
```

Expected: 13/13 pass.

- [ ] **Step 5: Commit**

```bash
git add electron/sidecar.ts electron/sidecar.test.ts
git commit -m "$(cat <<'EOF'
feat(electron/sidecar): fatal codec limits, spawn-error, stderr drain

TDD — 4 tests covering:
- 16 MiB MAX_FRAME_BYTES enforcement (oversize Content-Length)
- spawn ENOENT path rejects pending invoke with bare-string error
- 1 MiB MAX_HEADER_SECTION_BYTES enforcement
- continuous child.stderr → configured stream drainage

Without stderr drain, env_logger output fills the pipe buffer and
blocks the sidecar. Without spawn-error handling, ENOENT (missing
binary) leaves invokes hanging instead of failing fast.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: TDD — Sidecar.shutdown() (clean EOF → 5500 ms → SIGTERM → SIGKILL)

**Files:**

- Modify: `electron/sidecar.test.ts`
- Modify: `electron/sidecar.ts`

- [ ] **Step 1: Add shutdown tests**

Append to `electron/sidecar.test.ts`:

```ts
describe('Sidecar — shutdown', () => {
  test('14. shutdown drains pending invokes with app quitting', async () => {
    const { mock, sidecar } = makeSidecar()
    const p = sidecar.invoke('m')
    void sidecar.shutdown()
    await expect(p).rejects.toBe('app quitting')
  })

  test('15. shutdown closes stdin and resolves on cooperative exit', async () => {
    vi.useFakeTimers()
    const { mock, sidecar } = makeSidecar()
    const endSpy = vi.spyOn(mock.stdin, 'end')
    const shutdownPromise = sidecar.shutdown()
    expect(endSpy).toHaveBeenCalled()
    // simulate cooperative exit
    mock.emit('exit', 0, null)
    await expect(shutdownPromise).resolves.toBeUndefined()
    vi.useRealTimers()
  })

  test('16. shutdown escalates to SIGTERM then SIGKILL after timeout', async () => {
    vi.useFakeTimers()
    const { mock, sidecar } = makeSidecar()
    const shutdownPromise = sidecar.shutdown()
    // do not emit exit — sidecar is non-responsive
    vi.advanceTimersByTime(5500)
    expect(mock.kill).toHaveBeenCalledWith('SIGTERM')
    vi.advanceTimersByTime(2000)
    expect(mock.kill).toHaveBeenCalledWith('SIGKILL')
    // resolve so the test does not hang
    mock.emit('exit', null, 'SIGKILL')
    await expect(shutdownPromise).resolves.toBeUndefined()
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Run the tests and verify failures**

```bash
npx vitest run electron/sidecar.test.ts
```

Expected: tests 14, 15, 16 fail (current `shutdown` is `Promise.resolve()`).

- [ ] **Step 3: Implement `shutdown()`**

Replace the `shutdown: () => Promise.resolve(),` line in `createSidecar`'s return value with:

```ts
shutdown: () => {
  return new Promise<void>((resolveShutdown) => {
    cooperativeShutdown = true
    // Drain pending so callers' promises settle.
    for (const p of pending.values()) p.reject('app quitting')
    pending.clear()

    let resolved = false
    const finalize = (): void => {
      if (resolved) return
      resolved = true
      resolveShutdown()
    }

    child.on('exit', finalize)

    // Close stdin → sidecar reads EOF → state.shutdown() runs → exits.
    child.stdin.end()

    const sigterm = setTimeout(() => {
      child.kill('SIGTERM')
      const sigkill = setTimeout(() => {
        child.kill('SIGKILL')
      }, 2000)
      sigkill.unref()
    }, 5500)
    sigterm.unref()
  })
},
```

- [ ] **Step 4: Re-run the tests**

```bash
npx vitest run electron/sidecar.test.ts
```

Expected: 16/16 pass.

- [ ] **Step 5: Commit**

```bash
git add electron/sidecar.ts electron/sidecar.test.ts
git commit -m "$(cat <<'EOF'
feat(electron/sidecar): shutdown() with 5500ms → SIGTERM → SIGKILL escalation

TDD — 3 tests covering: pending invokes drain with 'app quitting',
clean EOF on stdin + cooperative exit resolves shutdown(), and
non-responsive child escalates SIGTERM at 5500ms then SIGKILL 2s
later. Timers unref'd so they don't keep the event loop alive.

The cooperativeShutdown flag (added in Task 7) gates the
'sidecar exited unexpectedly' draining path so a clean exit is
not misclassified as a crash.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: electron/preload.ts — contextBridge

**Files:**

- Create: `electron/preload.ts`

- [ ] **Step 1: Create the file**

```ts
// electron/preload.ts
//
// Minimal trust boundary between the renderer's web context and the
// Node-privileged main process. Two exposed methods only: invoke
// (envelope-unwrapping) and listen (event-name filtering).
//
// See spec §5 for the full contract.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { BACKEND_EVENT, BACKEND_INVOKE } from './ipc-channels'

type InvokeEnvelope<T> = { ok: true; result: T } | { ok: false; error: string }

const invoke = async <T>(
  method: string,
  args?: Record<string, unknown>
): Promise<T> => {
  const envelope = (await ipcRenderer.invoke(BACKEND_INVOKE, {
    method,
    args,
  })) as InvokeEnvelope<T>
  if (envelope.ok) return envelope.result
  // Bare-string throw matches PR-C's bridge rejection contract.
  // src/lib/backend.test.ts asserts
  // `await expect(invoke('m')).rejects.toBe('sidecar error')`.
  throw envelope.error
}

const listen = <T>(
  event: string,
  callback: (payload: T) => void
): Promise<() => void> => {
  const handler = (
    _e: IpcRendererEvent,
    msg: { event: string; payload: T }
  ): void => {
    if (msg.event === event) callback(msg.payload)
  }
  ipcRenderer.on(BACKEND_EVENT, handler)
  const unlisten = (): void => {
    ipcRenderer.off(BACKEND_EVENT, handler)
  }
  return Promise.resolve(unlisten)
}

contextBridge.exposeInMainWorld('vimeflow', { invoke, listen })
```

- [ ] **Step 2: Verify type-check passes**

```bash
npm run type-check
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add electron/preload.ts
git commit -m "$(cat <<'EOF'
feat(electron): add preload.ts exposing window.vimeflow.{invoke,listen}

Two-method contextBridge allowlist. invoke unwraps the
{ ok, result, error } envelope and throws bare-string errors so
PR-C's BackendApi rejection contract is preserved end to end.
listen filters on event-name in the preload context and returns a
Promise<UnlistenFn> wrapping ipcRenderer.off.

No other Node/Electron APIs exposed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: electron/main.ts — app lifecycle, BrowserWindow, ipcMain wiring

**Files:**

- Create: `electron/main.ts`

- [ ] **Step 1: Create the file**

```ts
// electron/main.ts
//
// Electron entry. Owns one Sidecar instance and one BrowserWindow.
// See spec §2 main.ts entry for the full lifecycle contract.

import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { BACKEND_EVENT, BACKEND_INVOKE } from './ipc-channels'
import { spawnSidecar, type Sidecar } from './sidecar'

const BINARY_NAME =
  process.platform === 'win32' ? 'vimeflow-backend.exe' : 'vimeflow-backend'

const SIDECAR_BIN = path.resolve(
  __dirname,
  '..',
  'src-tauri',
  'target',
  'debug',
  BINARY_NAME
)

let sidecar: Sidecar | null = null

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
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })
  const devURL = process.env.VITE_DEV_SERVER_URL
  if (devURL !== undefined && devURL.length > 0) {
    void win.loadURL(devURL)
  } else {
    // Production-equivalent path. PR-D3 will exercise this through
    // electron-builder packaging; PR-D1 wires it for completeness so
    // packaged smoke testing doesn't hit a no-loader path.
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

const setupApp = async (): Promise<void> => {
  await app.whenReady()

  // Step 1: spawn sidecar.
  sidecar = spawnSidecar({
    binary: SIDECAR_BIN,
    appDataDir: app.getPath('userData'),
  })

  // Step 2: register IPC handlers BEFORE creating the window so a fast
  // renderer can't fire invoke() before the handler is ready.
  ipcMain.handle(BACKEND_INVOKE, async (_e, { method, args }) => {
    try {
      const result = await sidecar!.invoke(method, args)
      return { ok: true, result }
    } catch (err) {
      return {
        ok: false,
        error: typeof err === 'string' ? err : String(err),
      }
    }
  })

  sidecar.onEvent((event, payload) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send(BACKEND_EVENT, { event, payload })
    }
  })

  // Step 3: open the window.
  createWindow()
}

void setupApp()

// before-quit gates the actual exit on the async sidecar shutdown.
let quitting = false
app.on('before-quit', async (event) => {
  if (quitting || !sidecar) return // second-pass or no sidecar — let it quit
  event.preventDefault()
  quitting = true
  try {
    await sidecar.shutdown()
  } finally {
    app.exit(0)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // macOS: recreate the window if dock icon is clicked after all
  // windows were closed. Without this, the sidecar would keep
  // running with no visible UI.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
```

- [ ] **Step 2: Verify type-check passes**

```bash
npm run type-check
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add electron/main.ts
git commit -m "$(cat <<'EOF'
feat(electron): add main.ts (app lifecycle + BrowserWindow + sidecar wiring)

Three-step app.whenReady() sequence (spawn sidecar → register
ipcMain.handle + sidecar.onEvent → create window) prevents the
early-invoke race documented in spec §2.

ipcMain.handle returns the { ok, result, error } envelope so
preload can unwrap and throw bare-string errors. Event fan-out
iterates BrowserWindow.getAllWindows() (forward-compat for
multi-window).

before-quit uses event.preventDefault() + a `quitting` flag so the
async sidecar.shutdown() completes before app.exit(0). macOS gets
window-all-closed (no-op) + on('activate') (recreate window).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: vite.config.ts — vite-plugin-electron with mode gating + sandbox override

**Files:**

- Modify: `vite.config.ts`

- [ ] **Step 1: Read the current `vite.config.ts` to confirm existing structure**

```bash
head -40 vite.config.ts
grep -nE "defineConfig|plugins:|server:|watch:" vite.config.ts | head -20
```

Note the existing imports and the `defineConfig({ ... })` call structure. The edit below is ADDITIVE — preserve every existing key.

- [ ] **Step 2: Add the import**

At the top of `vite.config.ts`, after the existing imports, add:

```ts
import electron from 'vite-plugin-electron/simple'
```

- [ ] **Step 3: Wrap `defineConfig` to accept `mode`**

If the current call is `export default defineConfig({ ... })`, change to `export default defineConfig(({ mode }) => ({ ... }))`. If it already takes a `mode` argument, leave the signature alone.

- [ ] **Step 4: Append the conditional electron plugin block**

Inside the `plugins: [ ... ]` array, after all existing entries, add:

```ts
...(mode === 'electron'
  ? [
      electron({
        main: {
          entry: 'electron/main.ts',
          // Drop --no-sandbox from the plugin's default startup so
          // production sandbox parity is preserved in dev mode (see
          // spec §5.1 Dev-mode caveat).
          onstart: ({ startup }) => {
            void startup(['.'])
          },
          vite: {
            build: {
              outDir: 'dist-electron',
              rollupOptions: {
                output: {
                  format: 'cjs',
                  entryFileNames: '[name].cjs',
                },
              },
            },
          },
        },
        preload: {
          input: 'electron/preload.ts',
          vite: {
            build: {
              outDir: 'dist-electron',
              rollupOptions: {
                output: {
                  format: 'cjs',
                  entryFileNames: '[name].cjs',
                },
              },
            },
          },
        },
      }),
    ]
  : []),
```

- [ ] **Step 5: Add `strictPort` and `dist-electron` to server config**

Locate the existing `server: { ... }` block. If `strictPort` is not present, add `strictPort: true, port: 5173,`. If there is an existing `watch: { ignored: [...] }`, append `'**/dist-electron/**'` to the array — do NOT replace existing entries. If no `watch` block exists, leave watch alone (Vite's defaults are fine).

- [ ] **Step 6: Verify the renderer-only path still works**

```bash
npm run dev
```

Open `http://localhost:5173` in a browser. Confirm the existing renderer loads. No Electron window should appear (mode is `development`, plugin is gated off). Ctrl+C to stop.

- [ ] **Step 7: Verify type-check passes**

```bash
npm run type-check
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add vite.config.ts
git commit -m "$(cat <<'EOF'
feat(vite): add vite-plugin-electron under --mode electron

Conditionally appends vite-plugin-electron/simple when mode is
'electron'. Renderer-only path (npm run dev) stays unaffected.

Plugin output: dist-electron/main.cjs + dist-electron/preload.cjs
via rollupOptions.output.format = 'cjs'. The CommonJS .cjs
extension overrides the root package's "type": "module" on a
per-file basis so Electron can load main/preload without needing
ESM main-process support.

onstart override removes --no-sandbox from the plugin's default
startup args so production sandbox parity is preserved in dev.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: .gitignore + vitest.config.ts coverage exclude

**Files:**

- Modify: `.gitignore`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Add `dist-electron/` to `.gitignore`**

Append to `.gitignore`:

```
# Electron bundler output (PR-D1)
dist-electron/
```

- [ ] **Step 2: Add electron files to `vitest.config.ts:coverage.exclude`**

In `vitest.config.ts`, locate the `coverage.exclude` array and add two entries:

```ts
coverage: {
  // …existing keys…
  exclude: [
    // …existing entries — preserve verbatim…
    'electron/main.ts',
    'electron/preload.ts',
  ],
  // …
}
```

(`electron/sidecar.ts` IS unit-tested so it stays in coverage; `electron/sidecar.test.ts` is already covered by the existing `**/*.test.{ts,tsx}` exclude.)

- [ ] **Step 3: Verify `npm run test` still passes**

```bash
npm run test
```

Expected: green. Vitest's default include picks up `electron/sidecar.test.ts`; the new file should show as part of the run with its 16 passing tests.

- [ ] **Step 4: Commit**

```bash
git add .gitignore vitest.config.ts
git commit -m "$(cat <<'EOF'
chore: ignore dist-electron + exclude electron entry files from coverage

electron/main.ts and electron/preload.ts are exercised only by the
manual smoke gate (spec §6.2); unit-test coverage would otherwise
drop their lines and fail the 80% thresholds.

electron/sidecar.ts is fully unit-tested and stays in coverage.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Final Verification Gate

**Files:** none (verification only).

Run the full acceptance gate per spec §6.

- [ ] **Step 1: Static + automated checks (spec §6.1)**

```bash
npm run format:check
npm run lint
npm run type-check
npm run test
npx vitest run electron/sidecar.test.ts
(cd src-tauri && cargo build --bin vimeflow-backend)
(cd src-tauri && cargo test)
```

Expected: all green. Vitest count climbs by exactly 16 (the new sidecar suite). Rust count matches post-PR-C baseline byte-for-byte.

- [ ] **Step 2: Manual smoke against `npm run electron:dev` (spec §6.2)**

Make sure Tauri is not running:

```bash
pkill -f tauri:dev || true
```

Then:

```bash
npm run electron:dev
```

Wait for: cargo build (~30-60s cold), Vite dev server on 5173, vite-plugin-electron bundles `dist-electron/main.cjs` + `dist-electron/preload.cjs`, Electron BrowserWindow opens at 1400×900 with title "Vimeflow".

Within the Electron window, walk through:

- [ ] Default terminal pane spawns; `pwd` returns the working directory.
- [ ] `ls -la` produces clean output with no dropped bytes.
- [ ] Window resize → terminal reflows correctly.
- [ ] Open a second tab → new PTY spawns; close it → tab count decrements.
- [ ] File explorer lists the project; opening `README.md` loads the editor.
- [ ] Diff panel shows current branch + status.
- [ ] (If Claude Code is running locally) agent watcher status updates.

DevTools (Cmd/Ctrl+Shift+I) console checks:

- [ ] No errors in the Console pane.
- [ ] `typeof window.vimeflow.invoke === 'function'` → `true`.
- [ ] `await window.vimeflow.invoke('list_sessions')` resolves to an array.

Shutdown checks:

- [ ] On Linux/Win: close the BrowserWindow → Electron exits → Vite stops → terminal returns to prompt.
- [ ] On macOS: close window leaves Electron running; press Cmd+Q → same exit flow.
- [ ] After exit, `ps aux | grep vimeflow-backend` shows NO orphan sidecar.

- [ ] **Step 3: Tauri regression smoke (spec §6.3)**

```bash
npm run tauri:dev
```

Confirm the Tauri host still launches and all feature surface still works (PR-C's bridge falls back to `@tauri-apps/api` since `window.vimeflow` is unset). Close the Tauri window after smoke.

- [ ] **Step 4: Coupling inventory (spec §6.4)**

```bash
rg -n "@tauri-apps/api|__TAURI_INTERNALS__" src tests --glob '!src/types/vimeflow.d.ts' | wc -l
```

Expected: matches the Task 0 baseline count byte-for-byte. PR-D1 does NOT change Tauri coupling — that's PR-D3.

```bash
rg -n "from 'electron'|require\\('electron'\\)" src tests --glob '!electron/**'
```

Expected: zero hits. Renderer code must NOT import `electron` directly — all paths go through `window.vimeflow`.

- [ ] **Step 5: Tag the verification gate completion**

If all steps above pass, the PR is ready for review. The next step (out of this plan's scope) is opening the PR. If any step fails, fix the root cause and re-run the gate; do not paper over.

---

## PR Description Checklist

- [ ] State: "PR-D1 adds Electron as a parallel desktop runtime alongside Tauri."
- [ ] List the new files (electron/main.ts, electron/preload.ts, electron/sidecar.ts, electron/sidecar.test.ts, electron/ipc-channels.ts, electron/tsconfig.json).
- [ ] List the modified files (package.json, vite.config.ts, .gitignore, vitest.config.ts, package-lock.json).
- [ ] State explicitly: "Tauri remains the production runtime through end of PR-D2; PR-D3 removes Tauri."
- [ ] Mention the deferred items: PTY orphan cleanup, electron:build packaging, E2E driver swap, Tauri runtime removal.
- [ ] Include the verification gate output (especially the test counts) so reviewers can spot-check baseline alignment.
- [ ] Call out the high-risk areas the spec §7 lists, with a one-line note on how each is mitigated.

---

## Risk Notes (cross-reference)

See spec §7 for the full risk breakdown. The plan-time TL;DR:

- **Sidecar stdout is protocol-owned.** Any future Rust `println!` to stdout breaks IPC. PR-D1 does not add Rust code.
- **Frame codec parity with PR-B.** Tasks 5 and 9 verify the three caps (MAX_FRAME_BYTES, MAX_HEADER_LINE_BYTES, MAX_HEADER_SECTION_BYTES).
- **Dev-mode sandbox.** Task 13's `onstart` override is the load-bearing line — if it breaks across a `vite-plugin-electron` upgrade, dev mode silently loses sandbox.
- **macOS quit UX.** Task 12's `before-quit`/`activate` handlers and Task 15's smoke step cover the platform divergence.
- **PTY orphans.** Pre-existing limitation; PR-D1 preserves Tauri parity. Out of scope.

<!-- codex-reviewed: 2026-05-15T02:30:18Z -->

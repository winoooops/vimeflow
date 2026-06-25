# New Session Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable "New Session" modal (name + native folder picker + layout + per-pane command) opened from the sidebar button and ⌘N, creating one multi-pane session whose chosen directory is the fixed baseline CWD for every pane.

**Architecture:** A controlled `Dialog`-based modal under `src/features/sessions/components/NewSessionDialog/`, composing the public `Menu` primitive for sub-popups. `createSession()` in `useSessionManager` is extended to accept `{name?, cwd?, layout?, panes?}` and assemble a multi-pane session (shell PTYs spawned via `Promise.allSettled`, browser panes via the existing bridge). A new Electron `dialog:pick-directory` IPC channel backs the native folder picker. Shared logic (`CommandId`/options types, `commandToPane`, `pathParts`/`deriveSessionName`) lives in `sessions/types` + `sessions/utils` so the hook never imports a component module.

**Tech Stack:** React 18 + TypeScript (ESM), Tailwind v4 semantic tokens, framer-motion (via `Dialog`), `@floating-ui` (via `Menu`), Electron main/preload IPC, Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-24-new-session-dialog-design.md` (codex-reviewed). Visual source: `docs/design/archive/2026-06-24-new-session-dialog/`.

**Conventions (enforced):** no semicolons, single quotes, trailing commas es5; arrow-function components; explicit return types on exported fns; `test()` not `it()`; no `console.log`; no hardcoded colors (`vimeflow/no-hardcoded-colors`) — use semantic tokens / `var(--color-*)` / `color-mix`; tooltips via `Tooltip`, never `title=`. Every `.ts`/`.tsx` gets a co-located `.test.ts(x)`.

**Working dir / branch:** `/Users/winoooops/projects/vimeflow/.claude/worktrees/new-session-dialog`, branch `feat/new-session-dialog`. All paths below are repo-relative. Run a single test with `npx vitest run <path>`.

---

## File Structure

**Create**
- `src/features/sessions/utils/sessionPaths.ts` — `pathParts(path)`, `deriveSessionName(cwd)` (shared by dialog + hook).
- `src/features/sessions/utils/sessionPaths.test.ts`
- `src/features/sessions/utils/commandToPane.ts` — `commandToPane(id)` → `{kind, userLabel?}` (used by `createSession`).
- `src/features/sessions/utils/commandToPane.test.ts`
- `src/features/sessions/components/NewSessionDialog/commands.ts` — UI command registry (`COMMANDS`, `COMMAND_ORDER`, `CommandDef`).
- `src/features/sessions/components/NewSessionDialog/commands.test.ts`
- `src/features/sessions/components/NewSessionDialog/LayoutGlyph.tsx` + `.test.tsx`
- `src/features/sessions/components/NewSessionDialog/PathCrumb.tsx` + `.test.tsx`
- `src/features/sessions/components/NewSessionDialog/WorkingDirectoryField.tsx` + `.test.tsx`
- `src/features/sessions/components/NewSessionDialog/LayoutPicker.tsx` + `.test.tsx`
- `src/features/sessions/components/NewSessionDialog/CommandBoard.tsx` + `.test.tsx`
- `src/features/sessions/components/NewSessionDialog/NewSessionDialog.tsx` + `.test.tsx`
- `src/features/sessions/components/NewSessionDialog/pickDirectory.ts` + `.test.ts`
- `src/features/sessions/components/NewSessionDialog/index.ts` — re-exports.
- `electron/dialog-ipc.ts` — `setupDialogIpc(ipcMain)` registrar + `.test.ts`

**Modify**
- `src/components/Dialog.tsx` — add `panelClassName?: string`.
- `src/components/Dialog.test.tsx` — cover `panelClassName`.
- `electron/ipc-channels.ts` — add `DIALOG_PICK_DIRECTORY`.
- `electron/main.ts` — call `setupDialogIpc(ipcMain)`.
- `electron/preload.ts` — expose `dialog.pickDirectory`.
- `electron/preload.test.ts` — assert the new bridge.
- `src/lib/backend.ts` — add `dialog?` to `BackendApi`.
- `src/features/sessions/types/index.ts` — add `CommandId`, `NewPaneSpec`, `CreateSessionOptions`.
- `src/features/sessions/hooks/useSessionManager.ts` — extend `createSession`; update `SessionManager.createSession` signature.
- `src/features/sessions/hooks/useSessionManager.test.ts` — cover options.
- `src/features/workspace/hooks/useNewSessionDialog.ts` (create) + `.test.ts`
- `src/features/workspace/WorkspaceView.tsx` — open dialog from button + ⌘N; render dialog; wire `onCreate`.
- `src/features/workspace/overlays/WorkspaceOverlayRegistrations.tsx` — register `new-session-dialog`.
- `src/features/workspace/overlays/WorkspaceOverlayRegistrations.test.tsx` — cover the registration.

---

## Task 1: `Dialog` gains an optional `panelClassName`

**Files:**
- Modify: `src/components/Dialog.tsx` (props interface ~lines 15-31; panel className ~line 354)
- Test: `src/components/Dialog.test.tsx`

- [ ] **Step 1: Write the failing test** — append to `src/components/Dialog.test.tsx`:

```tsx
test('appends panelClassName to the panel element', () => {
  render(
    <Dialog open onOpenChange={vi.fn()} panelClassName="w-[min(560px,100%)] max-w-none" aria-label="New session">
      <span>Body</span>
    </Dialog>
  )
  // eslint-disable-next-line testing-library/no-node-access -- asserting panel chrome class
  const panel = screen.getByText('Body').closest('.max-w-none')
  expect(panel).not.toBeNull()
  expect(panel).toHaveClass('w-[min(560px,100%)]')
})
```

- [ ] **Step 2: Run it — expect FAIL** (panel has no `max-w-none`).

Run: `npx vitest run src/components/Dialog.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `src/components/Dialog.tsx`, add to `DialogProps` (after `size?`):

```tsx
  /** Extra classes appended to the panel (e.g. a custom width). Last-wins over the size class. */
  panelClassName?: string
```

Destructure it in the component signature (alongside `size = 'md'`):

```tsx
  panelClassName,
```

Change the panel `motion.div` className (the line currently
``className={`${DIALOG_PANEL_CLASSES} ${PANEL_SIZE_CLASSES[size]}`}``) to:

```tsx
            className={`${DIALOG_PANEL_CLASSES} ${PANEL_SIZE_CLASSES[size]}${
              panelClassName !== undefined ? ` ${panelClassName}` : ''
            }`}
```

- [ ] **Step 4: Run — expect PASS.** `npx vitest run src/components/Dialog.test.tsx`

- [ ] **Step 5: Commit.**

```bash
git add src/components/Dialog.tsx src/components/Dialog.test.tsx
git commit -m "feat(dialog): add optional panelClassName"
```

---

## Task 2: Native folder-picker IPC

The handler logic lives in a small testable `electron/dialog-ipc.ts` (mirrors `setupBrowserPaneIpc`), called from `main.ts`. Preload exposes `window.vimeflow.dialog.pickDirectory()`.

**Files:**
- Modify: `electron/ipc-channels.ts`
- Create: `electron/dialog-ipc.ts`, `electron/dialog-ipc.test.ts`
- Modify: `electron/main.ts`, `electron/preload.ts`, `electron/preload.test.ts`, `src/lib/backend.ts`

- [ ] **Step 1: Add the channel constant.** In `electron/ipc-channels.ts` append:

```ts
export const DIALOG_PICK_DIRECTORY = 'dialog:pick-directory'
```

- [ ] **Step 2: Write the failing handler test** — `electron/dialog-ipc.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { setupDialogIpc } from './dialog-ipc'
import { DIALOG_PICK_DIRECTORY } from './ipc-channels'

const dialog = vi.hoisted(() => ({ showOpenDialog: vi.fn() }))
const browserWindow = vi.hoisted(() => ({
  fromWebContents: vi.fn(() => null),
  getFocusedWindow: vi.fn(() => null),
}))

vi.mock('electron', () => ({ dialog, BrowserWindow: browserWindow }))

describe('setupDialogIpc', () => {
  beforeEach(() => vi.clearAllMocks())

  const register = (): ((e: unknown) => Promise<string | null>) => {
    const handlers = new Map<string, (e: unknown) => Promise<string | null>>()
    const ipcMain = {
      handle: vi.fn((channel: string, fn: (e: unknown) => Promise<string | null>) => {
        handlers.set(channel, fn)
      }),
    }
    setupDialogIpc(ipcMain as never)
    const handler = handlers.get(DIALOG_PICK_DIRECTORY)
    if (!handler) throw new Error('handler not registered')
    return handler
  }

  test('returns the chosen directory path', async () => {
    dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/Users/x/proj'] })
    const handler = register()
    await expect(handler({ sender: {} })).resolves.toBe('/Users/x/proj')
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(undefined, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose working directory',
    })
  })

  test('returns null when canceled', async () => {
    dialog.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    const handler = register()
    await expect(handler({ sender: {} })).resolves.toBeNull()
  })
})
```

- [ ] **Step 3: Run — expect FAIL** (module missing). `npx vitest run electron/dialog-ipc.test.ts`

- [ ] **Step 4: Implement** `electron/dialog-ipc.ts`:

```ts
import { BrowserWindow, dialog, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import { DIALOG_PICK_DIRECTORY } from './ipc-channels'

// Native OS directory picker. Returns the absolute path, or null on cancel.
export const setupDialogIpc = (ipcMain: IpcMain): void => {
  ipcMain.handle(
    DIALOG_PICK_DIRECTORY,
    async (event: IpcMainInvokeEvent): Promise<string | null> => {
      const win =
        BrowserWindow.fromWebContents(event.sender) ??
        BrowserWindow.getFocusedWindow() ??
        undefined
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Choose working directory',
      })
      return result.canceled || result.filePaths.length === 0
        ? null
        : result.filePaths[0]
    }
  )
}
```

- [ ] **Step 5: Run — expect PASS.** `npx vitest run electron/dialog-ipc.test.ts`

- [ ] **Step 6: Wire into `main.ts`.** Add the import near the other channel/setup imports:

```ts
import { setupDialogIpc } from './dialog-ipc'
```

and call it once during IPC setup (alongside the existing `ipcMain.handle(BACKEND_INVOKE, …)` registration, before `app` is ready is fine — it only registers a handler):

```ts
  setupDialogIpc(ipcMain)
```

Verify the wiring is actually present (a missed call compiles + passes unit tests but leaves the picker dead at runtime):

Run: `grep -n "setupDialogIpc(ipcMain)" electron/main.ts`
Expected: one match. (If `electron/main.test.ts` exists, add an assertion there instead of relying on grep.)

- [ ] **Step 7: Expose in preload + assert.** In `electron/preload.ts` import the channel:

```ts
import { DIALOG_PICK_DIRECTORY } from './ipc-channels'
```

Add a top-level namespace inside the `exposeInMainWorld('vimeflow', { … })` object (next to `browserPane` / `workspaceLayout`):

```ts
  dialog: {
    pickDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke(DIALOG_PICK_DIRECTORY) as Promise<string | null>,
  },
```

In `electron/preload.test.ts`, add:

```ts
test('exposes dialog.pickDirectory bound to the channel', async () => {
  const api = electronMock.exposed as { dialog: { pickDirectory: () => Promise<unknown> } }
  await api.dialog.pickDirectory()
  expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith(DIALOG_PICK_DIRECTORY)
})
```

(import `DIALOG_PICK_DIRECTORY` from `./ipc-channels` at the top of the test.)

- [ ] **Step 8: Type the bridge.** In `src/lib/backend.ts`, add to the `BackendApi` interface:

```ts
  dialog?: {
    pickDirectory: () => Promise<string | null>
  }
```

- [ ] **Step 9: Run electron tests — expect PASS.** `npx vitest run electron/preload.test.ts electron/dialog-ipc.test.ts`

- [ ] **Step 10: Commit.**

```bash
git add electron/ipc-channels.ts electron/dialog-ipc.ts electron/dialog-ipc.test.ts electron/main.ts electron/preload.ts electron/preload.test.ts src/lib/backend.ts
git commit -m "feat(electron): native directory picker IPC"
```

---

## Task 3: Shared types + path/name helpers + commandToPane

**Files:**
- Modify: `src/features/sessions/types/index.ts`
- Create: `src/features/sessions/utils/sessionPaths.ts` + `.test.ts`
- Create: `src/features/sessions/utils/commandToPane.ts` + `.test.ts`

- [ ] **Step 1: Add types.** In `src/features/sessions/types/index.ts` append:

```ts
export type CommandId = 'claude' | 'codex' | 'kimi' | 'opencode' | 'browser' | 'shell'

export interface NewPaneSpec {
  command: CommandId
}

export interface CreateSessionOptions {
  name?: string
  cwd?: string
  layout?: PaneLayoutId
  panes?: NewPaneSpec[]
}
```

(`PaneLayoutId` is already defined/exported in this file.)

- [ ] **Step 2: Write failing `sessionPaths` test** — `src/features/sessions/utils/sessionPaths.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { pathParts, deriveSessionName } from './sessionPaths'

describe('pathParts', () => {
  test('splits posix paths, dropping blanks', () => {
    expect(pathParts('/Users/x/proj/')).toEqual(['Users', 'x', 'proj'])
  })
  test('splits windows + UNC paths', () => {
    expect(pathParts('C:\\Users\\x')).toEqual(['C:', 'Users', 'x'])
    expect(pathParts('\\\\server\\share')).toEqual(['server', 'share'])
  })
  test('tilde is an ordinary first segment', () => {
    expect(pathParts('~/code/vf')).toEqual(['~', 'code', 'vf'])
  })
})

describe('deriveSessionName', () => {
  test('uses the folder basename', () => {
    expect(deriveSessionName('/Users/x/vimeflow-core')).toBe('vimeflow-core')
  })
  test('falls back to "session" for bare root/home', () => {
    expect(deriveSessionName('/')).toBe('session')
    expect(deriveSessionName('~')).toBe('session')
    expect(deriveSessionName('C:\\')).toBe('session')
  })
})
```

- [ ] **Step 3: Run — expect FAIL.** `npx vitest run src/features/sessions/utils/sessionPaths.test.ts`

- [ ] **Step 4: Implement** `src/features/sessions/utils/sessionPaths.ts`:

```ts
// Separator-agnostic path splitting so native POSIX, Windows-drive, and UNC
// paths all segment. Empty segments (leading/trailing/doubled separators) drop.
export const pathParts = (path: string): string[] =>
  path.split(/[/\\]+/).filter((segment) => segment.length > 0)

const BARE_ROOT = new Set(['~', '/'])

// Auto-tracked session name. The folder basename, falling back to 'session' for
// an empty basename or a bare root/home token (so names are never blank). The
// dialog prefill and createSession both call this, so they always agree.
export const deriveSessionName = (cwd: string): string => {
  const parts = pathParts(cwd)
  const last = parts[parts.length - 1]
  if (last === undefined) return 'session'
  // A bare home/root or a Windows drive root (e.g. 'C:') is not a folder name.
  if (BARE_ROOT.has(last) || /^[A-Za-z]:$/.test(last)) return 'session'
  return last
}
```

- [ ] **Step 5: Run — expect PASS.** `npx vitest run src/features/sessions/utils/sessionPaths.test.ts`

- [ ] **Step 6: Write failing `commandToPane` test** — `src/features/sessions/utils/commandToPane.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { commandToPane } from './commandToPane'

describe('commandToPane', () => {
  test('browser maps to a browser pane', () => {
    expect(commandToPane('browser')).toEqual({ kind: 'browser' })
  })
  test('shell maps to a plain shell pane (no label)', () => {
    expect(commandToPane('shell')).toEqual({ kind: 'shell' })
  })
  test('agent commands map to a labeled shell pane', () => {
    expect(commandToPane('claude')).toEqual({ kind: 'shell', userLabel: 'Claude Code' })
    expect(commandToPane('codex')).toEqual({ kind: 'shell', userLabel: 'Codex CLI' })
  })
})
```

- [ ] **Step 7: Run — expect FAIL.** `npx vitest run src/features/sessions/utils/commandToPane.test.ts`

- [ ] **Step 8: Implement** `src/features/sessions/utils/commandToPane.ts`:

```ts
import { AGENTS } from '../../../agents/registry'
import type { PaneKind } from '../types'
import type { CommandId } from '../types'

export interface CommandPaneResult {
  kind: PaneKind
  userLabel?: string
}

// v1: agent picks create a labeled shell pane (no CLI launch); browser → browser
// pane; shell → plain shell. The label makes the intent visible in the header.
export const commandToPane = (command: CommandId): CommandPaneResult => {
  if (command === 'browser') return { kind: 'browser' }
  if (command === 'shell') return { kind: 'shell' }
  return { kind: 'shell', userLabel: AGENTS[command].name }
}
```

- [ ] **Step 9: Run — expect PASS.** `npx vitest run src/features/sessions/utils/commandToPane.test.ts`

- [ ] **Step 10: Commit.**

```bash
git add src/features/sessions/types/index.ts src/features/sessions/utils/sessionPaths.ts src/features/sessions/utils/sessionPaths.test.ts src/features/sessions/utils/commandToPane.ts src/features/sessions/utils/commandToPane.test.ts
git commit -m "feat(sessions): new-session option types + path/command helpers"
```

---

## Task 4: Extend `createSession` to assemble a multi-pane session

**Files:**
- Modify: `src/features/sessions/hooks/useSessionManager.ts` (interface ~line 81; `createSession` ~823-906; deps array)
- Test: `src/features/sessions/hooks/useSessionManager.test.ts`

- [ ] **Step 1: Update the interface.** Change the `SessionManager` member (line ~81) from
`createSession: () => void` to:

```ts
  createSession: (opts?: CreateSessionOptions) => void
```

and add `CreateSessionOptions`, `NewPaneSpec` to the type import from `../types`. Also import the helpers near the other util imports:

```ts
import { commandToPane } from '../utils/commandToPane'
import { deriveSessionName } from '../utils/sessionPaths'
```

- [ ] **Step 2: Write failing tests** — add to `src/features/sessions/hooks/useSessionManager.test.ts`:

```ts
test('createSession(opts) builds a multi-pane session honoring layout + cwd', async () => {
  const service = createMockService()
  service.listSessions = vi.fn().mockResolvedValue({ activeSessionId: null, sessions: [] })
  service.spawn = vi.fn().mockResolvedValue({
    sessionId: 'pty', pid: 1, cwd: '/Users/x/proj', shell: '/bin/zsh',
  })
  const { result } = renderHook(() => useSessionManager(service, { autoCreateOnEmpty: false }))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    result.current.createSession({
      cwd: '/Users/x/proj',
      layout: 'vsplit',
      panes: [{ command: 'claude' }, { command: 'shell' }],
    })
  })

  await waitFor(() => expect(result.current.sessions).toHaveLength(1))
  const session = result.current.sessions[0]
  expect(session.layout).toBe('vsplit')
  expect(session.workingDirectory).toBe('/Users/x/proj')
  expect(session.name).toBe('proj')
  expect(session.panes).toHaveLength(2)
  expect(session.panes[0].userLabel).toBe('Claude Code')
  expect(session.panes[1].userLabel).toBeUndefined()
  expect(session.panes[0].active).toBe(true)
  // every shell pane spawned with the chosen cwd (fixed baseline)
  expect(service.spawn).toHaveBeenCalledTimes(2)
  expect(service.spawn).toHaveBeenNthCalledWith(1, { cwd: '/Users/x/proj', env: {}, enableAgentBridge: true })
})

test('createSession() with no args is unchanged (single shell pane)', async () => {
  const service = createMockService()
  service.listSessions = vi.fn().mockResolvedValue({ activeSessionId: null, sessions: [] })
  service.spawn = vi.fn().mockResolvedValue({ sessionId: 'pty', pid: 1, cwd: '/home/u', shell: '/bin/zsh' })
  const { result } = renderHook(() => useSessionManager(service, { autoCreateOnEmpty: false }))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => result.current.createSession())
  await waitFor(() => expect(result.current.sessions).toHaveLength(1))
  expect(result.current.sessions[0].layout).toBe('single')
  expect(result.current.sessions[0].panes).toHaveLength(1)
})

test('createSession skips a failed pane but still creates the session', async () => {
  const service = createMockService()
  service.listSessions = vi.fn().mockResolvedValue({ activeSessionId: null, sessions: [] })
  service.spawn = vi
    .fn()
    .mockResolvedValueOnce({ sessionId: 'pty0', pid: 1, cwd: '/p', shell: '/bin/zsh' })
    .mockRejectedValueOnce(new Error('boom'))
  const { result } = renderHook(() => useSessionManager(service, { autoCreateOnEmpty: false }))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    result.current.createSession({ cwd: '/p', layout: 'vsplit', panes: [{ command: 'shell' }, { command: 'shell' }] })
  })
  await waitFor(() => expect(result.current.sessions).toHaveLength(1))
  expect(result.current.sessions[0].panes).toHaveLength(1)
})
```

> Note: if `useSessionManager` does not already accept an options arg with `autoCreateOnEmpty`, check the existing test (it references `autoCreateOnEmpty: false`) for the exact call shape and match it. If the hook auto-creates, call `createSession` after the auto-create settles and assert on the second session instead.

- [ ] **Step 3: Run — expect FAIL** (createSession ignores args). `npx vitest run src/features/sessions/hooks/useSessionManager.test.ts -t "multi-pane"`

- [ ] **Step 4: Implement.** Replace the `createSession` `useCallback` body (lines ~823-906) with:

```ts
  const createSession = useCallback(
    (opts?: CreateSessionOptions): void => {
      const layout: PaneLayoutId = opts?.layout ?? 'single'
      const capacity = layoutRegistry.capacityFor(layout)
      const requestedCwd = opts?.cwd ?? '~'
      // Exactly `capacity` slots: explicit picks override; missing slots = shell.
      const specs: NewPaneSpec[] = Array.from(
        { length: capacity },
        (_, i) => opts?.panes?.[i] ?? { command: 'shell' }
      )

      setPendingSpawns((c) => c + 1)
      void (async (): Promise<void> => {
        try {
          // Spawn shell/agent PTYs concurrently + independently (one failure
          // must not reject the rest). Browser slots need no PTY.
          const spawned = await Promise.allSettled(
            specs.map((spec) =>
              commandToPane(spec.command).kind === 'browser'
                ? Promise.resolve(null)
                : service.spawn({ cwd: requestedCwd, env: {}, enableAgentBridge: true })
            )
          )

          const now = new Date().toISOString()
          const newSessionId = crypto.randomUUID()

          // Resolved baseline cwd: the path Rust echoes back for the chosen dir.
          // Falls back to the requested cwd for an all-browser session.
          const firstResolved = spawned.find(
            (s): s is PromiseFulfilledResult<PTYSpawnResult> =>
              s.status === 'fulfilled' && s.value !== null
          )
          const workingDirectory = firstResolved
            ? firstResolved.value.cwd
            : requestedCwd

          const panes: Pane[] = []
          const browserPaneIds: string[] = []

          specs.forEach((spec, i) => {
            const mapped = commandToPane(spec.command)
            const paneId = `p${panes.length}`

            if (mapped.kind === 'browser') {
              panes.push({
                kind: 'browser',
                id: paneId,
                ptyId: `browser:${crypto.randomUUID()}`,
                cwd: workingDirectory,
                agentType: 'generic',
                status: 'idle',
                active: false,
                browserUrl: DEFAULT_BROWSER_URL,
                ...(mapped.userLabel ? { userLabel: mapped.userLabel } : {}),
              })
              browserPaneIds.push(paneId)
              return
            }

            const settled = spawned[i]
            if (settled.status !== 'fulfilled' || settled.value === null) {
              log.warn(
                'createSession: pane spawn failed',
                settled.status === 'rejected' ? settled.reason : undefined
              )
              return
            }
            const result = settled.value
            const restoreData: RestoreData = {
              sessionId: result.sessionId,
              cwd: result.cwd,
              pid: result.pid,
              replayData: '',
              replayEndOffset: 0,
              bufferedEvents: [],
            }
            registerPending(result.sessionId)
            registerPtySession(result.sessionId, result.sessionId, result.cwd)
            panes.push({
              kind: 'shell',
              id: paneId,
              ptyId: result.sessionId,
              cwd: result.cwd,
              shell: result.shell,
              agentType: 'generic',
              status: 'running',
              active: false,
              pid: result.pid,
              restoreData,
              ...(mapped.userLabel ? { userLabel: mapped.userLabel } : {}),
            })
          })

          if (panes.length === 0) {
            log.warn('createSession: no panes spawned; session not created')
            return
          }
          panes[0] = { ...panes[0], active: true }

          // Mirror the single-pane path's public restoreData contract.
          const firstRestore = panes.find((p) => p.restoreData)?.restoreData
          if (firstRestore) {
            restoreDataRef.current.set(newSessionId, firstRestore)
          }

          const hasShell = panes.some((p) => p.kind !== 'browser')
          const name = opts?.name ?? deriveSessionName(workingDirectory)

          flushSync(() => {
            setSessions((prev) => {
              const newSession: Session = {
                id: newSessionId,
                projectId: 'proj-1',
                name,
                status: hasShell ? 'running' : 'idle',
                workingDirectory,
                agentType: 'generic',
                layout,
                activityPanelCollapsed: false,
                panes,
                createdAt: now,
                lastActivityAt: now,
                activity: { ...emptyActivity },
              }
              return [...prev, newSession]
            })
          })

          setActiveSessionId(newSessionId)

          // Browser panes: create the WebContents after state is committed
          // (guarded — a startup/shutdown rejection must not surface).
          for (const paneId of browserPaneIds) {
            void (async (): Promise<void> => {
              try {
                await createBrowserPane({
                  sessionId: newSessionId,
                  paneId,
                  workspaceId: 'proj-1',
                  initialUrl: DEFAULT_BROWSER_URL,
                })
              } catch (err) {
                log.warn('createSession: createBrowserPane failed', err)
              }
            })()
          }
        } catch (err) {
          log.warn('createSession failed', err)
        } finally {
          setPendingSpawns((c) => c - 1)
        }
      })()
    },
    [layoutRegistry, registerPending, service, setActiveSessionId]
  )
```

Add `PTYSpawnResult` to the terminal type imports if not already imported. Ensure `Pane`, `PaneLayoutId`, `Session`, `RestoreData`, `CreateSessionOptions`, `NewPaneSpec` are imported.

- [ ] **Step 5: Run — expect PASS.** `npx vitest run src/features/sessions/hooks/useSessionManager.test.ts`

- [ ] **Step 6: Commit.**

```bash
git add src/features/sessions/hooks/useSessionManager.ts src/features/sessions/hooks/useSessionManager.test.ts
git commit -m "feat(sessions): createSession assembles multi-pane sessions"
```

---

## Task 5: `commands.ts` — dialog command registry

**Files:**
- Create: `src/features/sessions/components/NewSessionDialog/commands.ts` + `.test.ts`

- [ ] **Step 1: Write failing test** — `commands.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { COMMANDS, COMMAND_ORDER } from './commands'

describe('COMMANDS', () => {
  test('orders claude, codex, kimi, opencode, browser, shell', () => {
    expect(COMMAND_ORDER).toEqual(['claude', 'codex', 'kimi', 'opencode', 'browser', 'shell'])
  })
  test('browser is a browser-kind entry with its own accent', () => {
    expect(COMMANDS.browser.kind).toBe('browser')
    expect(COMMANDS.browser.accentVar).toBe('--color-agent-browser-accent')
  })
  test('agent entries reuse the registry label + glyph', () => {
    expect(COMMANDS.claude.label).toBe('Claude Code')
    expect(COMMANDS.claude.kind).toBe('shell')
    expect(COMMANDS.shell.kind).toBe('shell')
  })
})
```

- [ ] **Step 2: Run — expect FAIL.** `npx vitest run src/features/sessions/components/NewSessionDialog/commands.test.ts`

- [ ] **Step 3: Implement** `commands.ts`:

```ts
import { AGENTS, type AgentIcon } from '../../../../agents/registry'
import { BROWSER_IDENTITY } from '../../../browser/browserIdentity'
import type { CommandId } from '../../types'

export interface CommandDef {
  id: CommandId
  label: string
  kind: 'shell' | 'browser'
  accentVar: string
  glyph: string
  Icon?: AgentIcon
}

const fromAgent = (id: Exclude<CommandId, 'browser'>): CommandDef => ({
  id,
  label: AGENTS[id].name,
  kind: 'shell',
  accentVar: `--color-agent-${id}-accent`,
  glyph: AGENTS[id].glyph,
  Icon: AGENTS[id].Icon,
})

export const COMMANDS: Record<CommandId, CommandDef> = {
  claude: fromAgent('claude'),
  codex: fromAgent('codex'),
  kimi: fromAgent('kimi'),
  opencode: fromAgent('opencode'),
  shell: fromAgent('shell'),
  browser: {
    id: 'browser',
    label: 'Browser pane',
    kind: 'browser',
    accentVar: '--color-agent-browser-accent',
    glyph: BROWSER_IDENTITY.glyph,
  },
}

export const COMMAND_ORDER: CommandId[] = [
  'claude',
  'codex',
  'kimi',
  'opencode',
  'browser',
  'shell',
]
```

> Verify `BROWSER_IDENTITY` is exported from `src/features/browser/browserIdentity.ts` and is a `PaneIdentity` (has `.glyph`). If the export name differs, adjust the import.

- [ ] **Step 4: Run — expect PASS.** Commit.

```bash
git add src/features/sessions/components/NewSessionDialog/commands.ts src/features/sessions/components/NewSessionDialog/commands.test.ts
git commit -m "feat(sessions): new-session command registry"
```

---

## Task 6: `LayoutGlyph`

**Files:** Create `LayoutGlyph.tsx` + `.test.tsx`

- [ ] **Step 1: Failing test** — `LayoutGlyph.test.tsx`:

```tsx
import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { LayoutGlyph } from './LayoutGlyph'

describe('LayoutGlyph', () => {
  test('renders an svg for each layout id', () => {
    const { container, rerender } = render(<LayoutGlyph id="single" active={false} />)
    expect(container.querySelector('svg')).not.toBeNull()
    rerender(<LayoutGlyph id="quad" active />)
    // quad draws a vertical + horizontal divider line
    expect(container.querySelectorAll('line').length).toBeGreaterThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** `LayoutGlyph.tsx` (ported from the handoff; theme-colored via `currentColor` so the parent sets the hue):

```tsx
import { type ReactElement } from 'react'
import type { PaneLayoutId } from '../../types'

interface LayoutGlyphProps {
  id: PaneLayoutId
  active: boolean
}

const W = 16
const H = 12
const SW = 1.4

// Inline-SVG miniature of each layout shape. Color comes from `currentColor`,
// so the caller controls active/inactive hue via text color.
export const LayoutGlyph = ({ id, active }: LayoutGlyphProps): ReactElement => {
  const lines: Partial<Record<PaneLayoutId, ReactElement>> = {
    vsplit: <line x1={W / 2} y1="1" x2={W / 2} y2={H - 1} stroke="currentColor" strokeWidth={SW} />,
    hsplit: <line x1="1" y1={H / 2} x2={W - 1} y2={H / 2} stroke="currentColor" strokeWidth={SW} />,
    threeRight: (
      <>
        <line x1="9.4" y1="1" x2="9.4" y2={H - 1} stroke="currentColor" strokeWidth={SW} />
        <line x1="9.4" y1={H / 2} x2={W - 1} y2={H / 2} stroke="currentColor" strokeWidth={SW} />
      </>
    ),
    quad: (
      <>
        <line x1={W / 2} y1="1" x2={W / 2} y2={H - 1} stroke="currentColor" strokeWidth={SW} />
        <line x1="1" y1={H / 2} x2={W - 1} y2={H / 2} stroke="currentColor" strokeWidth={SW} />
      </>
    ),
  }
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className={active ? 'text-primary' : 'text-on-surface-muted'}
      aria-hidden="true"
    >
      <rect x="1" y="1" width={W - 2} height={H - 2} rx="1.4" fill="none" stroke="currentColor" strokeWidth={SW} />
      {lines[id]}
    </svg>
  )
}
```

- [ ] **Step 4: Run — expect PASS.** Commit.

```bash
git add src/features/sessions/components/NewSessionDialog/LayoutGlyph.tsx src/features/sessions/components/NewSessionDialog/LayoutGlyph.test.tsx
git commit -m "feat(sessions): layout glyph for new-session dialog"
```

---

## Task 7: `PathCrumb`

**Files:** Create `PathCrumb.tsx` + `.test.tsx`

- [ ] **Step 1: Failing test** — `PathCrumb.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { PathCrumb } from './PathCrumb'

describe('PathCrumb', () => {
  test('renders each segment; last segment is emphasized', () => {
    render(<PathCrumb path="~/code/vimeflow-core" />)
    expect(screen.getByText('~')).toBeInTheDocument()
    expect(screen.getByText('code')).toBeInTheDocument()
    const last = screen.getByText('vimeflow-core')
    expect(last).toHaveClass('text-primary')
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** `PathCrumb.tsx`:

```tsx
import { Fragment, type ReactElement } from 'react'
import { pathParts } from '../../utils/sessionPaths'

interface PathCrumbProps {
  path: string
}

// Renders a path as colored, separator-joined segments. Last segment = primary;
// intermediate = muted. Uses pathParts so Windows/UNC paths render too.
export const PathCrumb = ({ path }: PathCrumbProps): ReactElement => {
  const parts = pathParts(path)
  return (
    <span className="truncate font-mono text-[12.5px]">
      {parts.map((part, i) => {
        const last = i === parts.length - 1
        return (
          <Fragment key={`${part}-${i}`}>
            {i > 0 && <span className="text-on-surface-muted">/</span>}
            <span className={last ? 'font-semibold text-primary' : 'text-on-surface-muted'}>
              {part}
            </span>
          </Fragment>
        )
      })}
    </span>
  )
}
```

- [ ] **Step 4: Run — expect PASS.** Commit.

```bash
git add src/features/sessions/components/NewSessionDialog/PathCrumb.tsx src/features/sessions/components/NewSessionDialog/PathCrumb.test.tsx
git commit -m "feat(sessions): path crumb for new-session dialog"
```

---

## Task 8: `WorkingDirectoryField` + `pickDirectory` wrapper

**Files:** Create `pickDirectory.ts` + `.test.ts`, `WorkingDirectoryField.tsx` + `.test.tsx`

- [ ] **Step 1: Failing wrapper test** — `pickDirectory.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from 'vitest'
import { pickDirectory } from './pickDirectory'

afterEach(() => {
  delete (window as { vimeflow?: unknown }).vimeflow
})

describe('pickDirectory', () => {
  test('returns the bridge result', async () => {
    ;(window as { vimeflow?: unknown }).vimeflow = {
      dialog: { pickDirectory: vi.fn().mockResolvedValue('/Users/x/proj') },
    }
    await expect(pickDirectory()).resolves.toBe('/Users/x/proj')
  })
  test('returns null when the bridge is absent (browser dev)', async () => {
    await expect(pickDirectory()).resolves.toBeNull()
  })
})
```

- [ ] **Step 2: Run — expect FAIL.** Implement `pickDirectory.ts`:

```ts
// Thin wrapper over the Electron folder-picker bridge. Returns null in
// non-Electron dev (no window.vimeflow.dialog), so callers no-op gracefully.
export const pickDirectory = async (): Promise<string | null> =>
  (await window.vimeflow?.dialog?.pickDirectory()) ?? null
```

- [ ] **Step 3: Run — expect PASS.**

- [ ] **Step 4: Failing field test** — `WorkingDirectoryField.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { WorkingDirectoryField } from './WorkingDirectoryField'

vi.mock('./pickDirectory', () => ({ pickDirectory: vi.fn() }))
import { pickDirectory } from './pickDirectory'

describe('WorkingDirectoryField', () => {
  test('Browse… picks a directory and reports it', async () => {
    vi.mocked(pickDirectory).mockResolvedValue('/Users/x/picked')
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<WorkingDirectoryField path="~/code/vf" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /browse/i }))
    expect(onChange).toHaveBeenCalledWith('/Users/x/picked')
  })

  test('a canceled pick does not call onChange', async () => {
    vi.mocked(pickDirectory).mockResolvedValue(null)
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<WorkingDirectoryField path="~/code/vf" onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /browse/i }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 5: Run — expect FAIL.** Implement `WorkingDirectoryField.tsx`:

```tsx
import { type ReactElement } from 'react'
import { Button } from '@/components/Button'
import { PathCrumb } from './PathCrumb'
import { pickDirectory } from './pickDirectory'

interface WorkingDirectoryFieldProps {
  path: string
  onChange: (path: string) => void
}

export const WorkingDirectoryField = ({
  path,
  onChange,
}: WorkingDirectoryFieldProps): ReactElement => {
  const handleBrowse = async (): Promise<void> => {
    const picked = await pickDirectory()
    if (picked !== null) onChange(picked)
  }
  return (
    <div className="flex gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[9px] bg-surface-container-lowest px-3 py-2.5">
        <span className="material-symbols-outlined text-base text-primary-container" aria-hidden="true">
          folder_open
        </span>
        <PathCrumb path={path} />
      </div>
      <Button
        variant="default"
        leadingIcon="drive_folder_upload"
        onClick={() => {
          void handleBrowse()
        }}
      >
        Browse…
      </Button>
    </div>
  )
}
```

- [ ] **Step 6: Run — expect PASS.** Commit.

```bash
git add src/features/sessions/components/NewSessionDialog/pickDirectory.ts src/features/sessions/components/NewSessionDialog/pickDirectory.test.ts src/features/sessions/components/NewSessionDialog/WorkingDirectoryField.tsx src/features/sessions/components/NewSessionDialog/WorkingDirectoryField.test.tsx
git commit -m "feat(sessions): working-directory field + picker wrapper"
```

---

## Task 9: `LayoutPicker`

Quick layouts (`single`/`vsplit`/`hsplit`) as a vertical list + a "More layouts" `Menu` that pins a non-quick layout (`threeRight`/`quad`).

**Files:** Create `LayoutPicker.tsx` + `.test.tsx`

- [ ] **Step 1: Failing test** — `LayoutPicker.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { LayoutPicker } from './LayoutPicker'

describe('LayoutPicker', () => {
  test('selecting a quick layout reports it', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    render(<LayoutPicker layoutId="single" pinnedLayout={null} onSelect={onSelect} onPin={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: /vertical/i }))
    expect(onSelect).toHaveBeenCalledWith('vsplit')
  })

  test('More layouts pins + selects a non-quick layout', async () => {
    const onSelect = vi.fn()
    const onPin = vi.fn()
    const user = userEvent.setup()
    render(<LayoutPicker layoutId="single" pinnedLayout={null} onSelect={onSelect} onPin={onPin} />)
    await user.click(screen.getByRole('button', { name: /more layouts/i }))
    await user.click(screen.getByRole('menuitem', { name: /quad/i }))
    expect(onPin).toHaveBeenCalledWith('quad')
    expect(onSelect).toHaveBeenCalledWith('quad')
  })
})
```

- [ ] **Step 2: Run — expect FAIL.** Implement `LayoutPicker.tsx`:

```tsx
import { type ReactElement } from 'react'
import { Menu } from '@/components/Menu'
import { LAYOUTS } from '../../../terminal/layout-registry'
import type { PaneLayoutId } from '../../types'
import { LayoutGlyph } from './LayoutGlyph'

const QUICK_LAYOUTS: PaneLayoutId[] = ['single', 'vsplit', 'hsplit']
const ALL_LAYOUTS: PaneLayoutId[] = ['single', 'vsplit', 'hsplit', 'threeRight', 'quad']

interface LayoutPickerProps {
  layoutId: PaneLayoutId
  pinnedLayout: PaneLayoutId | null
  onSelect: (id: PaneLayoutId) => void
  onPin: (id: PaneLayoutId) => void
}

export const LayoutPicker = ({
  layoutId,
  pinnedLayout,
  onSelect,
  onPin,
}: LayoutPickerProps): ReactElement => {
  const visible =
    pinnedLayout !== null && !QUICK_LAYOUTS.includes(pinnedLayout)
      ? [...QUICK_LAYOUTS, pinnedLayout]
      : QUICK_LAYOUTS

  return (
    <div className="flex w-[158px] shrink-0 flex-col gap-1.5">
      {visible.map((id) => {
        const selected = id === layoutId
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            aria-pressed={selected}
            className={`flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left ${
              selected
                ? 'bg-primary-container/[0.12] text-primary'
                : 'bg-surface-container-lowest text-on-surface-variant'
            }`}
          >
            <LayoutGlyph id={id} active={selected} />
            <span className="flex-1 text-xs font-medium">{LAYOUTS[id].name}</span>
            <span className="font-mono text-[10px] text-on-surface-muted">{LAYOUTS[id].capacity}</span>
          </button>
        )
      })}
      <Menu
        aria-label="More layouts"
        trigger={
          <button
            type="button"
            aria-label="More layouts"
            className="flex w-full items-center gap-2 rounded-[9px] border border-dashed border-outline-variant/50 px-2.5 py-2 text-left text-xs text-on-surface-muted"
          >
            <span className="material-symbols-outlined text-base" aria-hidden="true">more_horiz</span>
            <span className="flex-1">More layouts</span>
          </button>
        }
      >
        {ALL_LAYOUTS.map((id) => (
          <Menu.Item
            key={id}
            onSelect={() => {
              onPin(id)
              onSelect(id)
            }}
          >
            {LAYOUTS[id].name}
          </Menu.Item>
        ))}
      </Menu>
    </div>
  )
}
```

> `Menu.Item` accessible name comes from its `children` text, so `getByRole('menuitem', { name: /quad/i })` matches "Quad". Confirm `LAYOUTS` is exported from `../../../terminal/layout-registry`.

- [ ] **Step 3: Run — expect PASS.** Commit.

```bash
git add src/features/sessions/components/NewSessionDialog/LayoutPicker.tsx src/features/sessions/components/NewSessionDialog/LayoutPicker.test.tsx
git commit -m "feat(sessions): layout picker for new-session dialog"
```

---

## Task 10: `CommandBoard`

A CSS-grid miniature of the layout; each cell is a pane button that opens a command `Menu`.

**Files:** Create `CommandBoard.tsx` + `.test.tsx`

- [ ] **Step 1: Failing test** — `CommandBoard.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { CommandBoard } from './CommandBoard'

describe('CommandBoard', () => {
  test('renders one pane button per layout slot', () => {
    render(<CommandBoard layoutId="vsplit" assign={['claude', 'shell']} onAssign={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: /choose command for pane/i })).toHaveLength(2)
  })

  test('selecting a command assigns it to the pane index', async () => {
    const onAssign = vi.fn()
    const user = userEvent.setup()
    render(<CommandBoard layoutId="vsplit" assign={['claude', 'shell']} onAssign={onAssign} />)
    const paneButtons = screen.getAllByRole('button', { name: /choose command for pane/i })
    await user.click(paneButtons[1])
    await user.click(screen.getByRole('menuitem', { name: /codex cli/i }))
    expect(onAssign).toHaveBeenCalledWith(1, 'codex')
  })
})
```

- [ ] **Step 2: Run — expect FAIL.** Implement `CommandBoard.tsx`:

```tsx
import { type ReactElement } from 'react'
import { Menu } from '@/components/Menu'
import { LAYOUTS } from '../../../terminal/layout-registry'
import type { CommandId, PaneLayoutId } from '../../types'
import { COMMANDS, COMMAND_ORDER } from './commands'

interface CommandBoardProps {
  layoutId: PaneLayoutId
  assign: CommandId[]
  onAssign: (index: number, command: CommandId) => void
}

export const CommandBoard = ({
  layoutId,
  assign,
  onAssign,
}: CommandBoardProps): ReactElement => {
  const layout = LAYOUTS[layoutId]
  const areas = layout.areas.map((row) => `"${row.join(' ')}"`).join(' ')

  return (
    <div
      className="grid h-[150px] gap-2"
      style={{
        gridTemplateColumns: layout.cols,
        gridTemplateRows: layout.rows,
        gridTemplateAreas: areas,
      }}
    >
      {Array.from({ length: layout.capacity }).map((_, i) => {
        const command = COMMANDS[assign[i] ?? 'shell']
        return (
          <div key={i} style={{ gridArea: `p${i}` }} className="min-w-0">
            <Menu
              aria-label={`Command for pane ${i + 1}`}
              trigger={
                <button
                  type="button"
                  aria-label={`Choose command for pane ${i + 1}`}
                  className="flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-outline-variant/50 bg-surface-container-lowest p-2 text-center"
                >
                  <span
                    className="flex h-[30px] w-[30px] items-center justify-center rounded-lg font-mono text-base"
                    style={{
                      color: `var(${command.accentVar})`,
                      background: `color-mix(in srgb, var(${command.accentVar}) 16%, transparent)`,
                    }}
                  >
                    {command.glyph}
                  </span>
                  <span className="truncate text-xs font-semibold text-on-surface-variant">
                    {command.label}
                  </span>
                </button>
              }
            >
              {COMMAND_ORDER.map((id) => (
                <Menu.Item key={id} onSelect={() => onAssign(i, id)}>
                  {COMMANDS[id].label}
                </Menu.Item>
              ))}
            </Menu>
          </div>
        )
      })}
    </div>
  )
}
```

> Inline `style` is used for the per-command accent (a dynamic `var(--color-agent-*)`), which is token-driven, not a hardcoded literal — compliant with `no-hardcoded-colors`.

- [ ] **Step 3: Run — expect PASS.** Commit.

```bash
git add src/features/sessions/components/NewSessionDialog/CommandBoard.tsx src/features/sessions/components/NewSessionDialog/CommandBoard.test.tsx
git commit -m "feat(sessions): command board for new-session dialog"
```

---

## Task 11: `NewSessionDialog`

Assembles the modal: header, scroll body (name + working dir + layout/command row), footer; owns state; emits `onCreate` / `onOpenChange`.

**Files:** Create `NewSessionDialog.tsx` + `.test.tsx`, `index.ts`

- [ ] **Step 1: Failing test** — `NewSessionDialog.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { NewSessionDialog } from './NewSessionDialog'

const setup = (overrides: Partial<Parameters<typeof NewSessionDialog>[0]> = {}) => {
  const onCreate = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <NewSessionDialog open onOpenChange={onOpenChange} onCreate={onCreate} defaultCwd="~/code/vimeflow-core" {...overrides} />
  )
  return { onCreate, onOpenChange }
}

describe('NewSessionDialog', () => {
  test('name prefills from the default folder basename', () => {
    setup()
    expect(screen.getByRole('textbox', { name: /session name/i })).toHaveValue('vimeflow-core')
  })

  test('reopening with a new defaultCwd refreshes path + name', () => {
    const { rerender } = render(
      <NewSessionDialog open={false} onOpenChange={vi.fn()} onCreate={vi.fn()} defaultCwd="~/code/alpha" />
    )
    rerender(<NewSessionDialog open onOpenChange={vi.fn()} onCreate={vi.fn()} defaultCwd="~/code/beta" />)
    expect(screen.getByRole('textbox', { name: /session name/i })).toHaveValue('beta')
  })

  test('Create emits onCreate with name, cwd, layout and panes', async () => {
    const { onCreate } = setup()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /create session/i }))
    expect(onCreate).toHaveBeenCalledWith({
      name: 'vimeflow-core',
      cwd: '~/code/vimeflow-core',
      layout: 'single',
      panes: [{ command: 'claude' }],
    })
  })

  test('Cancel closes without creating', async () => {
    const { onCreate, onOpenChange } = setup()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onCreate).not.toHaveBeenCalled()
  })

  test('typing a name then reset restores the folder basename', async () => {
    setup()
    const user = userEvent.setup()
    const input = screen.getByRole('textbox', { name: /session name/i })
    await user.clear(input)
    await user.type(input, 'custom')
    await user.click(screen.getByRole('button', { name: /reset/i }))
    expect(input).toHaveValue('vimeflow-core')
  })
})
```

- [ ] **Step 2: Run — expect FAIL.** Implement `NewSessionDialog.tsx`:

```tsx
import { useEffect, useState, type ReactElement } from 'react'
import { Dialog } from '@/components/Dialog'
import { Button } from '@/components/Button'
import { IconButton } from '@/components/IconButton'
import { LAYOUTS } from '../../../terminal/layout-registry'
import type { CommandId, CreateSessionOptions, PaneLayoutId } from '../../types'
import { deriveSessionName } from '../../utils/sessionPaths'
import { LayoutPicker } from './LayoutPicker'
import { CommandBoard } from './CommandBoard'
import { WorkingDirectoryField } from './WorkingDirectoryField'

interface NewSessionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (opts: CreateSessionOptions) => void
  defaultCwd: string
}

const DEFAULT_ASSIGN: CommandId[] = ['claude', 'shell', 'shell', 'shell']
const LABEL = 'text-[10.5px] font-semibold uppercase tracking-[0.08em] text-on-surface-muted'

export const NewSessionDialog = ({
  open,
  onOpenChange,
  onCreate,
  defaultCwd,
}: NewSessionDialogProps): ReactElement => {
  const [path, setPath] = useState(defaultCwd)
  const [name, setName] = useState(() => deriveSessionName(defaultCwd))
  const [nameEdited, setNameEdited] = useState(false)
  const [layoutId, setLayoutId] = useState<PaneLayoutId>('single')
  const [pinnedLayout, setPinnedLayout] = useState<PaneLayoutId | null>(null)
  const [assign, setAssign] = useState<CommandId[]>(DEFAULT_ASSIGN)

  // The dialog stays mounted across open/close (Dialog drives visibility via its
  // `open` prop), so re-initialize from the latest snapshot each time it opens.
  useEffect(() => {
    if (!open) return
    setPath(defaultCwd)
    setName(deriveSessionName(defaultCwd))
    setNameEdited(false)
    setLayoutId('single')
    setPinnedLayout(null)
    setAssign(DEFAULT_ASSIGN)
  }, [open, defaultCwd])

  const layout = LAYOUTS[layoutId]
  const folder = deriveSessionName(path)

  const applyPath = (next: string): void => {
    setPath(next)
    if (!nameEdited) setName(deriveSessionName(next))
  }

  const handleCreate = (): void => {
    const panes = Array.from({ length: layout.capacity }, (_, i) => ({
      command: assign[i] ?? 'shell',
    }))
    onCreate({ name, cwd: path, layout: layoutId, panes })
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      placement="center"
      panelClassName="w-[min(560px,100%)] max-w-none"
      aria-label="New session"
    >
      {/* header */}
      <div className="flex items-center gap-2.5 border-b border-outline-variant/25 px-5 py-4">
        <span className="material-symbols-outlined text-base text-primary-container" aria-hidden="true">bolt</span>
        <span className="flex-1 text-[14.5px] font-semibold text-on-surface">New session</span>
        <IconButton icon="close" label="Close" onClick={() => onOpenChange(false)} />
      </div>

      {/* scroll body */}
      <div className="vfscroll h-[min(600px,70vh)] overflow-auto px-5 pb-6 pt-4.5">
        <label className={LABEL} htmlFor="new-session-name">Session name</label>
        <div className="mt-2 flex items-center gap-2.5 rounded-[9px] bg-surface-container-lowest px-3 py-2.5">
          <span className="material-symbols-outlined text-[15px] text-on-surface-muted" aria-hidden="true">edit</span>
          <input
            id="new-session-name"
            aria-label="Session name"
            spellCheck={false}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setNameEdited(true)
            }}
            className="flex-1 bg-transparent text-[13px] font-medium text-on-surface outline-none"
          />
          {nameEdited ? (
            <button
              type="button"
              onClick={() => {
                setNameEdited(false)
                setName(deriveSessionName(path))
              }}
              className="rounded-full border border-primary-container/40 px-2 py-0.5 font-mono text-[9.5px] text-primary-container"
            >
              reset
            </button>
          ) : (
            <span className="rounded-full border border-outline-variant/50 px-2 py-0.5 font-mono text-[9.5px] text-on-surface-muted">
              folder name
            </span>
          )}
        </div>

        <label className={`${LABEL} mt-4.5 block`}>Working directory</label>
        <div className="mt-2">
          <WorkingDirectoryField path={path} onChange={applyPath} />
        </div>

        <div className="mt-4.5 flex min-h-[232px] items-start gap-4">
          <div className="w-[158px] shrink-0">
            <label className={LABEL}>Layout</label>
            <div className="mt-2">
              <LayoutPicker
                layoutId={layoutId}
                pinnedLayout={pinnedLayout}
                onSelect={setLayoutId}
                onPin={setPinnedLayout}
              />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <label className={LABEL}>Starting command</label>
            <div className="mt-0.5 text-[11px] text-on-surface-muted">
              click a panel to choose what it opens with
            </div>
            <div className="mt-2.5">
              <CommandBoard
                layoutId={layoutId}
                assign={assign}
                onAssign={(i, command) =>
                  setAssign((prev) => {
                    const next = [...prev]
                    next[i] = command
                    return next
                  })
                }
              />
            </div>
          </div>
        </div>
      </div>

      {/* footer */}
      <div className="flex items-center gap-2.5 border-t border-outline-variant/20 bg-surface-container-lowest/40 px-5 py-3.5">
        <span className="flex-1 font-mono text-[11px] text-on-surface-muted">
          {layout.capacity} pane{layout.capacity > 1 ? 's' : ''} · {folder}
        </span>
        <Button variant="default" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="flat-primary" leadingIcon="bolt" onClick={handleCreate}>Create session</Button>
      </div>
    </Dialog>
  )
}
```

Then `index.ts`:

```ts
export { NewSessionDialog } from './NewSessionDialog'
```

> If `pt-4.5` / `mt-4.5` aren't valid Tailwind spacing in this config, substitute the nearest valid step (e.g. `pt-4`/`pt-5`). Verify during the lint/type step.

- [ ] **Step 3: Run — expect PASS.** `npx vitest run src/features/sessions/components/NewSessionDialog/NewSessionDialog.test.tsx`

- [ ] **Step 4: Commit.**

```bash
git add src/features/sessions/components/NewSessionDialog/NewSessionDialog.tsx src/features/sessions/components/NewSessionDialog/NewSessionDialog.test.tsx src/features/sessions/components/NewSessionDialog/index.ts
git commit -m "feat(sessions): new-session dialog component"
```

---

## Task 12: `useNewSessionDialog` hook

Holds `open` + `defaultCwd`; opening recomputes `defaultCwd` from the active session.

**Files:** Create `src/features/workspace/hooks/useNewSessionDialog.ts` + `.test.ts`

- [ ] **Step 1: Failing test** — `useNewSessionDialog.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { useNewSessionDialog } from './useNewSessionDialog'

describe('useNewSessionDialog', () => {
  test('open() snapshots the provided cwd; close() resets open', () => {
    const { result } = renderHook(() => useNewSessionDialog())
    expect(result.current.open).toBe(false)
    act(() => result.current.openWith('/Users/x/proj'))
    expect(result.current.open).toBe(true)
    expect(result.current.defaultCwd).toBe('/Users/x/proj')
    act(() => result.current.setOpen(false))
    expect(result.current.open).toBe(false)
  })

  test('openWith falls back to ~ when no cwd given', () => {
    const { result } = renderHook(() => useNewSessionDialog())
    act(() => result.current.openWith(undefined))
    expect(result.current.defaultCwd).toBe('~')
  })
})
```

- [ ] **Step 2: Run — expect FAIL.** Implement `useNewSessionDialog.ts`:

```ts
import { useCallback, useState } from 'react'

export interface NewSessionDialogState {
  open: boolean
  defaultCwd: string
  openWith: (cwd: string | undefined) => void
  setOpen: (open: boolean) => void
}

export const useNewSessionDialog = (): NewSessionDialogState => {
  const [open, setOpen] = useState(false)
  const [defaultCwd, setDefaultCwd] = useState('~')
  const openWith = useCallback((cwd: string | undefined): void => {
    setDefaultCwd(cwd ?? '~')
    setOpen(true)
  }, [])
  return { open, defaultCwd, openWith, setOpen }
}
```

- [ ] **Step 3: Run — expect PASS.** Commit.

```bash
git add src/features/workspace/hooks/useNewSessionDialog.ts src/features/workspace/hooks/useNewSessionDialog.test.ts
git commit -m "feat(workspace): new-session dialog open-state hook"
```

---

## Task 13: Wire into `WorkspaceView` + overlay registration

**Files:**
- Modify: `src/features/workspace/WorkspaceView.tsx`
- Modify: `src/features/workspace/overlays/WorkspaceOverlayRegistrations.tsx` + `.test.tsx`

- [ ] **Step 1: Register the overlay (failing test first).** In `WorkspaceOverlayRegistrations.test.tsx`, add a case asserting `new-session-dialog` registers when `newSessionDialogOpen` is true (mirror the existing `unsaved-changes-dialog` assertion in that file). Run it — expect FAIL.

- [ ] **Step 2: Implement the registration.** In `WorkspaceOverlayRegistrations.tsx`:
  - add `newSessionDialogOpen: boolean` to `WorkspaceOverlayRegistrationsProps`;
  - destructure it in the component signature;
  - add (next to the `unsaved-changes-dialog` call):

```tsx
  useOverlayRegistration({
    id: 'new-session-dialog',
    plane: 'dialog',
    isOpen: newSessionDialogOpen,
    nativeOcclusion: 'global',
  })
```

- [ ] **Step 3: Run — expect PASS.** `npx vitest run src/features/workspace/overlays/WorkspaceOverlayRegistrations.test.tsx`

- [ ] **Step 4: Wire `WorkspaceView`.** Edits:
  - Import the hook + dialog:

```tsx
import { useNewSessionDialog } from './hooks/useNewSessionDialog'
import { NewSessionDialog } from '../sessions/components/NewSessionDialog'
```

  - Instantiate the hook (near other dialog state, ~line 1016):

```tsx
  const newSessionDialog = useNewSessionDialog()
```

  - Add an open handler that snapshots the active session's cwd (near `handleCreateSession`, ~line 1464):

```tsx
  const handleOpenNewSession = useCallback((): void => {
    const activeCwd = sessions.find((s) => s.id === activeSessionId)?.workingDirectory
    newSessionDialog.openWith(activeCwd)
  }, [activeSessionId, newSessionDialog, sessions])
```

  - Point the button (`~line 2551`) and the shortcut (`~line 1635`) at the opener instead of `handleCreateSession`:

```tsx
                      onClick={handleOpenNewSession}
```
```tsx
    onNewSession: handleOpenNewSession,
```

  - Pass the flag to the overlay registrations (in the `<WorkspaceOverlayRegistrations …>` props, ~line 2405):

```tsx
        newSessionDialogOpen={newSessionDialog.open}
```

  - Render the dialog (near the `<UnsavedChangesDialog … />` render, ~line 2841):

```tsx
      <NewSessionDialog
        open={newSessionDialog.open}
        onOpenChange={newSessionDialog.setOpen}
        defaultCwd={newSessionDialog.defaultCwd}
        onCreate={(opts) => {
          createSession(opts)
          claimTerminal()
        }}
      />
```

  - Leave `handleCreateSession` in place — it still backs the command-palette command and auto-create (no change needed there).

- [ ] **Step 5: Add wiring tests** to `WorkspaceView`'s test suite (or the nearest existing WorkspaceView test file), mirroring the existing WorkspaceView test setup. Two cases:
  - **Button:** clicking `sidebar-new-session` opens the dialog (assert `role="dialog"` with name "New session" appears) and does NOT instant-create (`createSession` mock not called on click).
  - **⌘N shortcut:** dispatching the new-session chord (`await user.keyboard('{Meta>}n{/Meta}')` on macOS modifier, or `{Control>}{Shift>}n{/Shift}{/Control}` otherwise — match `preferModifier` in the test harness) opens the same dialog and likewise does not instant-create. This is the explicit ⌘N coverage.

  Run — expect PASS.

- [ ] **Step 6: Commit.**

```bash
git add src/features/workspace/WorkspaceView.tsx src/features/workspace/overlays/WorkspaceOverlayRegistrations.tsx src/features/workspace/overlays/WorkspaceOverlayRegistrations.test.tsx
git commit -m "feat(workspace): open new-session dialog from button + shortcut"
```

---

## Task 14: Repo-wide quality gates

**Files:** none (verification only).

- [ ] **Step 1: Lint (repo-wide).** Run: `npm run lint` — Expected: 0 errors. Fix any `no-hardcoded-colors` / explicit-return-type / import-boundary violations.

- [ ] **Step 2: Format.** Run: `npm run format:check` — if it fails, `npm run format` and re-stage.

- [ ] **Step 3: Type-check.** Run: `npm run type-check` — Expected: clean (includes electron/bridge tsconfigs).

- [ ] **Step 4: Full test suite.** Run: `npm run test` — Expected: all green.

- [ ] **Step 5: Commit any formatting fixups.**

```bash
git add -A
git commit -m "chore(sessions): lint/format/type fixups for new-session dialog"
```

---

## Self-Review (author checklist — done before handoff)

- **Spec coverage:** §1 goals → Tasks 4 (multi-pane + fixed cwd), 13 (button+⌘N open dialog), 2 (folder picker). §2 components → Tasks 5-12. §2.6 path parsing → Task 3. §3.1 modal shell → Task 1 (`panelClassName`) + Task 11. §3.2-3.4 tokens/icons → Tasks 6-11 (semantic tokens, Material Symbols, `font-mono`). §4 API → Tasks 3-4. §4.3 IPC → Task 2. §5 wiring + overlay → Task 13. Tests per file → every task. Gates → Task 14.
- **Placeholder scan:** no TBD/TODO; every code step has full code. Two explicit "verify during impl" notes (Tailwind spacing steps, `BROWSER_IDENTITY` export name) are guardrails, not deferrals.
- **Type consistency:** `CommandId`/`CreateSessionOptions`/`NewPaneSpec` defined in Task 3, consumed in Tasks 4-11; `commandToPane` shape `{kind,userLabel?}` consistent across Tasks 3-4; `panelClassName` defined in Task 1, used in Task 11; `pickDirectory` defined Task 8, mocked in Task 8 field test; `deriveSessionName` defined Task 3, used Tasks 4 + 11.

<!-- codex-reviewed: 2026-06-25T05:07:06Z -->

# Global Panel UI State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the right activity-panel collapse state and the dock state (open/tab/position) workspace-global and persisted in dedicated frontend UI stores, so every session shares one consistent layout; remove the per-session `activityPanelCollapsed` state from the session model, the Electron IPC allowlist, and the Rust backend session cache.

**Architecture:** Follow the existing `sidebarCollapsedStore.ts` pattern — a tiny module-level pub/sub store seeded from `localStorage`, consumed via `useSyncExternalStore` hooks. Two new stores under `src/features/workspace/utils/` (`activityPanelCollapsedStore.ts`, `dockStore.ts`) with matching hooks under `src/features/workspace/hooks/`. `WorkspaceView.tsx` swaps its per-session read and its three dock `useState`s for these hooks. The per-session field, its hydration, the dead `set_session_activity_panel_collapsed` IPC, and the Rust cache field are deleted.

**Tech Stack:** React 19 (`useSyncExternalStore`), TypeScript (ESM, no semicolons, single quotes, trailing commas es5), Vitest, Rust + ts-rs bindings.

> **Review history:** v1 of this plan was reviewed by `codex exec` (read-only) against the codebase on 2026-07-30. All 8 findings were verified by hand and are incorporated below: hand-maintained bindings barrel, `cache.rs` field-specific tests, Electron `backend-methods.ts` allowlist, mock cleanups (`command-palette`/`SplitView`), top-chrome seeding rewrite, dual-store test resets, stale line refs, and missing fresh-load coverage.

---

## Current state (verified by code reading, 2026-07-30)

- **Left sidebar**: already global — `src/features/workspace/utils/sidebarCollapsedStore.ts`, key `vimeflow:workspace:sidebarCollapsed`. No work needed.
- **Right activity panel**: per-session. `Session.activityPanelCollapsed` (`src/features/sessions/types/index.ts:147-151`), hydrated in `sessionFromInfo.ts:51` / `groupSessionsFromInfos.ts:179,413` from per-session localStorage keys `vimeflow:sessions:activityPanelCollapsed:<id>` (`src/features/sessions/utils/activityPanelCollapsedStore.ts`), written by `useSessionManager.setSessionActivityPanelCollapsed` (`useSessionManager.ts:3120-3135`), read at `WorkspaceView.tsx:920`.
- **Dock**: runtime-global (single `WorkspaceView` instance) but never persisted — three `useState`s at `WorkspaceView.tsx:1272-1274`.
- **Rust backend**: `SessionInfo.activity_panel_collapsed: Option<bool>` (`crates/backend/src/terminal/types.rs:236-238`), cached per session in `CachedSession` (`crates/backend/src/terminal/cache.rs:25-27`, serde-persisted to `sessions.json`), plus IPC command `set_session_activity_panel_collapsed` (`ipc.rs:550-558`, `state.rs:386-394`, `commands.rs:1064+`). The frontend never calls this IPC (dead code — only tests reference `service.setSessionActivityPanelCollapsed`).
- **Electron main**: `set_session_activity_panel_collapsed` is in the IPC allowlist `electron/backend-methods.ts:14` (asserted in `electron/backend-methods.test.ts:16`), which gates forwarding in `electron/main.ts`.

## Non-goals

- Left sidebar (already global).
- Migrating/orphaned per-session localStorage keys `vimeflow:sessions:activityPanelCollapsed:*` — they become inert; no cleanup pass (YAGNI).
- Old `sessions.json` cache files containing `activity_panel_collapsed` — removing the Rust field makes serde ignore it on load; no migration needed.
- `ViewModeToggle` markdown reading/raw mode inside `DockPanel.tsx` (separate concern).

## File structure

| File                                                                | Responsibility                                                        |
| ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `src/features/workspace/utils/activityPanelCollapsedStore.ts` (new) | Global activity-panel collapse flag + persistence + pub/sub           |
| `src/features/workspace/hooks/useActivityPanelCollapsed.ts` (new)   | `useSyncExternalStore` wrapper                                        |
| `src/features/workspace/utils/dockStore.ts` (new)                   | Global dock `{ open, tab, position }` + persistence + pub/sub         |
| `src/features/workspace/hooks/useDockState.ts` (new)                | `useSyncExternalStore` wrapper                                        |
| `src/features/workspace/WorkspaceView.tsx`                          | Consume both stores; drop per-session read and dock `useState`s       |
| `src/features/sessions/**`                                          | Remove `activityPanelCollapsed` from model, manager, hydration, mocks |
| `crates/backend/src/**`                                             | Remove cache field + dead IPC                                         |
| `electron/backend-methods.ts`                                       | Remove command from IPC allowlist                                     |
| `src/features/terminal/services/*Service.ts`                        | Remove dead `setSessionActivityPanelCollapsed` method                 |

---

### Task 1: Global activity-panel store + hook

**Files:**

- Create: `src/features/workspace/utils/activityPanelCollapsedStore.ts`
- Create: `src/features/workspace/utils/activityPanelCollapsedStore.test.ts`
- Create: `src/features/workspace/hooks/useActivityPanelCollapsed.ts`
- Create: `src/features/workspace/hooks/useActivityPanelCollapsed.test.ts`

- [ ] **Step 1: Write the failing store test**

Create `src/features/workspace/utils/activityPanelCollapsedStore.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  getActivityPanelCollapsed,
  setActivityPanelCollapsed,
  subscribeActivityPanelCollapsed,
} from './activityPanelCollapsedStore'

const STORAGE_KEY = 'vimeflow:workspace:activityPanelCollapsed'

describe('activityPanelCollapsedStore', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivityPanelCollapsed(false)
  })

  test('defaults to false when nothing is persisted', () => {
    expect(getActivityPanelCollapsed()).toBe(false)
  })

  test('set persists to localStorage and updates the snapshot', () => {
    setActivityPanelCollapsed(true)
    expect(getActivityPanelCollapsed()).toBe(true)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true')
  })

  test('set is a no-op when the value is unchanged', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeActivityPanelCollapsed(listener)
    setActivityPanelCollapsed(false)
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  test('subscribers are notified on change and unsubscribe stops notifications', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeActivityPanelCollapsed(listener)
    setActivityPanelCollapsed(true)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    setActivityPanelCollapsed(false)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  test('a fresh module load seeds from persisted localStorage', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'true')
    vi.resetModules()
    const fresh = await import('./activityPanelCollapsedStore')
    expect(fresh.getActivityPanelCollapsed()).toBe(true)
  })
})
```

Note: the store is module-level, so `beforeEach` resets via `setActivityPanelCollapsed(false)` — `localStorage.clear()` alone is not enough because `current` is cached in memory. The last test covers the fresh-load path: `vi.resetModules()` + dynamic `import()` creates a new module instance whose `current` is re-seeded from localStorage; the statically imported instance used by the other tests is unaffected.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/workspace/utils/activityPanelCollapsedStore.test.ts`
Expected: FAIL — module `./activityPanelCollapsedStore` does not exist.

- [ ] **Step 3: Write the store implementation**

Create `src/features/workspace/utils/activityPanelCollapsedStore.ts`:

```ts
// UI-only persistence + subscription for the right activity-panel collapse
// preference. This is a WORKSPACE-GLOBAL choice (one flag for the app, not
// per-session) so the panel stays collapsed/expanded as you switch sessions.
// Mirrors features/workspace/utils/sidebarCollapsedStore (SSR / sandboxed
// contexts / quota errors all fall back to the default, never throw).
//
// A tiny pub/sub backs `useSyncExternalStore` so the fixed toggle, the
// activity-panel shortcut, and the command palette entry all stay in sync
// the instant the flag changes.

const STORAGE_KEY = 'vimeflow:workspace:activityPanelCollapsed'

const getStorage = (): Storage | null => {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const readPersisted = (): boolean => {
  const storage = getStorage()
  if (!storage) {
    return false
  }
  try {
    return storage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

let current: boolean = readPersisted()
const listeners = new Set<() => void>()

export const getActivityPanelCollapsed = (): boolean => current

export const setActivityPanelCollapsed = (collapsed: boolean): void => {
  if (collapsed === current) {
    return
  }
  current = collapsed

  const storage = getStorage()
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, collapsed ? 'true' : 'false')
    } catch {
      // Quota exceeded / private mode — the choice stays consistent in memory.
    }
  }

  listeners.forEach((listener) => {
    listener()
  })
}

export const subscribeActivityPanelCollapsed = (
  listener: () => void
): (() => void) => {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}
```

- [ ] **Step 4: Run store test to verify it passes**

Run: `npx vitest run src/features/workspace/utils/activityPanelCollapsedStore.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the failing hook test**

Create `src/features/workspace/hooks/useActivityPanelCollapsed.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'
import { setActivityPanelCollapsed } from '../utils/activityPanelCollapsedStore'
import { useActivityPanelCollapsed } from './useActivityPanelCollapsed'

describe('useActivityPanelCollapsed', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivityPanelCollapsed(false)
  })

  test('exposes the current flag and setCollapsed updates it', () => {
    const { result } = renderHook(() => useActivityPanelCollapsed())
    expect(result.current.collapsed).toBe(false)

    act(() => {
      result.current.setCollapsed(true)
    })
    expect(result.current.collapsed).toBe(true)
  })

  test('toggle flips the flag and persists it', () => {
    const { result } = renderHook(() => useActivityPanelCollapsed())

    act(() => {
      result.current.toggle()
    })
    expect(result.current.collapsed).toBe(true)
    expect(
      window.localStorage.getItem('vimeflow:workspace:activityPanelCollapsed')
    ).toBe('true')
  })
})
```

Run: `npx vitest run src/features/workspace/hooks/useActivityPanelCollapsed.test.ts`
Expected: FAIL — module `./useActivityPanelCollapsed` does not exist.

- [ ] **Step 6: Write the hook implementation**

Create `src/features/workspace/hooks/useActivityPanelCollapsed.ts`:

```ts
import { useCallback, useSyncExternalStore } from 'react'
import {
  getActivityPanelCollapsed,
  setActivityPanelCollapsed,
  subscribeActivityPanelCollapsed,
} from '../utils/activityPanelCollapsedStore'

export interface UseActivityPanelCollapsedReturn {
  collapsed: boolean
  toggle: () => void
  setCollapsed: (collapsed: boolean) => void
}

// Subscribes any component to the workspace-global activity-panel collapse
// flag. Mirrors useSidebarCollapsed: the in-memory snapshot is seeded from
// localStorage at module load, so first paint and client agree.
export const useActivityPanelCollapsed =
  (): UseActivityPanelCollapsedReturn => {
    const collapsed = useSyncExternalStore(
      subscribeActivityPanelCollapsed,
      getActivityPanelCollapsed,
      getActivityPanelCollapsed
    )

    const toggle = useCallback((): void => {
      setActivityPanelCollapsed(!getActivityPanelCollapsed())
    }, [])

    return { collapsed, toggle, setCollapsed: setActivityPanelCollapsed }
  }
```

- [ ] **Step 7: Run hook test to verify it passes**

Run: `npx vitest run src/features/workspace/hooks/useActivityPanelCollapsed.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 8: Commit**

```bash
git add src/features/workspace/utils/activityPanelCollapsedStore.ts src/features/workspace/utils/activityPanelCollapsedStore.test.ts src/features/workspace/hooks/useActivityPanelCollapsed.ts src/features/workspace/hooks/useActivityPanelCollapsed.test.ts
git commit -m "feat(workspace): add global activity-panel collapse store"
```

---

### Task 2: Dock store + hook

**Files:**

- Create: `src/features/workspace/utils/dockStore.ts`
- Create: `src/features/workspace/utils/dockStore.test.ts`
- Create: `src/features/workspace/hooks/useDockState.ts`
- Create: `src/features/workspace/hooks/useDockState.test.ts`

- [ ] **Step 1: Write the failing store test**

Create `src/features/workspace/utils/dockStore.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  getDockState,
  setDockOpen,
  setDockPosition,
  setDockTab,
  subscribeDockState,
} from './dockStore'

const STORAGE_KEY = 'vimeflow:workspace:dock'
const DEFAULT_STATE = { open: false, tab: 'diff', position: 'bottom' } as const

describe('dockStore', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setDockOpen(false)
    setDockTab('diff')
    setDockPosition('bottom')
  })

  test('defaults to closed/diff/bottom when nothing is persisted', () => {
    expect(getDockState()).toEqual(DEFAULT_STATE)
  })

  test('setters update the snapshot and persist the whole object', () => {
    setDockOpen(true)
    setDockTab('editor')
    setDockPosition('right')
    expect(getDockState()).toEqual({
      open: true,
      tab: 'editor',
      position: 'right',
    })
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '')).toEqual({
      open: true,
      tab: 'editor',
      position: 'right',
    })
  })

  test('setter is a no-op when the value is unchanged', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeDockState(listener)
    setDockOpen(false)
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  test('subscribers are notified once per change', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeDockState(listener)
    setDockOpen(true)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  test('a fresh module load seeds from persisted localStorage', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ open: true, tab: 'editor', position: 'left' })
    )
    vi.resetModules()
    const fresh = await import('./dockStore')
    expect(fresh.getDockState()).toEqual({
      open: true,
      tab: 'editor',
      position: 'left',
    })
  })

  test('a fresh module load falls back per-field on malformed or invalid data', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ open: true, tab: 'bogus', position: 42 })
    )
    vi.resetModules()
    const fresh = await import('./dockStore')
    expect(fresh.getDockState()).toEqual({
      open: true,
      tab: 'diff',
      position: 'bottom',
    })
  })

  test('a fresh module load falls back to defaults on unparseable JSON', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json')
    vi.resetModules()
    const fresh = await import('./dockStore')
    expect(fresh.getDockState()).toEqual(DEFAULT_STATE)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/workspace/utils/dockStore.test.ts`
Expected: FAIL — module `./dockStore` does not exist.

- [ ] **Step 3: Write the store implementation**

Create `src/features/workspace/utils/dockStore.ts`:

```ts
// UI-only persistence + subscription for the workspace dock state (open,
// active tab, position). WORKSPACE-GLOBAL: one dock for the app, shared by
// every session. Mirrors the guards in sidebarCollapsedStore (SSR /
// sandboxed contexts / quota errors fall back to the default, never throw).
//
// A tiny pub/sub backs `useSyncExternalStore`; the snapshot object identity
// changes only when a field actually changes, which keeps React re-renders
// minimal.

import type { DockPosition } from '../components/DockSwitcher'

export type DockTab = 'editor' | 'diff'

export interface DockState {
  open: boolean
  tab: DockTab
  position: DockPosition
}

const STORAGE_KEY = 'vimeflow:workspace:dock'

const DEFAULT_STATE: DockState = {
  open: false,
  tab: 'diff',
  position: 'bottom',
}

const isDockTab = (value: unknown): value is DockTab =>
  value === 'editor' || value === 'diff'

const isDockPosition = (value: unknown): value is DockPosition =>
  value === 'top' || value === 'bottom' || value === 'left' || value === 'right'

const getStorage = (): Storage | null => {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const readPersisted = (): DockState => {
  const storage = getStorage()
  if (!storage) {
    return DEFAULT_STATE
  }
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_STATE
    }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      return DEFAULT_STATE
    }
    const candidate = parsed as Partial<DockState>
    return {
      open: candidate.open === true,
      tab: isDockTab(candidate.tab) ? candidate.tab : DEFAULT_STATE.tab,
      position: isDockPosition(candidate.position)
        ? candidate.position
        : DEFAULT_STATE.position,
    }
  } catch {
    return DEFAULT_STATE
  }
}

let current: DockState = readPersisted()
const listeners = new Set<() => void>()

export const getDockState = (): DockState => current

const update = (patch: Partial<DockState>): void => {
  const next: DockState = { ...current, ...patch }
  if (
    next.open === current.open &&
    next.tab === current.tab &&
    next.position === current.position
  ) {
    return
  }
  current = next

  const storage = getStorage()
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(current))
    } catch {
      // Quota exceeded / private mode — the choice stays consistent in memory.
    }
  }

  listeners.forEach((listener) => {
    listener()
  })
}

export const setDockOpen = (open: boolean): void => update({ open })
export const setDockTab = (tab: DockTab): void => update({ tab })
export const setDockPosition = (position: DockPosition): void =>
  update({ position })

export const subscribeDockState = (listener: () => void): (() => void) => {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}
```

- [ ] **Step 4: Run store test to verify it passes**

Run: `npx vitest run src/features/workspace/utils/dockStore.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Write the failing hook test**

Create `src/features/workspace/hooks/useDockState.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test } from 'vitest'
import { setDockOpen, setDockPosition, setDockTab } from '../utils/dockStore'
import { useDockState } from './useDockState'

describe('useDockState', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setDockOpen(false)
    setDockTab('diff')
    setDockPosition('bottom')
  })

  test('exposes the dock state fields', () => {
    const { result } = renderHook(() => useDockState())
    expect(result.current.isDockOpen).toBe(false)
    expect(result.current.dockTab).toBe('diff')
    expect(result.current.dockPosition).toBe('bottom')
  })

  test('setters update the exposed state and persist', () => {
    const { result } = renderHook(() => useDockState())

    act(() => {
      result.current.setDockOpen(true)
      result.current.setDockTab('editor')
      result.current.setDockPosition('left')
    })

    expect(result.current.isDockOpen).toBe(true)
    expect(result.current.dockTab).toBe('editor')
    expect(result.current.dockPosition).toBe('left')
    expect(
      JSON.parse(window.localStorage.getItem('vimeflow:workspace:dock') ?? '')
    ).toEqual({ open: true, tab: 'editor', position: 'left' })
  })
})
```

Run: `npx vitest run src/features/workspace/hooks/useDockState.test.ts`
Expected: FAIL — module `./useDockState` does not exist.

- [ ] **Step 6: Write the hook implementation**

Create `src/features/workspace/hooks/useDockState.ts`:

```ts
import { useSyncExternalStore } from 'react'
import type { DockPosition } from '../components/DockSwitcher'
import type { DockTab } from '../utils/dockStore'
import {
  getDockState,
  setDockOpen,
  setDockPosition,
  setDockTab,
  subscribeDockState,
} from '../utils/dockStore'

export interface UseDockStateReturn {
  isDockOpen: boolean
  dockTab: DockTab
  dockPosition: DockPosition
  setDockOpen: (open: boolean) => void
  setDockTab: (tab: DockTab) => void
  setDockPosition: (position: DockPosition) => void
}

// Subscribes WorkspaceView to the workspace-global dock state. The store
// snapshot identity changes only on real changes, so re-renders stay scoped
// to actual dock mutations.
export const useDockState = (): UseDockStateReturn => {
  const state = useSyncExternalStore(
    subscribeDockState,
    getDockState,
    getDockState
  )

  return {
    isDockOpen: state.open,
    dockTab: state.tab,
    dockPosition: state.position,
    setDockOpen,
    setDockTab,
    setDockPosition,
  }
}
```

- [ ] **Step 7: Run hook test to verify it passes**

Run: `npx vitest run src/features/workspace/hooks/useDockState.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 8: Commit**

```bash
git add src/features/workspace/utils/dockStore.ts src/features/workspace/utils/dockStore.test.ts src/features/workspace/hooks/useDockState.ts src/features/workspace/hooks/useDockState.test.ts
git commit -m "feat(workspace): add persisted global dock state store"
```

---

### Task 3: Wire WorkspaceView to the two stores

**Files:**

- Modify: `src/features/workspace/WorkspaceView.tsx`
- Modify: `src/features/workspace/hooks/useSidebarShortcut.ts` (comment only)

All WorkspaceView edits are in `src/features/workspace/WorkspaceView.tsx`. Line numbers refer to the file as of 2026-07-30; match on content, not line number.

- [ ] **Step 1: Add imports**

Near the other workspace hook imports (alongside `useSidebarCollapsed`), add:

```ts
import { useActivityPanelCollapsed } from './hooks/useActivityPanelCollapsed'
import { useDockState } from './hooks/useDockState'
```

Keep the existing line 43 (`import type { DockPosition } from './components/DockSwitcher'`) and add next to it:

```ts
import type { DockTab } from './utils/dockStore'
```

Delete the local type alias at line 351:

```ts
type DockTab = 'editor' | 'diff'
```

- [ ] **Step 2: Drop the per-session manager function from the destructuring**

Delete line 399 from the `useSessionManager(...)` destructuring:

```ts
    setSessionActivityPanelCollapsed,
```

(The manager still exports it until Task 4; removing the destructure here first keeps this commit self-contained. This must land in the same edit as Step 4, since Step 4 deletes the last referencing callbacks.)

- [ ] **Step 3: Replace the dock `useState`s (lines 1272-1274)**

Replace:

```ts
const [dockPosition, setDockPosition] = useState<DockPosition>('bottom')
const [isDockOpen, setIsDockOpen] = useState(false)
const [dockTab, setDockTab] = useState<DockTab>('diff')
```

with:

```ts
// Dock panel controlled state — workspace-global, persisted (dockStore).
const {
  isDockOpen,
  dockTab,
  dockPosition,
  setDockOpen: setIsDockOpen,
  setDockTab,
  setDockPosition,
} = useDockState()
```

The `setIsDockOpen` alias keeps every existing call site (`openDock` line 1569, `closeDock` line 1583, lines 1856, 2872, 2929) untouched. `setDockTab` / `setDockPosition` signatures match the old setters, so `openDock` (1562-1574), the `buildWorkspaceCommands` wiring (2029, 2087), and the `DockPanel` props (3085-3088) are unchanged.

- [ ] **Step 4: Replace the per-session activity-panel read and handlers (lines 920-939)**

Replace:

```ts
const activityPanelCollapsed = activeSession?.activityPanelCollapsed ?? false

const activityPanelAgent = useMemo(
  () => AGENTS[agentTypeToRegistryKey(agentStatus.agentType)],
  [agentStatus.agentType]
)

const handleActivityPanelCollapsed = useCallback(
  (collapsed: boolean): void => {
    if (!activeSessionId) {
      return
    }
    setSessionActivityPanelCollapsed(activeSessionId, collapsed)
  },
  [activeSessionId, setSessionActivityPanelCollapsed]
)

const handleToggleActivityPanel = useCallback((): void => {
  handleActivityPanelCollapsed(!activityPanelCollapsed)
}, [activityPanelCollapsed, handleActivityPanelCollapsed])
```

with:

```ts
// Workspace-global activity-panel collapse flag — one flag for the app,
// shared across sessions (mirrors the left sidebar's global store).
const { collapsed: activityPanelCollapsed, toggle: handleToggleActivityPanel } =
  useActivityPanelCollapsed()

const activityPanelAgent = useMemo(
  () => AGENTS[agentTypeToRegistryKey(agentStatus.agentType)],
  [agentStatus.agentType]
)
```

`handleToggleActivityPanel` keeps its name, so the four consumers (lines 2031, 2089, 2207, 3569) and the `SidebarToggle` wiring (3566-3579) are unchanged. `activityPanelCollapsed` keeps its name, so the render block at 3583-3614 is unchanged.

- [ ] **Step 5: Update the stale comment in useSidebarShortcut**

In `src/features/workspace/hooks/useSidebarShortcut.ts:13`, replace:

```ts
/** Flip the active session's right activity-panel collapse flag. */
```

with:

```ts
/** Flip the workspace-global right activity-panel collapse flag. */
```

- [ ] **Step 6: Typecheck and run the workspace test suite**

Run: `npm run type-check:generated`
Expected: the only acceptable errors at this point are `activityPanelCollapsed`-related ones in test fixtures outside `WorkspaceView.tsx` (they are Tasks 4-5). If `WorkspaceView.tsx` itself errors, fix before continuing.

Run: `npx vitest run src/features/workspace/`
Expected: activity-panel tests that assert _per-session_ restore and dock tests that assumed fresh `useState` per render will fail — note them; they are fixed in Task 5. Everything else should pass.

- [ ] **Step 7: Commit**

```bash
git add src/features/workspace/WorkspaceView.tsx src/features/workspace/hooks/useSidebarShortcut.ts
git commit -m "feat(workspace): consume global dock and activity-panel stores in WorkspaceView"
```

---

### Task 4: Remove per-session activityPanelCollapsed from the session model

**Files:**

- Modify: `src/features/sessions/types/index.ts:147-151`
- Modify: `src/features/sessions/hooks/useSessionManager.ts` (6 sites)
- Modify: `src/features/sessions/utils/sessionFromInfo.ts`
- Modify: `src/features/sessions/utils/groupSessionsFromInfos.ts`
- Modify: `src/features/workspace/data/mockSessions.ts`
- Modify: `src/features/sessions/demo/ReorderMotionDemo.tsx`
- Modify: `src/features/workspace/types/index.ts:67`
- Delete: `src/features/sessions/utils/activityPanelCollapsedStore.ts` and its test
- Modify: `src/features/workspace/utils/sidebarCollapsedStore.ts` (comment), `src/features/editor/utils/readingStyleStore.ts` (comment)

- [ ] **Step 1: Remove the field from the Session type**

In `src/features/sessions/types/index.ts`, delete lines 147-151:

```ts
/** Session-scoped collapse state for the right agent activity panel.
 *  Shared by every pane so switching pane within a session never
 *  jumps the bar. UI-only: hydrated from localStorage by session id
 *  and persisted there on toggle. Default `false` (expanded). */
activityPanelCollapsed: boolean
```

- [ ] **Step 2: Clean up useSessionManager**

In `src/features/sessions/hooks/useSessionManager.ts`:

a) Delete the store import (lines 58-60):

```ts
import {
  deleteActivityPanelCollapsed,
  writeActivityPanelCollapsed,
} from '../utils/activityPanelCollapsedStore'
```

b) Delete the interface member (lines 179-186):

```ts
  /** Toggle the agent activity panel collapse state for ALL panes in the
   *  session at once. UI-only state — persisted via localStorage so the
   *  preference survives restart without flowing through the agent/PTY
   *  lifecycle. */
  setSessionActivityPanelCollapsed: (
    sessionId: string,
    collapsed: boolean
  ) => void
```

c) Delete `activityPanelCollapsed: false,` from the `createSession` session literal (line 1516) and from the `createBrowserSession` session literal (line 1612).

d) Delete the localStorage cleanup in `removeSession` (lines 1827-1833):

```ts
// Replaces the implicit cleanup the Rust PTY cache used to do on
// session exit. Without it, every closed session leaves a stale
// `vimeflow:sessions:activityPanelCollapsed:<id>` key in
// localStorage forever. Runs only on the happy path (after both
// kill phases settle) so a partial-kill bail-out doesn't drop
// the preference for a session the user can still see.
deleteActivityPanelCollapsed(target.id)
```

e) Delete the `setSessionActivityPanelCollapsed` callback (lines 3120-3135):

```ts
const setSessionActivityPanelCollapsed = useCallback(
  (sessionId: string, collapsed: boolean): void => {
    const session = sessionsRef.current.find((s) => s.id === sessionId)
    if (!session || session.activityPanelCollapsed === collapsed) {
      return
    }

    writeActivityPanelCollapsed(sessionId, collapsed)
    setSessions((prev) =>
      prev.map((s) =>
        s.id === sessionId ? { ...s, activityPanelCollapsed: collapsed } : s
      )
    )
  },
  []
)
```

f) Delete `setSessionActivityPanelCollapsed,` from the return object (line 3197).

- [ ] **Step 3: Remove hydration**

In `src/features/sessions/utils/sessionFromInfo.ts`:

- Delete line 5: `import { readActivityPanelCollapsed } from './activityPanelCollapsedStore'`
- Delete line 51: `    activityPanelCollapsed: readActivityPanelCollapsed(info.id),`

In `src/features/sessions/utils/groupSessionsFromInfos.ts`:

- Delete line 29: `import { readActivityPanelCollapsed } from './activityPanelCollapsedStore'`
- Delete line 179: `    activityPanelCollapsed: readActivityPanelCollapsed(workspaceId),`
- Delete line 413: `    activityPanelCollapsed: readActivityPanelCollapsed(shape.id),`

- [ ] **Step 4: Remove the field from mocks, demo, and legacy WorkspaceState**

- `src/features/workspace/data/mockSessions.ts`: delete all 5 `    activityPanelCollapsed: false,` lines (lines 13, 38, 63, 86, 111).
- `src/features/sessions/demo/ReorderMotionDemo.tsx`: delete line 64 `      activityPanelCollapsed: false,`.
- `src/features/workspace/types/index.ts`: delete line 67 `  activityPanelCollapsed: boolean` from the `WorkspaceState` interface (only consumed by its own type test; updated in Task 5).

- [ ] **Step 5: Delete the per-session store and fix stale comments**

```bash
rm src/features/sessions/utils/activityPanelCollapsedStore.ts src/features/sessions/utils/activityPanelCollapsedStore.test.ts
```

In `src/features/workspace/utils/sidebarCollapsedStore.ts` lines 4-6, replace:

```ts
// Mirrors the guards in features/editor/utils/readingStyleStore and
// features/sessions/utils/activityPanelCollapsedStore (SSR / sandboxed
// contexts / quota errors all fall back to the default, never throw).
```

with:

```ts
// Mirrors the guards in features/editor/utils/readingStyleStore (SSR /
// sandboxed contexts / quota errors all fall back to the default, never
// throw).
```

In `src/features/editor/utils/readingStyleStore.ts` line 4, replace the reference to `features/sessions/utils/activityPanelCollapsedStore` with `features/workspace/utils/sidebarCollapsedStore` (read the file first; it is a one-line comment mention).

- [ ] **Step 6: Typecheck — expect only test-fixture errors**

Run: `npm run type-check:generated`
Expected: FAIL listing only test files (`*.test.ts`/`*.test.tsx`) with `activityPanelCollapsed` excess-property / unknown-identifier errors. Any error in non-test source means a site above was missed — fix it before continuing. Enumerate remaining non-test sites any time with:

```bash
rg -n 'activityPanelCollapsed' src --glob '!*.test.*'
```

Expected after this task: matches only in the new workspace store/hook files, `src/bindings/SessionInfo.ts` + `src/bindings/index.ts` (regenerated/edited in Task 6), and the two terminal service files (Task 6).

- [ ] **Step 7: Commit**

```bash
git add -A src/features
git commit -m "refactor(sessions): drop per-session activityPanelCollapsed from session model"
```

---

### Task 5: Test fixture cleanup and store resets

**Files:**

- Modify: ~35 test files containing `activityPanelCollapsed` fixtures, mocks, or assertions (enumerate with grep below)
- Modify: every `WorkspaceView.*.test.tsx` file — add global-store resets

- [ ] **Step 1: Enumerate**

```bash
rg -ln 'activityPanelCollapsed|ActivityPanelCollapsed' src --glob '*.test.*'
```

The grep is authoritative. Known groups as of 2026-07-30:

a) **Pure object fixtures** — delete the single `activityPanelCollapsed: ...` line: `SplitView.test.tsx`, `TerminalZone.test.tsx`, `WorkspaceView.top-chrome.test.tsx` (other sites), `WorkspaceView.command-palette.test.tsx` (fixture sites), `Terminal.integration.test.tsx:37`, `Body.test.tsx`, `Body.agent-osc.test.tsx`, `WorkspaceView.subscription.test.tsx`, `Tabs.test.tsx`, `TerminalPane/index.test.tsx`, `Header.test.tsx`, `SessionIslandIndicator.test.tsx`, `SessionIsland.test.tsx`, `WorkspaceView.integration.test.tsx`, `usePaneShortcuts.test.ts`, `usePushWorkspaceGrouping.test.ts`, `acceptance.test.tsx` (keymap), `BrowserPane.test.tsx`, `WorkspaceView.visual.test.tsx`, `WorkspaceView.verification.test.tsx`, `WorkspaceView.test.tsx`, `WorkspaceView.elastic.test.tsx`, `cycleSession.test.ts`, `usePaneRenameChord.test.tsx`, `paneLifecycle.test.ts`, `agentForSession.test.ts`, `List.test.tsx`, `types/index.test.ts` (sessions), `List.motion.test.tsx`, `pickNextVisibleSessionId.test.ts`, `findBackendPane.test.ts`, `activeSessionPane.test.ts`, `useRenameState.test.ts`.

b) **Behavior tests to delete**:

- `src/features/sessions/hooks/useSessionManager.test.ts`: the `setSessionActivityPanelCollapsed` describe blocks (calls at ~3215, 3257, 6333, 6362, 6383) and the `removeSession clears the localStorage key` assertion (~3191) — keep the surrounding `removeSession` happy-path test minus that assertion.
- `src/features/sessions/utils/sessionFromInfo.test.ts`: the two tests `hydrates session.activityPanelCollapsed from localStorage` and `defaults session.activityPanelCollapsed to false when nothing persisted` (~lines 86-96), plus the now-unused `writeActivityPanelCollapsed` import.

c) **Mock cleanups (typed mocks break with excess-property errors)**:

- `src/features/workspace/WorkspaceView.command-palette.test.tsx:330` (and its import if unused after): delete `setSessionActivityPanelCollapsed: vi.fn(),` from the `SessionManager` mock.

d) **Rewrites (not deletions)**:

- `src/features/workspace/WorkspaceView.top-chrome.test.tsx:601`: the test seeds a collapsed panel via the session fixture (`{ ...mockSessions[0], activityPanelCollapsed: true }`). Replace the fixture override with a store seed _before_ render:
  ```ts
  setActivityPanelCollapsed(true)
  ```
  importing `setActivityPanelCollapsed` from `src/features/workspace/utils/activityPanelCollapsedStore` (path-relative: `../utils/activityPanelCollapsedStore` is wrong from this file — it lives next to the test under `src/features/workspace/`, so use `./utils/activityPanelCollapsedStore`).
- `src/features/workspace/types/index.test.ts`: remove `activityPanelCollapsed` from the `WorkspaceState` fixture (~line 69).
- Any WorkspaceView test asserting _per-session_ activity-panel memory (collapse in session A, switch to B, expect B expanded): rewrite to assert the flag is global — collapse, switch session, expect the panel still collapsed.

e) **Store resets in every WorkspaceView test file (CRITICAL — codex finding):** both new stores are module-global, so state now leaks across tests exactly like `sidebarCollapsedStore` already did. In each `src/features/workspace/WorkspaceView*.test.tsx` `beforeEach` (the ones that already do `localStorage.clear()`), add:

```ts
setActivityPanelCollapsed(false)
setDockOpen(false)
setDockTab('diff')
setDockPosition('bottom')
```

with matching imports from `./utils/activityPanelCollapsedStore` and `./utils/dockStore`. This is mandatory at least for `WorkspaceView.integration.test.tsx` (dock opened at ~277-343 while ~1145-1157 expects a fresh closed dock) and `WorkspaceView.top-chrome.test.tsx` (store seed from item d must not leak). Apply to all `WorkspaceView.*.test.tsx` files for uniformity.

- [ ] **Step 2: Apply the edits from Step 1**

Mechanical for groups a-c; groups d-e need the rewrites shown.

- [ ] **Step 3: Typecheck and run the full frontend suite**

Run: `npm run type-check:generated`
Expected: PASS (the terminal-service mocks that still reference `setSessionActivityPanelCollapsed` typecheck fine here because the service interface still has the method — it is removed in Task 6)

Run: `npm run test -- run`
Expected: PASS

Run: `npm run lint`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A src
git commit -m "test: update fixtures and specs for global panel UI state"
```

---

### Task 6: Remove the dead backend IPC, cache field, and Electron allowlist entry

**Files:**

- Modify: `crates/backend/src/terminal/types.rs` (SessionInfo field 236-238, `SetSessionActivityPanelCollapsedRequest` ~285-295)
- Modify: `crates/backend/src/terminal/cache.rs` (field 25-27, tests 635-688)
- Modify: `crates/backend/src/terminal/commands.rs` (`set_session_activity_panel_collapsed_inner` 1064+, cache field uses 430/866, tests/fixtures 2399, 3165, 3488, 3553, 3980-4152)
- Modify: `crates/backend/src/runtime/state.rs:386-394`
- Modify: `crates/backend/src/runtime/ipc.rs:550-558` and test 2375-2416
- Modify: `electron/backend-methods.ts:14` and `electron/backend-methods.test.ts:16`
- Modify: `src/bindings/index.ts:22` (hand-maintained barrel — regeneration does NOT touch it)
- Modify: `src/features/terminal/services/terminalService.ts` (import line 11, interface 127-129, mock impl 463-465)
- Modify: `src/features/terminal/services/desktopTerminalService.ts` (import line 21, method 363-367)
- Modify: `src/features/terminal/services/desktopTerminalService.test.ts` (test ~574)
- Modify: `src/features/terminal/components/SplitView/SplitView.test.tsx:231` (`ITerminalService` mock)

- [ ] **Step 1: Locate every Rust occurrence**

```bash
rg -n 'activity_panel_collapsed|ActivityPanelCollapsed' crates/backend
```

- [ ] **Step 2: Delete the Rust code**

- `terminal/types.rs`: delete the `activity_panel_collapsed` field (with its two `cfg_attr` lines) from `SessionInfo` (236-238), and delete the entire `SetSessionActivityPanelCollapsedRequest` struct (~285-295, including its doc comment).
- `terminal/cache.rs`: delete the `activity_panel_collapsed` field from `CachedSession` (25-27, including its doc comment and `#[serde(default)]`), and delete the two field-specific tests `activity_panel_collapsed_round_trips_through_disk` (635-661) and `missing_activity_panel_collapsed_field_loads_as_none` (663-688). Old `sessions.json` files with the field still load — serde ignores unknown fields by default; no migration.
- `terminal/commands.rs`: delete `set_session_activity_panel_collapsed_inner` (1064+), the `activity_panel_collapsed: cached.activity_panel_collapsed` mapping (866), every `activity_panel_collapsed: None,` initializer (430, 2399, 3165, 3488, 3553, and test fixtures), and the tests `set_session_activity_panel_collapsed_inner_updates_cache`, `set_session_activity_panel_collapsed_inner_errors_when_session_missing`, `list_sessions_surfaces_activity_panel_collapsed` (if the last one asserts other `list_sessions` behavior, keep it and drop only the field assertions).
- `runtime/state.rs`: delete the `set_session_activity_panel_collapsed` method (386-394).
- `runtime/ipc.rs`: delete the `"set_session_activity_panel_collapsed"` dispatch arm (550-558) and the test `dispatch_set_session_activity_panel_collapsed_envelope_decodes` (2375-2416).

- [ ] **Step 3: Remove the Electron allowlist entry**

In `electron/backend-methods.ts`, delete line 14:

```ts
  'set_session_activity_panel_collapsed',
```

In `electron/backend-methods.test.ts`, delete the same line (~16) from the expected method list.

- [ ] **Step 4: Regenerate bindings, then fix the hand-maintained barrel**

Run: `npm run generate:bindings`
Expected: `src/bindings/SetSessionActivityPanelCollapsedRequest.ts` is deleted (the `clean:bindings` script removes all bindings except `index.ts`), and `src/bindings/SessionInfo.ts` loses `activityPanelCollapsed?: boolean | null`.

`src/bindings/index.ts` is hand-maintained (its header says so, and `clean:bindings` preserves it), so regeneration does NOT remove the stale export. Manually delete line 22:

```ts
export type { SetSessionActivityPanelCollapsedRequest } from './SetSessionActivityPanelCollapsedRequest'
```

- [ ] **Step 5: Remove the frontend service methods and their mocks**

In `src/features/terminal/services/terminalService.ts`:

- Delete `SetSessionActivityPanelCollapsedRequest` from the bindings import (line 11).
- Delete the interface member (lines 127-129):

```ts
  setSessionActivityPanelCollapsed(
    request: SetSessionActivityPanelCollapsedRequest
  ): Promise<void>
```

- Delete the no-op/mock implementation (lines 463-465).

In `src/features/terminal/services/desktopTerminalService.ts`:

- Delete `SetSessionActivityPanelCollapsedRequest` from the import (line 21).
- Delete the method (lines 363-367):

```ts
  async setSessionActivityPanelCollapsed(
    request: SetSessionActivityPanelCollapsedRequest
  ): Promise<void> {
    await invoke('set_session_activity_panel_collapsed', { request })
  }
```

In `src/features/terminal/services/desktopTerminalService.test.ts`: delete the test block calling `testService.setSessionActivityPanelCollapsed(...)` (~line 574).

In `src/features/terminal/components/SplitView/SplitView.test.tsx`: delete `setSessionActivityPanelCollapsed: vi.fn(() => Promise.resolve(undefined)),` from the `makeMockService(): ITerminalService` literal (~line 231). Re-run the Step-1-style grep for the frontend to catch any other typed `ITerminalService` mocks:

```bash
rg -ln 'setSessionActivityPanelCollapsed' src electron
```

Expected after this task: zero matches anywhere.

- [ ] **Step 6: Run Rust tests and lint**

Run: `cargo test --manifest-path crates/backend/Cargo.toml`
Expected: PASS

Run: `cargo clippy --manifest-path crates/backend/Cargo.toml --all-targets -- -D warnings`
Expected: PASS (no unused imports left behind)

- [ ] **Step 7: Run frontend typecheck, lint, and affected tests**

Run: `npm run type-check`
Expected: PASS

Run: `npm run lint`
Expected: PASS (covers `electron/`)

Run: `npx vitest run src/features/terminal electron/backend-methods.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add -A crates/backend src/bindings src/features/terminal electron/backend-methods.ts electron/backend-methods.test.ts
git commit -m "refactor(backend): remove dead set_session_activity_panel_collapsed IPC and cache field"
```

---

### Task 7: Final verification

- [ ] **Step 1: Full frontend gates**

Run: `npm run lint && npm run type-check && npm run test -- run`
Expected: all PASS

- [ ] **Step 2: Full backend gates**

Run: `cargo test --manifest-path crates/backend/Cargo.toml && cargo clippy --manifest-path crates/backend/Cargo.toml --all-targets -- -D warnings`
Expected: all PASS

- [ ] **Step 3: Binding drift check**

Run: `npm run generate:bindings && git status --porcelain src/bindings`
Expected: no output (bindings already committed, no drift)

- [ ] **Step 4: Manual smoke (optional but recommended)**

```bash
npm run electron:dev
```

- Collapse the right activity panel, switch sessions → panel stays collapsed.
- Open the dock, switch to the editor tab, move it left, switch sessions → unchanged.
- Reload the app → dock and panel state restored from localStorage.
- Toggle the left sidebar → unchanged behavior (was already global).

---

## Self-review notes

- **Spec coverage**: left sidebar (no work, already global) ✓; right activity panel globalized (Tasks 1, 3, 4, 5) ✓; dock globalized + persisted (Tasks 2, 3) ✓; per-session state removed from session model, backend cache, IPC, and Electron allowlist (Tasks 4, 6) ✓; dedicated UI stores instead of persistence layer (Tasks 1-2, `localStorage` under `vimeflow:workspace:*` keys, nothing added to the Rust durable store) ✓.
- **Type consistency**: activity-panel store exports `get/set/subscribeActivityPanelCollapsed`, hook returns `{ collapsed, toggle, setCollapsed }` — matches `useSidebarCollapsed` shape. Dock store exports `getDockState/setDockOpen/setDockTab/setDockPosition/subscribeDockState` and `DockTab`/`DockState`; hook returns `{ isDockOpen, dockTab, dockPosition, setDockOpen, setDockTab, setDockPosition }`. WorkspaceView aliases `setDockOpen as setIsDockOpen` so call sites don't move. `DockPosition` stays sourced from `components/DockSwitcher.tsx` (type-only import, no runtime cycle).
- **Test isolation risk**: module-level stores leak state across tests — every new test file resets via the stores' own setters in `beforeEach`, and Task 5 group (e) adds the same resets to all existing `WorkspaceView.*.test.tsx` files. The fresh-load tests use `vi.resetModules()` + dynamic `import()` so they never disturb the statically imported instance.
- **Task ordering**: Task 3 keeps the manager export alive so typecheck errors stay confined to fixtures; Task 4 removes source-side references; Task 5 fixes fixtures while the service interface still exists; Task 6 removes the interface/IPC and the last typed mocks (`SplitView.test.tsx`, `desktopTerminalService.test.ts`) in the same commit as the interface change, so no intermediate commit has a broken typecheck other than the documented fixture-only window in Tasks 3-4.
- **Commit trailers**: `rules/common/git-workflow.md` requires the `Co-Authored-By: codex` trailer only for commits Codex participated in. Codex reviewed this plan but will not author the implementation commits, so the plan's commit commands carry no trailer. If the executor pair-programs with Codex on any task, append the trailer to that task's commit.

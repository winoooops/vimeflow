# Browser pane — navigation controls (L2: history-wired back / forward / reload↔stop)

## 1. Overview & scope

### Context

L1 (`2026-06-03-browser-pane-chrome-redesign-design.md`, PR #338) shipped the Arc
two-row chrome with the toolbar's three nav buttons — back · forward · reload
(`BrowserToolbar.tsx:15-19`) — rendered **`disabled`** and non-interactive, in their
final slots. L1 §5.1 fixed the L2 contract verbatim: _"L2 supplies `canGoBack` /
`canGoForward` / `isLoading` (history events) + the handlers, and the reload slot
becomes the reload↔stop toggle. L2 changes enablement + handlers only — no DOM/layout
change."_

The backend has no history-aware navigation today: `electron/browser-pane.ts` wires
`did-navigate` / `did-navigate-in-page` / `page-title-updated` → `url-changed` (for the
address bar) but exposes no back/forward/reload/stop command and no `canGoBack` /
`canGoForward` / `isLoading` signal. This is **#316 Phase 2a**.

### What L2 delivers

1. **History actions** on the active tab's `webContents` — back · forward · reload ·
   stop — reachable from the renderer over a single nav-action IPC command.
2. **A live nav-state signal** — `{ canGoBack, canGoForward, isLoading }` for the active
   tab, carried in a `{ sessionId, paneId, tabId }` envelope so each pane/tab updates only
   its own toolbar — pushed over a dedicated event (driven by the tab's navigation +
   loading lifecycle) and hydrated from the pane-create snapshot, so a renderer reattaching
   to an existing native tab is never left with stale history state.
3. **The lit-up toolbar** — back/forward enable from history depth; the reload button
   toggles to **stop** (`refresh` ↔ `close`) while loading. Same slots, same classes as
   L1 — zero re-layout.

### In scope (L2)

- Main-process navigation API on the active tab's `webContents` — Electron 42
  `navigationHistory.{goBack,goForward,canGoBack,canGoForward}` for history, plus
  `webContents.{reload,stop,isLoading}` for reload/stop/loading — and a per-tab nav-state
  emitter wired to `did-navigate` / `did-navigate-in-page` / `did-start-loading` /
  `did-stop-loading`, re-fired on tab activation and snapshot on pane create (§2).
- One new IPC **command** channel `BROWSER_PANE_NAV_ACTION` carrying `{ ...ref, action }`
  (`back | forward | reload | stop`) and one new **event** channel
  `BROWSER_PANE_NAV_STATE_CHANGED` (§3) — the standard browser-pane 5-file wiring
  (channels · `browser-pane.ts` · preload · types · browserBridge).
- Renderer: `BrowserPane` owns the active tab's nav-state + the action handlers and
  subscribes to the event; `BrowserToolbar` applies enablement + the reload↔stop toggle (§4).

### Out of scope (L2) — deferred

- **Real favicons + the live load bar / spinner (L3 / #316 2b).** `isLoading` here drives
  **only** the reload↔stop button swap; no load bar renders (L1 §5.3 reserves no space —
  the native `WebContentsView` paints above React, so L3 must site it in the chrome layer).
- **Keyboard navigation shortcuts** (Alt+←/→, ⌘[ / ⌘]) — 2a scopes to the toolbar buttons;
  history-by-keyboard is a later enhancement.
- Long-press history menus, forward-stack dropdowns, swipe-nav — not in the handoff.
- No change to the `WebContentsView` host, tab lifecycle, partitions, bounds, the
  address-bar state machine, or `open-external` — L2 only wires history onto the existing
  active-tab model.

### Success criteria (detail in §5)

1. Back/forward reflect real history depth and navigate the active tab; each is `disabled`
   exactly when its `canGo*` is false.
2. The reload button reloads when idle and **stops** an in-flight load — icon, `aria-label`,
   and handler all toggle on `isLoading`.
3. Switching tabs immediately shows the newly-active tab's history/loading state (no stale
   enablement).
4. Zero chrome re-layout: enablement + handlers + the reload-icon swap only (L1 slots/classes
   unchanged).
5. `npm run lint`, `npm run type-check`, `npm run test` pass; the new main-process + component
   behavior is covered.

## 2. Main-process navigation (actions + per-tab state emitter)

### 2.1 The active-tab navigation API

All actions operate on the **active tab's** `webContents`, resolved main-side via the
existing `activeWebContents(record)` (`browser-pane.ts:852`) — never a renderer-supplied
target (mirrors `open-external`'s main-authoritative resolution, L1 §5.4). Electron 42
moves history off the top-level `webContents` onto `webContents.navigationHistory`:

| action    | call                               | guard                                         |
| --------- | ---------------------------------- | --------------------------------------------- |
| `back`    | `wc.navigationHistory.goBack()`    | only if `wc.navigationHistory.canGoBack()`    |
| `forward` | `wc.navigationHistory.goForward()` | only if `wc.navigationHistory.canGoForward()` |
| `reload`  | `wc.reload()`                      | —                                             |
| `stop`    | `wc.stop()`                        | —                                             |

A single private `runNavAction(record, action)` resolves the active webContents, applies
the guarded action, and no-ops when there is no active tab or the view is destroyed (the
defensive shape the other handlers use). The guards make a stale renderer — a button
enabled a frame longer than history allows — harmless: the worst case is a dropped
action, never a crash.

### 2.2 The nav-state signal

`{ canGoBack, canGoForward, isLoading }` is read from a tab's `webContents`:
`navigationHistory.canGoBack()`, `navigationHistory.canGoForward()`, `isLoading()`.

A new private `emitPaneNavStateChanged(record, tabId)` mirrors `emitPaneUrlChanged`
(`browser-pane.ts:823` / `:959`). It is the **single authority on which tab the toolbar
shows**: it no-ops unless `record.activeTabId === tabId`, so only the active tab's state
ever reaches the renderer (which therefore applies every event it receives without any
active-tab filtering of its own, §2.5). When it does fire it resolves the tab's
webContents, builds the payload, and sends it over the **window's** webContents (the app
renderer) — `win.webContents.send(BROWSER_PANE_NAV_STATE_CHANGED, { sessionId, paneId,
tabId, canGoBack, canGoForward, isLoading })` — the same target as `url-changed`, **not**
the page view's webContents. It also no-ops if the window or view is destroyed.

### 2.3 Emitter triggers — the tab's load/history lifecycle

The emitter is wired onto each tab's `webContents` alongside the existing url-changed
listeners:

| webContents event      | drives                                                       |
| ---------------------- | ------------------------------------------------------------ |
| `did-navigate`         | full commit — `canGoBack/Forward` (history depth) may change |
| `did-navigate-in-page` | SPA / in-page history push — `canGo*` changes with no reload |
| `did-start-loading`    | `isLoading` → true (reload button → **stop**)                |
| `did-stop-loading`     | `isLoading` → false (reload button → **refresh**)            |

The two loading events carry the transition `did-navigate` cannot — loading starts before
any URL commits — so `isLoading` stays exact across fresh loads and reloads alike.

### 2.4 One installer, both view-setup paths

L1 wires the url-changed listeners in **two** places — the create path's first tab
(`browser-pane.ts:823-828`) and the new-tab path (`:959-964`). L2 routes its four
listeners through a single private `installNavStateEmitters(record, view, tabId)` invoked
from both, so the nav-state wiring lives once. (L2 does **not** refactor L1's duplicated
url-changed listeners — it only declines to add a third duplicate.)

### 2.5 Active-tab changes: emit at every transition

Because `emitPaneNavStateChanged` is active-tab-gated (§2.2), the renderer applies **every**
nav-state event it receives — no active-tab filtering of its own, so no ordering dependency
on the tabs/url event stream (a switch event can never be mistaken for a background tab's).
The cost of that simplicity: main must emit at **every** point `activeTabId` changes on a
live pane.

| transition                                     | site                                                  | covers                                                                   |
| ---------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------ |
| click / new-tab / close-fallback               | `setActiveTab` (`browser-pane.ts:1133`)               | `activateTab` `:1286`, new-tab activation `:997`, close-fallback `:1319` |
| active tab's view destroyed, **pane survives** | the two `destroyed` handlers (`:802-806`, `:989-993`) | a crashed/closed active tab whose `activeTabId` falls back to a sibling  |

`setActiveTab` calls `emitPaneNavStateChanged(record, record.activeTabId)` after updating
`activeTabId`; each `destroyed` handler does the same after its fallback reassignment
(alongside the existing `applyRecordBounds` + `emitTabsChanged`). Active-tab gating means a
background tab finishing a load never moves the toolbar, while a switch always lands the new
active tab's state.

### 2.6 Initial state + reconnect hydration (subscribe-before-create)

`createPane` returns the active tab's nav-state in its result snapshot —
`BrowserPaneCreateResult` gains `navState: { canGoBack, canGoForward, isLoading }` — for
the toolbar's first paint. This is load-bearing on **reconnect**: a renderer reload
reattaches to the _existing_ native record (`browser-pane.ts:715-728`), whose active tab
may already carry real history depth; without the snapshot the toolbar would read
`{ false, false, false }` until the next navigation.

But a snapshot alone races the event stream — a `did-stop-loading` can fire between main
building the snapshot and the renderer registering its listener, stranding a stale
`isLoading`. So the order is **subscribe-before-create** (§4): the renderer registers the
nav-state listener **synchronously, before** it awaits `createPane`, so no event in the
create window is lost. The snapshot is then applied only as the **initial seed** — guarded
by a "have we already received a live event?" ref so a late-resolving create result never
clobbers a fresher event. (Nav-state is idempotent last-write-wins, so the ref suffices;
no per-event offset is needed.) A fresh tab seeds `{ false, false, false }`, and the first
load's `did-start-loading` → `did-stop-loading` refine `isLoading` live.

## 3. IPC contract

L2 adds **one command** and **one event** to the browser-pane channel set, plus a
`navState` field on the existing create result — all via the established browser-pane 5-file wiring
(the set L1's `open-external` touched, L1 §5.4): channel constant · `browser-pane.ts`
handler/emitter · `preload.ts` exposure · `types.ts` contract · `browserBridge.ts` wrapper.

### 3.1 New channels

| File                                | Add                                                                                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `electron/browser-pane-channels.ts` | `BROWSER_PANE_NAV_ACTION = 'browser-pane:nav-action'` (command) · `BROWSER_PANE_NAV_STATE_CHANGED = 'browser-pane:nav-state-changed'` (event) |

### 3.2 Command: `nav-action`

One `invoke` channel for the closed verb set — single handler, single preload entry,
single bridge wrapper (option A: ¼ the surface of four channels; one place to resolve the
active tab + guard).

```ts
// types.ts
export type BrowserPaneNavActionKind = 'back' | 'forward' | 'reload' | 'stop'

export interface BrowserPaneNavActionRequest extends BrowserPaneRef {
  action: BrowserPaneNavActionKind
}
```

- **`browser-pane.ts`**: `ipcMain.handle(BROWSER_PANE_NAV_ACTION, …)` → locate record →
  `runNavAction(record, action)` (§2.1). Unknown `action` / absent active tab → no-op.
- **`preload.ts`**: `browserPane.navAction(request)` → `ipcRenderer.invoke(BROWSER_PANE_NAV_ACTION, request)` (mirrors `navigate`).
- **`browserBridge.ts`**: `navActionBrowserPane(request)` wrapper (no-op when bridge absent).
- **`types.ts`**: `BrowserPaneBridge.navAction: (request: BrowserPaneNavActionRequest) => Promise<void>`.

### 3.3 Event: `nav-state-changed`

```ts
// types.ts
export interface BrowserPaneNavState {
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
}

export interface BrowserPaneNavStateChangedEvent extends BrowserPaneNavState {
  sessionId: string
  paneId: string
  tabId: string
}
```

- **`browser-pane.ts`**: `emitPaneNavStateChanged(record, tabId)` (§2.2) sends over the
  window webContents; wired via `installNavStateEmitters` (§2.4) + on activate (§2.5).
- **`preload.ts`**: `onNavStateChange(cb)` subscription, mirroring `onUrlChange`.
- **`browserBridge.ts`**: `onBrowserPaneNavStateChange(cb)` wrapper.
- **`types.ts`**: `BrowserPaneBridge.onNavStateChange: (cb: (e: BrowserPaneNavStateChangedEvent) => void) => () => void`.

### 3.4 Create-result snapshot

`BrowserPaneCreateResult` (`types.ts` + the main-side builder) gains the initial nav-state
so the renderer hydrates synchronously (§2.6):

```ts
export interface BrowserPaneCreateResult {
  url: string
  title: string | null
  partition: string
  tabs: BrowserPaneTab[]
  navState: BrowserPaneNavState // ← new: active tab's { canGoBack, canGoForward, isLoading }
}
```

Both the event and the snapshot reuse `BrowserPaneNavState`: the event spreads it at top
level (matching the existing flat events like `url-changed`), while the create result nests
it as `navState`. The renderer seeds from `result.navState` and normalizes each event with
a one-line `pick` (§4).

### 3.5 Wiring checklist

The silent-failure trap (new-IPC checklist): a missing wire-up that unit tests still pass.

- **Command** (`nav-action`): channel + `ipcMain.handle` (`:626-662`) + its matching
  `ipcMain.removeHandler` in `dispose()` (`browser-pane.ts:667`, which tears down every
  handler — omitting it leaks a stale handler after teardown) + preload + bridge + types.
- **Event** (`nav-state-changed`): channel + emitter + preload + bridge + types.
- **Create result**: the `navState` field on **every** `BrowserPaneCreateResult` — the
  renderer `types.ts` interface, the **main-process-local** interface (`browser-pane.ts:107`,
  a separate declaration across the main/renderer boundary, like the duplicated
  `DEFAULT_BROWSER_URL`), **both** main builders (create return `:835-840` **and** reconnect
  `:715-728`), and the renderer-side bridge-absent fallback (`browserBridge.ts:36-50`).
  Because the boundary blocks sharing the type, main carries its own inline nav-state shape
  (`{ canGoBack; canGoForward; isLoading }`); only the renderer side uses `BrowserPaneNavState`.

§5 asserts the preload/bridge mapping directly.

## 4. Renderer wiring

L1 left `BrowserToolbar`'s three nav buttons hard-`disabled` with no handlers
(`BrowserToolbar.tsx:33-50`). L2 makes `BrowserPane` own the active tab's nav-state +
the action handlers and threads them through — no markup/class changes beyond the
`disabled`/`onClick` props and the reload icon swap.

### 4.1 Container state (`BrowserPane`)

One `navState` (main already gates emits to the active tab, §2.5 — the renderer keeps no
per-tab map and does no tabId filtering):

```ts
const [navState, setNavState] = useState<BrowserPaneNavState>({
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
})
const receivedLiveNavRef = useRef(false) // guards the create-seed (§2.6)
```

### 4.2 Subscribe-before-create + guarded seed (§2.6)

The nav-state wiring lives **inside the create effect** (keyed on `browserSessionId` /
`pane.id`), so it re-runs whenever the pane identity changes — and the create window never
drops an event:

- **Reset the guard first**: `receivedLiveNavRef.current = false` at the top of the effect,
  so a new create lifecycle (the effect re-running for a changed `browserSessionId` /
  `pane.id` **without** a remount) starts fresh — a prior lifecycle's events can't suppress
  the new `result.navState`.
- **Subscribe before the `await createBrowserPane(...)`** — not in a separate later effect
  like `onUrlChange` — filtering only by **this pane** (`sessionId`/`paneId`; _not_ `tabId`
  — main already emits active-tab-only):

  ```ts
  const pick = (e: BrowserPaneNavStateChangedEvent): BrowserPaneNavState => ({
    canGoBack: e.canGoBack,
    canGoForward: e.canGoForward,
    isLoading: e.isLoading,
  })
  const off = onBrowserPaneNavStateChange((e) => {
    if (e.sessionId !== browserSessionId || e.paneId !== pane.id) return
    setNavState(pick(e))
    receivedLiveNavRef.current = true
  })
  ```

  Its unsubscribe is returned in the effect cleanup.

- **Then seed**: after `createBrowserPane` resolves, `if (!receivedLiveNavRef.current)
setNavState(result.navState)` — a late create-result never clobbers a fresher live event.

### 4.3 Action handlers

```ts
// Inlined per handler (no shared `navAction` closure) so exhaustive-deps is satisfied.
const handleBack = useCallback(
  () =>
    void navActionBrowserPane({
      sessionId: browserSessionId,
      paneId: pane.id,
      action: 'back',
    }),
  [browserSessionId, pane.id]
)
const handleForward = useCallback(
  () =>
    void navActionBrowserPane({
      sessionId: browserSessionId,
      paneId: pane.id,
      action: 'forward',
    }),
  [browserSessionId, pane.id]
)
const handleReloadOrStop = useCallback(
  () =>
    void navActionBrowserPane({
      sessionId: browserSessionId,
      paneId: pane.id,
      action: navState.isLoading ? 'stop' : 'reload',
    }),
  [browserSessionId, pane.id, navState.isLoading]
)
```

Passed to `BrowserToolbar` alongside `navState`.

### 4.4 `BrowserToolbar` — enablement + reload↔stop toggle

`BrowserToolbarProps` gains `{ canGoBack, canGoForward, isLoading, onBack, onForward,
onReloadOrStop }`. The static `NAV_BUTTONS` array (`BrowserToolbar.tsx:15-19`) becomes a
per-button config — **same slots, same `NAV_BTN` classes**:

| slot        | `disabled`      | `onClick`        | icon / `aria-label`                                                 |
| ----------- | --------------- | ---------------- | ------------------------------------------------------------------- |
| back        | `!canGoBack`    | `onBack`         | `arrow_back` / "back"                                               |
| forward     | `!canGoForward` | `onForward`      | `arrow_forward` / "forward"                                         |
| reload↔stop | never           | `onReloadOrStop` | `isLoading ? 'close' : 'refresh'` / `isLoading ? 'stop' : 'reload'` |

The existing `NAV_BTN` disabled styling (`disabled:text-outline-variant …`,
`BrowserToolbar.tsx:13`) now renders live as `canGo*` flips. The `refresh` ↔ `close` swap
reuses the same `material-symbols-outlined` span — both names are in L1's icon set
(L1 §3.3); the verified-render rule (§5.3) applies to the `close`-as-stop usage.

### 4.5 Untouched

The address-bar machinery, tab bar, open-external, focus model, and bounds sync are all
unchanged — L2 only adds the nav-state prop flow + handlers to the existing toolbar.

## 5. Testing & acceptance

Tests follow repo conventions (L1 §6): Vitest (`test()` not `it()`), explicit
`import { test, expect, vi } from 'vitest'` per file, co-located `*.test.tsx`, Testing
Library, and the `window.vimeflow.browserPane` bridge-mock from `BrowserPane.test.tsx`.

### 5.1 Component tests

- **`BrowserToolbar`**: back/forward render `disabled` exactly when `!canGoBack` /
  `!canGoForward`, and fire `onBack`/`onForward` only when enabled; the reload slot renders
  `refresh` + "reload" when `!isLoading` and `close` + "stop" when `isLoading`, firing
  `onReloadOrStop` in both states, and is never `disabled`. The 3-column grid + slot classes
  are unchanged from L1 (structure assertion).
- **`BrowserPane` (container)**: a `nav-state-changed` event for this pane updates the
  toolbar's enablement + reload/stop; an event for a **different** `sessionId`/`paneId` is
  ignored; `result.navState` seeds the toolbar on create **only when** no live event arrived
  first (the `receivedLiveNavRef` guard); `handleReloadOrStop` dispatches `stop` while
  `isLoading` and `reload` otherwise; back/forward dispatch `navAction('back' | 'forward')`.

### 5.2 Main-process tests (`browser-pane.test.ts`)

These exercise behavior through the **public IPC surface** — the registered handler and the
emitted events — not the private `runNavAction` / `emitPaneNavStateChanged` helpers (no
test-only exports).

- **Nav-action handler** (`BROWSER_PANE_NAV_ACTION`): invoked with `back`/`forward` it calls
  `navigationHistory.goBack()`/`goForward()` only when guarded (`canGoBack()`/`canGoForward()`
  true); `reload`/`stop` call `webContents.reload()`/`stop()`; an unknown action and an absent
  active tab both no-op.
- **Emitted nav-state** (`BROWSER_PANE_NAV_STATE_CHANGED`): a `did-stop-loading` on the active
  tab sends `{ canGoBack, canGoForward, isLoading }`; a **non-active** tab's event sends
  **nothing** (active-gating, §2.2); `setActiveTab` and the active-tab `destroyed` fallback
  (pane surviving) each send the now-active tab's state; nothing is sent when the window is
  destroyed.
- **Create-result snapshot**: `createPane` (fresh + reconnect) returns `navState` for the
  active tab; the bridge-absent fallback (`browserBridge.ts`) returns `navState` too.
- **Preload/bridge wiring** (`preload.test.ts` / `browserBridge.test.ts`): the `browserPane`
  bridge exposes `navAction` and `onNavStateChange` mapped to `BROWSER_PANE_NAV_ACTION` /
  `BROWSER_PANE_NAV_STATE_CHANGED` — the silent-failure trap §3.5 names, and the easiest
  wiring to break without a unit test noticing (mirrors L1's `open-external` wiring test).

### 5.3 Real-browser verification (NOT jsdom)

jsdom treats any string as valid icon text, so this is a **manual** acceptance step in a
real Electron build: the reload button shows the `refresh` glyph when idle and the `close`
glyph mid-load (not the raw ligature words), and back/forward show `arrow_back` /
`arrow_forward`. (Same trap L1 §6.3 calls out.)

### 5.4 Regression

L1's `BrowserToolbar` / `BrowserPane` suites stay green: the nav buttons keep their slots,
classes, and open-external behavior; only `disabled` / `onClick` / the reload icon become
state-driven. Address-bar, tab, and focus tests are untouched.

### 5.5 Acceptance criteria (L2 done = all of)

1. Back/forward navigate the active tab and are `disabled` exactly per `canGoBack`/`Forward`.
2. The reload button stops an in-flight load and reloads when idle, toggling icon + label.
3. A tab switch lands the new tab's history/loading state with no stale enablement.
4. nav-state is correct after **reconnect** (renderer reload onto an existing tab) via the
   create snapshot.
5. Zero chrome re-layout (L1 slots/classes unchanged).
6. `npm run lint`, `npm run type-check`, `npm run test` pass; the §5.3 manual check is done.

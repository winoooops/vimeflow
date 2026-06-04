# Browser Pane Navigation Controls (L2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the browser pane's back / forward / reload buttons to the active tab's `webContents` history, with the reload button toggling to stop while loading — lighting up L1's inert nav buttons with zero re-layout.

**Architecture:** Main process owns navigation: a single `nav-action` IPC command (`back|forward|reload|stop`) runs guarded history calls on the active tab, and an active-tab-gated `nav-state-changed` event pushes `{ canGoBack, canGoForward, isLoading }` to the renderer (the create result carries the initial snapshot). The renderer (`BrowserPane`) holds one `navState`, subscribes before creating the pane, and threads enablement + a reload↔stop toggle into `BrowserToolbar`.

**Tech Stack:** Electron 42 (`webContents.navigationHistory`, `WebContentsView`), React 19 + TypeScript, Vitest + Testing Library, the existing browser-pane IPC bridge.

**Spec:** `docs/superpowers/specs/2026-06-03-browser-pane-nav-controls-design.md` (committed, codex-reviewed). Section references below (§N) point into it.

---

## File Structure

**Modified — main process:**

- `electron/browser-pane-channels.ts` — two channel constants (command + event).
- `electron/browser-pane.ts` — `runNavAction`, `readNavState`, `emitPaneNavStateChanged`, `installNavStateEmitters`; emits from `setActiveTab` + both `destroyed` fallbacks; `navState` on the main-local `BrowserPaneCreateResult` (`:107`) + both builders; handler registration + `dispose()` cleanup.
- `electron/browser-pane.test.ts` — extend the fake `webContents` with `navigationHistory`/`isLoading`/`reload`/`stop`; new tests.
- `electron/preload.ts` — expose `navAction` + `onNavStateChange`.
- `electron/preload.test.ts` — extend the wiring `test.each` tables.

**Modified — renderer:**

- `src/features/browser/types.ts` — `BrowserPaneNavActionKind`, `BrowserPaneNavActionRequest`, `BrowserPaneNavState`, `BrowserPaneNavStateChangedEvent`; `navState` on `BrowserPaneCreateResult`; `navAction` + `onNavStateChange` on `BrowserPaneBridge`.
- `src/features/browser/browserBridge.ts` — `navActionBrowserPane`, `onBrowserPaneNavStateChange`; `navState` on the bridge-absent `createBrowserPane` fallback.
- `src/features/browser/browserBridge.test.ts` — wrapper assertions.
- `src/features/browser/components/BrowserToolbar.tsx` — nav props; dynamic buttons + reload↔stop toggle.
- `src/features/browser/components/BrowserToolbar.test.tsx` — enablement + toggle tests.
- `src/features/browser/components/BrowserPane.tsx` — `navState` state, subscribe-before-create + guarded seed, action handlers.
- `src/features/browser/components/BrowserPane.test.tsx` — nav-state subscription + handler tests.

**No new files** — L2 is wiring onto the existing structure.

---

### Task 1: IPC channels + renderer nav data types

Pure additive declarations — no consumers yet, so the build stays green. Verified by `type-check` (no runtime behavior to test in isolation).

**Files:**

- Modify: `electron/browser-pane-channels.ts`
- Modify: `src/features/browser/types.ts`

- [ ] **Step 1: Add the two channel constants**

Append to `electron/browser-pane-channels.ts`:

```ts
export const BROWSER_PANE_NAV_ACTION = 'browser-pane:nav-action'

export const BROWSER_PANE_NAV_STATE_CHANGED = 'browser-pane:nav-state-changed'
```

- [ ] **Step 2: Add the renderer nav types**

In `src/features/browser/types.ts`, add (after `BrowserPaneRef`):

```ts
export type BrowserPaneNavActionKind = 'back' | 'forward' | 'reload' | 'stop'

export interface BrowserPaneNavActionRequest extends BrowserPaneRef {
  action: BrowserPaneNavActionKind
}

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

Do **not** touch `BrowserPaneCreateResult` or `BrowserPaneBridge` here — those break builders / need wrappers and are handled in Tasks 5–6.

- [ ] **Step 3: Verify type-check passes**

Run: `npm run type-check`
Expected: PASS (additive declarations, no consumers).

- [ ] **Step 4: Commit**

```bash
git add electron/browser-pane-channels.ts src/features/browser/types.ts
git commit -m "feat(browser): nav-action + nav-state channels and types (L2)"
```

---

### Task 2: Main — `nav-action` command (runNavAction + handler + dispose)

History actions on the active tab's `webContents`, guarded (§2.1). First extend the test mock with the Electron 42 history/loading API the fake `webContents` lacks.

**Files:**

- Modify: `electron/browser-pane.test.ts` (mock + tests)
- Modify: `electron/browser-pane.ts`

- [ ] **Step 1: Extend the fake `webContents` mock**

In `electron/browser-pane.test.ts`, inside `createWebContents()` (the object literal at ~`:135`), add these fields alongside `getURL` / `reload`-less members:

```ts
navigationHistory: {
  canGoBack: vi.fn(() => false),
  canGoForward: vi.fn(() => false),
  goBack: vi.fn(),
  goForward: vi.fn(),
},
isLoading: vi.fn(() => false),
reload: vi.fn(),
stop: vi.fn(),
```

Add the matching members to the `LocalFakeWebContents` interface (~`:80-97`):

```ts
navigationHistory: {
  canGoBack: () => boolean
  canGoForward: () => boolean
  goBack: () => void
  goForward: () => void
}
isLoading: () => boolean
reload: () => void
stop: () => void
```

- [ ] **Step 2: Write the failing tests**

Add a `describe` block (mirroring the existing `BROWSER_PANE_OPEN_EXTERNAL` tests at `:431`). Import `BROWSER_PANE_NAV_ACTION` from `./browser-pane-channels` at the top.

```ts
test('nav-action reload reloads the active tab', async () => {
  await handler(BROWSER_PANE_CREATE)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    workspaceId: 'proj-1',
    initialUrl: 'https://example.com/',
  })
  await handler(BROWSER_PANE_NAV_ACTION)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    action: 'reload',
  })
  expect(electronMock.views[0]?.webContents.reload).toHaveBeenCalledOnce()
})

test('nav-action back goes back only when history allows', async () => {
  await handler(BROWSER_PANE_CREATE)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    workspaceId: 'proj-1',
    initialUrl: 'https://example.com/',
  })
  const wc = electronMock.views[0]!.webContents
  vi.mocked(wc.navigationHistory.canGoBack).mockReturnValue(false)
  await handler(BROWSER_PANE_NAV_ACTION)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    action: 'back',
  })
  expect(wc.navigationHistory.goBack).not.toHaveBeenCalled()

  vi.mocked(wc.navigationHistory.canGoBack).mockReturnValue(true)
  await handler(BROWSER_PANE_NAV_ACTION)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    action: 'back',
  })
  expect(wc.navigationHistory.goBack).toHaveBeenCalledOnce()
})

test('nav-action forward goes forward only when history allows', async () => {
  await handler(BROWSER_PANE_CREATE)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    workspaceId: 'proj-1',
    initialUrl: 'https://example.com/',
  })
  const wc = electronMock.views[0]!.webContents
  vi.mocked(wc.navigationHistory.canGoForward).mockReturnValue(false)
  await handler(BROWSER_PANE_NAV_ACTION)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    action: 'forward',
  })
  expect(wc.navigationHistory.goForward).not.toHaveBeenCalled()

  vi.mocked(wc.navigationHistory.canGoForward).mockReturnValue(true)
  await handler(BROWSER_PANE_NAV_ACTION)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    action: 'forward',
  })
  expect(wc.navigationHistory.goForward).toHaveBeenCalledOnce()
})

test('nav-action stop stops the active tab', async () => {
  await handler(BROWSER_PANE_CREATE)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    workspaceId: 'proj-1',
    initialUrl: 'https://example.com/',
  })
  await handler(BROWSER_PANE_NAV_ACTION)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    action: 'stop',
  })
  expect(electronMock.views[0]?.webContents.stop).toHaveBeenCalledOnce()
})

test('nav-action with an unknown action no-ops', async () => {
  await handler(BROWSER_PANE_CREATE)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    workspaceId: 'proj-1',
    initialUrl: 'https://example.com/',
  })
  await handler(BROWSER_PANE_NAV_ACTION)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    action: 'sideways',
  })
  const wc = electronMock.views[0]!.webContents
  expect(wc.reload).not.toHaveBeenCalled()
  expect(wc.stop).not.toHaveBeenCalled()
})

test('nav-action handler is removed on dispose', () => {
  expect(electronMock.handlers.has(BROWSER_PANE_NAV_ACTION)).toBe(true)
  controller.dispose()
  expect(electronMock.handlers.has(BROWSER_PANE_NAV_ACTION)).toBe(false)
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run electron/browser-pane.test.ts -t "nav-action"`
Expected: FAIL — `missing handler browser-pane:nav-action`.

- [ ] **Step 4: Implement `runNavAction` + the handler + dispose cleanup**

In `electron/browser-pane.ts`:

Import the channel (with the other `browser-pane-channels` imports):

```ts
import { BROWSER_PANE_NAV_ACTION } from './browser-pane-channels'
```

Add the private action runner (near `activeWebContents`, ~`:851`):

```ts
private runNavAction(record: BrowserPaneRecord, action: string): void {
  const wc = this.activeWebContents(record)
  if (!wc || wc.isDestroyed()) {
    return
  }
  switch (action) {
    case 'back':
      if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
      break
    case 'forward':
      if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
      break
    case 'reload':
      wc.reload()
      break
    case 'stop':
      wc.stop()
      break
    default:
      break
  }
}
```

Add a `handleNavAction(payload)` private method that parses the payload and locates the record **mirroring `activateTab` (`browser-pane.ts:1276`)** — same `sessionId`/`paneId` parse + record lookup, throwing `invalid browser pane nav-action payload` on a malformed payload — then calls `this.runNavAction(record, action)` (no-op when the record is absent).

Register the handler in the `ipcMain.handle` block (after `BROWSER_PANE_OPEN_EXTERNAL`, ~`:662`):

```ts
ipcMain.handle(BROWSER_PANE_NAV_ACTION, (_event, payload) =>
  this.handleNavAction(payload)
)
```

Add the teardown in `dispose()` (after the other `removeHandler` calls, ~`:676`):

```ts
ipcMain.removeHandler(BROWSER_PANE_NAV_ACTION)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run electron/browser-pane.test.ts -t "nav-action"`
Expected: PASS (all six).

- [ ] **Step 6: Commit**

```bash
git add electron/browser-pane.ts electron/browser-pane.test.ts
git commit -m "feat(browser): wire nav-action history commands to the active tab (L2)"
```

---

### Task 3: Main — nav-state emitter + installer + active-gating

`emitPaneNavStateChanged` is the sole authority on which tab the toolbar shows: it no-ops unless `record.activeTabId === tabId` (§2.2). Wired onto each tab via a shared installer (§2.4).

**Files:**

- Modify: `electron/browser-pane.ts`
- Modify: `electron/browser-pane.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { BROWSER_PANE_NAV_STATE_CHANGED } from './browser-pane-channels'

const listenerFor = (viewIndex: number, eventName: string): (() => void) => {
  const found = vi
    .mocked(electronMock.views[viewIndex]!.webContents.on)
    .mock.calls.find(([name]) => name === eventName)?.[1]
  if (!found) throw new Error(`missing ${eventName} listener`)
  return found as () => void
}

test('did-stop-loading on the active tab emits nav-state', async () => {
  await handler(BROWSER_PANE_CREATE)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    workspaceId: 'proj-1',
    initialUrl: 'https://example.com/',
  })
  const wc = electronMock.views[0]!.webContents
  vi.mocked(wc.navigationHistory.canGoBack).mockReturnValue(true)
  vi.mocked(wc.isLoading).mockReturnValue(false)
  vi.mocked(electronMock.win.webContents.send).mockClear()

  listenerFor(0, 'did-stop-loading')()

  expect(electronMock.win.webContents.send).toHaveBeenCalledWith(
    BROWSER_PANE_NAV_STATE_CHANGED,
    {
      sessionId: 'pty-1',
      paneId: 'p1',
      tabId: 'tab-0',
      canGoBack: true,
      canGoForward: false,
      isLoading: false,
    }
  )
})

test('did-start-loading on the active tab emits isLoading true', async () => {
  await handler(BROWSER_PANE_CREATE)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    workspaceId: 'proj-1',
    initialUrl: 'https://example.com/',
  })
  vi.mocked(electronMock.views[0]!.webContents.isLoading).mockReturnValue(true)
  vi.mocked(electronMock.win.webContents.send).mockClear()

  listenerFor(0, 'did-start-loading')()

  expect(electronMock.win.webContents.send).toHaveBeenCalledWith(
    BROWSER_PANE_NAV_STATE_CHANGED,
    expect.objectContaining({ tabId: 'tab-0', isLoading: true })
  )
})

test('nav-state emit no-ops for a non-active tab', async () => {
  await handler(BROWSER_PANE_CREATE)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    workspaceId: 'proj-1',
    initialUrl: 'https://example.com/',
  })
  // Opening a second tab activates it, so tab-0 (views[0]) is now inactive.
  await handler(BROWSER_PANE_NEW_TAB)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    url: 'https://second.example/',
  })
  vi.mocked(electronMock.win.webContents.send).mockClear()

  // Fire a load event on the now-inactive first tab's webContents.
  listenerFor(0, 'did-stop-loading')()

  expect(electronMock.win.webContents.send).not.toHaveBeenCalledWith(
    BROWSER_PANE_NAV_STATE_CHANGED,
    expect.anything()
  )
})
```

> Tab ids/indices: `new-tab` activates the new tab (`createOwnedTab` → `setActiveTab`), so after it `views[0]` (`tab-0`) is the **inactive** tab the gating test fires on. Confirm the assigned tab ids during implementation.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run electron/browser-pane.test.ts -t "nav-state"`
Expected: FAIL — no `did-stop-loading` listener / no `BROWSER_PANE_NAV_STATE_CHANGED` send.

- [ ] **Step 3: Implement the emitter + installer**

In `electron/browser-pane.ts`:

```ts
private readNavState(wc: WebContents): {
  canGoBack: boolean; canGoForward: boolean; isLoading: boolean
} {
  return {
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
    isLoading: wc.isLoading(),
  }
}

private emitPaneNavStateChanged(record: BrowserPaneRecord, tabId: string): void {
  if (record.activeTabId !== tabId) {
    return
  }
  const tab = record.tabs.get(tabId)
  const win = BrowserWindow.fromId(record.windowId)
  if (!tab || !win || win.isDestroyed() || win.webContents.isDestroyed()) {
    return
  }
  win.webContents.send(BROWSER_PANE_NAV_STATE_CHANGED, {
    sessionId: record.sessionId,
    paneId: record.paneId,
    tabId,
    ...this.readNavState(tab.view.webContents),
  })
}

private installNavStateEmitters(
  record: BrowserPaneRecord,
  view: WebContentsView,
  tabId: string
): void {
  const emit = (): void => this.emitPaneNavStateChanged(record, tabId)
  view.webContents.on('did-navigate', emit)
  view.webContents.on('did-navigate-in-page', emit)
  view.webContents.on('did-start-loading', emit)
  view.webContents.on('did-stop-loading', emit)
}
```

Call `this.installNavStateEmitters(record, view, 'tab-0')` in the create path right after its url-changed listeners (`:826-828`), and `this.installNavStateEmitters(record, view, tabId)` in `createOwnedTab` after its url-changed listeners (`:962-964`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run electron/browser-pane.test.ts -t "nav-state"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/browser-pane.ts electron/browser-pane.test.ts
git commit -m "feat(browser): emit active-tab nav-state on history/load events (L2)"
```

---

### Task 4: Main — emit on every active-tab transition

Cover `setActiveTab` + both `destroyed` fallbacks so a switch / crashed-active-tab lands the right state (§2.5).

**Files:**

- Modify: `electron/browser-pane.ts`
- Modify: `electron/browser-pane.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test('activating a tab emits its nav-state', async () => {
  await handler(BROWSER_PANE_CREATE)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    workspaceId: 'proj-1',
    initialUrl: 'https://example.com/',
  })
  await handler(BROWSER_PANE_NEW_TAB)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    url: 'https://second.example/',
  })
  vi.mocked(electronMock.win.webContents.send).mockClear()

  // Re-activate the first tab.
  await handler(BROWSER_PANE_ACTIVATE_TAB)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    tabId: 'tab-0',
  })

  expect(electronMock.win.webContents.send).toHaveBeenCalledWith(
    BROWSER_PANE_NAV_STATE_CHANGED,
    expect.objectContaining({ paneId: 'p1', tabId: 'tab-0' })
  )
})

test('destroying the active tab emits the fallback tab nav-state', async () => {
  await handler(BROWSER_PANE_CREATE)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    workspaceId: 'proj-1',
    initialUrl: 'https://example.com/',
  })
  // Second tab becomes active; tab-0 remains as the fallback.
  await handler(BROWSER_PANE_NEW_TAB)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    url: 'https://second.example/',
  })
  vi.mocked(electronMock.win.webContents.send).mockClear()

  // The active (second) tab's webContents is destroyed; activeTabId falls back
  // to tab-0, whose nav-state must be emitted.
  listenerFor(1, 'destroyed')()

  expect(electronMock.win.webContents.send).toHaveBeenCalledWith(
    BROWSER_PANE_NAV_STATE_CHANGED,
    expect.objectContaining({ paneId: 'p1', tabId: 'tab-0' })
  )
})
```

> Use the actual tab ids the implementation assigns (`tab-0`, `tab-1`, …); confirm during implementation.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run electron/browser-pane.test.ts -t "emits"`
Expected: FAIL — no nav-state send on activate.

- [ ] **Step 3: Implement the transition emits**

In `electron/browser-pane.ts`:

- In `setActiveTab` (`:1133`), after `record.activeTabId = tabId` (`:1145`), add: `this.emitPaneNavStateChanged(record, tabId)`.
- In the create-path `destroyed` handler, after `record.activeTabId = …` (`:803`) + `applyRecordBounds`: add `this.emitPaneNavStateChanged(record, record.activeTabId)`.
- In the `createOwnedTab` `destroyed` handler, after `record.activeTabId = …` (`:990`) + `applyRecordBounds`: add `this.emitPaneNavStateChanged(record, record.activeTabId)`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run electron/browser-pane.test.ts -t "emits"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/browser-pane.ts electron/browser-pane.test.ts
git commit -m "feat(browser): emit nav-state on tab activate + destroyed fallback (L2)"
```

---

### Task 5: Main — create-result `navState` snapshot

The create result carries the active tab's initial nav-state for synchronous renderer hydration / reconnect (§2.6). Update the **main-local** interface (`:107`) + both builders.

**Files:**

- Modify: `electron/browser-pane.ts`
- Modify: `electron/browser-pane.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('create returns the active tab nav-state snapshot', async () => {
  const wc0 = () => electronMock.views[0]!.webContents
  // Pre-arm the next created view's history before create resolves is not
  // possible (view is made inside create), so assert the default snapshot:
  const result = await handler(BROWSER_PANE_CREATE)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    workspaceId: 'proj-1',
    initialUrl: 'https://example.com/',
  })
  expect(result).toMatchObject({
    navState: { canGoBack: false, canGoForward: false, isLoading: false },
  })
  void wc0
})

test('reconnect returns the existing tab nav-state snapshot', async () => {
  await handler(BROWSER_PANE_CREATE)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    workspaceId: 'proj-1',
    initialUrl: 'https://example.com/',
  })
  // The existing native tab has accrued history before the renderer reattaches.
  vi.mocked(
    electronMock.views[0]!.webContents.navigationHistory.canGoBack
  ).mockReturnValue(true)

  const reconnect = await handler(BROWSER_PANE_CREATE)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    workspaceId: 'proj-1',
    initialUrl: 'https://example.com/',
  })

  expect(reconnect).toMatchObject({ navState: { canGoBack: true } })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run electron/browser-pane.test.ts -t "nav-state snapshot"`
Expected: FAIL — `navState` undefined on the result.

- [ ] **Step 3: Implement the snapshot**

In `electron/browser-pane.ts`:

- Extend the main-local `BrowserPaneCreateResult` interface (`:107`):

```ts
interface BrowserPaneCreateResult {
  url: string
  title: string | null
  partition: string
  tabs: BrowserPaneTabSnapshot[]
  navState: { canGoBack: boolean; canGoForward: boolean; isLoading: boolean }
}
```

- In the create return (`:835-840`), add `navState: this.readNavState(view.webContents)`.
- In the reconnect path (`:715-728`), add `navState: this.readNavState(this.activeTab(existing)!.view.webContents)` to the returned snapshot (resolve the active tab the same way that branch already does).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run electron/browser-pane.test.ts -t "nav-state snapshot"`
Expected: PASS. Then run the whole main suite: `npx vitest run electron/browser-pane.test.ts` — all green.

- [ ] **Step 5: Commit**

```bash
git add electron/browser-pane.ts electron/browser-pane.test.ts
git commit -m "feat(browser): include nav-state snapshot in the create result (L2)"
```

---

### Task 6: Renderer IPC wiring — types + preload + browserBridge

Expose the command + event across the contextBridge and add the `navState` snapshot field renderer-side (§3). This is the silent-failure trap — assert the mapping (§5.2).

**Files:**

- Modify: `src/features/browser/types.ts`
- Modify: `electron/preload.ts`
- Modify: `src/features/browser/browserBridge.ts`
- Modify: `electron/preload.test.ts`
- Modify: `src/features/browser/browserBridge.test.ts`

- [ ] **Step 1: Write the failing wiring tests**

In `electron/preload.test.ts`, add to the **invoke** `test.each` table (`:66`):

```ts
['navAction', BROWSER_PANE_NAV_ACTION, { sessionId: 's1', paneId: 'p1', action: 'back' }],
```

and to the **on** `test.each` table (`:120`):

```ts
['onNavStateChange', BROWSER_PANE_NAV_STATE_CHANGED],
```

Import both channels at the top of the file.

In `src/features/browser/browserBridge.test.ts`, add a test asserting `navActionBrowserPane` calls `bridge.navAction` and `onBrowserPaneNavStateChange` calls `bridge.onNavStateChange` (mirror the existing wrapper tests in that file), plus a no-bridge test that `navActionBrowserPane` resolves without throwing when `window.vimeflow` is absent.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run electron/preload.test.ts src/features/browser/browserBridge.test.ts`
Expected: FAIL — `navAction` / `onNavStateChange` not exposed.

- [ ] **Step 3: Implement the renderer wiring**

In `src/features/browser/types.ts`:

- Add `navState: BrowserPaneNavState` to `BrowserPaneCreateResult`.
- Add to `BrowserPaneBridge`:

```ts
navAction: (request: BrowserPaneNavActionRequest) => Promise<void>
onNavStateChange: (
  callback: (event: BrowserPaneNavStateChangedEvent) => void
) => () => void
```

In `electron/preload.ts`, inside the `browserPane` object: add `navAction` (mirrors `navigate`) and `onNavStateChange` (mirrors `onUrlChange`), importing both channels:

```ts
navAction: (request: unknown): Promise<unknown> =>
  ipcRenderer.invoke(BROWSER_PANE_NAV_ACTION, request),
onNavStateChange: (callback: (payload: unknown) => void): (() => void) => {
  const handler = (_event: IpcRendererEvent, payload: unknown): void => {
    callback(payload)
  }
  ipcRenderer.on(BROWSER_PANE_NAV_STATE_CHANGED, handler)
  return (): void => {
    ipcRenderer.off(BROWSER_PANE_NAV_STATE_CHANGED, handler)
  }
},
```

In `src/features/browser/browserBridge.ts`:

- Import `BrowserPaneNavActionRequest`, `BrowserPaneNavStateChangedEvent`.
- Add wrappers:

```ts
export const navActionBrowserPane = async (
  request: BrowserPaneNavActionRequest
): Promise<void> => {
  await bridge()?.navAction(request)
}

export const onBrowserPaneNavStateChange = (
  callback: (event: BrowserPaneNavStateChangedEvent) => void
): (() => void) =>
  bridge()?.onNavStateChange(callback) ?? ((): void => undefined)
```

- Add `navState` to the **bridge-absent** `createBrowserPane` fallback (`:36-50`):

```ts
navState: { canGoBack: false, canGoForward: false, isLoading: false },
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run electron/preload.test.ts src/features/browser/browserBridge.test.ts`
Expected: PASS. Then `npm run type-check` — PASS (all `BrowserPaneCreateResult` constructors now carry `navState`).

- [ ] **Step 5: Commit**

```bash
git add src/features/browser/types.ts electron/preload.ts src/features/browser/browserBridge.ts electron/preload.test.ts src/features/browser/browserBridge.test.ts
git commit -m "feat(browser): expose nav-action + nav-state over the bridge (L2)"
```

---

### Task 7: Renderer — `BrowserToolbar` enablement + reload↔stop toggle

Light up the inert buttons; reload toggles to stop while loading (§4.4). Same slots, same `NAV_BTN` class.

**Files:**

- Modify: `src/features/browser/components/BrowserToolbar.tsx`
- Modify: `src/features/browser/components/BrowserToolbar.test.tsx`

- [ ] **Step 1: Write the failing tests**

Extend `baseProps` with the new props and add tests:

```ts
const navProps = {
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  onBack: () => undefined,
  onForward: () => undefined,
  onReloadOrStop: () => undefined,
}
// merge navProps into baseProps

test('back / forward enable from canGo* and fire their handlers', () => {
  const onBack = vi.fn()
  render(<BrowserToolbar {...baseProps} {...navProps} canGoBack onBack={onBack} />)
  const back = screen.getByRole('button', { name: 'back' })
  expect(back).not.toBeDisabled()
  expect(screen.getByRole('button', { name: 'forward' })).toBeDisabled()
  fireEvent.click(back)
  expect(onBack).toHaveBeenCalledOnce()
})

test('reload button toggles to stop while loading', () => {
  const onReloadOrStop = vi.fn()
  const { rerender } = render(
    <BrowserToolbar {...baseProps} {...navProps} onReloadOrStop={onReloadOrStop} />
  )
  expect(screen.getByRole('button', { name: 'reload' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'reload' }))
  expect(onReloadOrStop).toHaveBeenCalledOnce()

  rerender(
    <BrowserToolbar {...baseProps} {...navProps} isLoading onReloadOrStop={onReloadOrStop} />
  )
  expect(screen.getByRole('button', { name: 'stop' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'reload' })).toBeNull()
})
```

Update the existing `back / forward / reload render disabled` test: with `canGoBack`/`canGoForward` false (the `navProps` default), back/forward are still disabled, but reload is now **enabled** — adjust that test to assert back/forward disabled and reload present/enabled.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/features/browser/components/BrowserToolbar.test.tsx`
Expected: FAIL — props don't exist; buttons hard-disabled.

- [ ] **Step 3: Implement the dynamic buttons**

In `src/features/browser/components/BrowserToolbar.tsx`:

```ts
export interface BrowserToolbarProps extends BrowserAddressBarProps {
  onOpenExternal: () => void
  canOpenExternal: boolean
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  onBack: () => void
  onForward: () => void
  onReloadOrStop: () => void
}
```

Replace the static `NAV_BUTTONS.map(...)` block with a per-button config built from props (keep the `NAV_BTN` class and the `material-symbols-outlined` span):

```tsx
const navButtons = [
  { label: 'back', icon: 'arrow_back', disabled: !canGoBack, onClick: onBack },
  {
    label: 'forward',
    icon: 'arrow_forward',
    disabled: !canGoForward,
    onClick: onForward,
  },
  {
    label: isLoading ? 'stop' : 'reload',
    icon: isLoading ? 'close' : 'refresh',
    disabled: false,
    onClick: onReloadOrStop,
  },
]
// render: navButtons.map(b => (
//   <button key="back|forward|reload-slot" type="button" disabled={b.disabled}
//     aria-label={b.label} onClick={b.onClick} className={NAV_BTN}>
//     <span aria-hidden="true" className="material-symbols-outlined text-[17px]">{b.icon}</span>
//   </button>
// ))
```

Use a stable `key` per slot (e.g. index or `'back'|'forward'|'reload-slot'`) so the reload↔stop slot keeps its identity across the toggle.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/features/browser/components/BrowserToolbar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/browser/components/BrowserToolbar.tsx src/features/browser/components/BrowserToolbar.test.tsx
git commit -m "feat(browser): light up nav buttons + reload↔stop toggle (L2)"
```

---

### Task 8: Renderer — `BrowserPane` nav-state wiring

Own `navState`, subscribe before create with a guarded seed (§4.1–4.3), thread into the toolbar.

**Files:**

- Modify: `src/features/browser/components/BrowserPane.tsx`
- Modify: `src/features/browser/components/BrowserPane.test.tsx`

- [ ] **Step 1: Write the failing tests**

Extend the existing `window.vimeflow.browserPane` mock in `BrowserPane.test.tsx` to (a) return `navState` from `createPane`, and (b) capture the `onNavStateChange` callback so the test can drive it. Then:

```ts
test('a nav-state event lights up back/forward + reload→stop', async () => {
  // render BrowserPane (mirror the existing render helper)
  // wait for createPane to resolve
  // invoke the captured onNavStateChange callback with:
  //   { sessionId, paneId, tabId: 'tab-0', canGoBack: true, canGoForward: false, isLoading: true }
  expect(await screen.findByRole('button', { name: 'back' })).not.toBeDisabled()
  expect(screen.getByRole('button', { name: 'stop' })).toBeInTheDocument()
})

test('a nav-state event for a different pane is ignored', async () => {
  // invoke onNavStateChange with a foreign sessionId/paneId
  // assert back stays disabled
})

test('back/forward/reload dispatch nav-action through the bridge', async () => {
  // click back → expect navAction mock called with { sessionId, paneId, action: 'back' }
  // click reload → action: 'reload'
})

test('the create-result navState seeds the toolbar (reconnect)', async () => {
  // make the createPane mock resolve { ...snapshot, navState: { canGoBack: true,
  //   canGoForward: false, isLoading: false } } and fire NO nav-state event
  // assert back is enabled purely from the seed (no event needed):
  expect(await screen.findByRole('button', { name: 'back' })).not.toBeDisabled()
})

test('a live nav-state event before create resolves is not clobbered by the seed', async () => {
  // arrange: createPane resolves slowly (deferred); invoke the captured
  //   onNavStateChange with { ...this pane, isLoading: true } BEFORE it resolves,
  //   then resolve createPane with navState: { isLoading: false }
  // the guarded seed (receivedLiveNavRef) must NOT overwrite the live event:
  expect(screen.getByRole('button', { name: 'stop' })).toBeInTheDocument()
})
```

Mirror the existing test's render + event-driving helpers (the suite already drives `onUrlChange` / `onTabsChange` the same way).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/features/browser/components/BrowserPane.test.tsx`
Expected: FAIL — toolbar gets no nav props; bridge `navAction` not called.

- [ ] **Step 3: Implement the container wiring**

In `src/features/browser/components/BrowserPane.tsx`:

- Import `navActionBrowserPane`, `onBrowserPaneNavStateChange`, and `BrowserPaneNavState` / `BrowserPaneNavActionKind` types.
- Add state + guard ref:

```ts
const [navState, setNavState] = useState<BrowserPaneNavState>({
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
})
const receivedLiveNavRef = useRef(false)
```

- In the **create effect** (`:206`), at the very top: `receivedLiveNavRef.current = false`, then register the listener **before** `await createBrowserPane(...)`:

```ts
const offNav = onBrowserPaneNavStateChange((e) => {
  if (e.sessionId !== browserSessionId || e.paneId !== pane.id) return
  setNavState({
    canGoBack: e.canGoBack,
    canGoForward: e.canGoForward,
    isLoading: e.isLoading,
  })
  receivedLiveNavRef.current = true
})
```

Return `offNav()` from the effect cleanup. After `createBrowserPane` resolves, seed: `if (!receivedLiveNavRef.current) setNavState(result.navState)`.

- Add the handlers (inlined per §4.3 to satisfy exhaustive-deps):

```ts
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

- Pass to `<BrowserToolbar>`: `canGoBack={navState.canGoBack} canGoForward={navState.canGoForward} isLoading={navState.isLoading} onBack={handleBack} onForward={handleForward} onReloadOrStop={handleReloadOrStop}`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/features/browser/components/BrowserPane.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/browser/components/BrowserPane.tsx src/features/browser/components/BrowserPane.test.tsx
git commit -m "feat(browser): wire BrowserPane nav-state + action handlers (L2)"
```

---

### Task 9: Full verification + manual icon check

**Files:** none (verification only).

- [ ] **Step 1: Lint + type-check + full test suite**

Run: `npm run lint && npm run type-check && npm run test`
Expected: all PASS. Fix any `exhaustive-deps` / formatting issues surfaced (the `navAction` handlers are inlined to avoid them).

- [ ] **Step 2: Manual real-browser check (§5.3)**

Run: `npm run electron:dev` (the Electron path; `npm run dev` is Vite-only and has no browser pane), open a browser pane, and confirm in the real Electron build:

- back / forward are greyed until history exists, then navigate the page;
- the reload button shows the `refresh` glyph idle and swaps to the `close` glyph while a page loads (NOT the raw ligature words);
- a tab switch immediately reflects the new tab's enablement.

- [ ] **Step 3: Final commit (only if Step 1 required fixups)**

```bash
git add -A
git commit -m "chore(browser): lint/type-check fixups for nav controls (L2)"
```

---

## Self-Review

**Spec coverage:** §2.1 → Task 2; §2.2–2.4 → Task 3; §2.5 → Tasks 3–4; §2.6 → Tasks 5, 8; §3.1–3.3 → Tasks 1, 6; §3.4 → Tasks 5–6; §3.5 (dispose + main-local interface + bridge fallback) → Tasks 2, 5, 6; §4.1–4.4 → Tasks 7–8; §5.1 → Tasks 7–8; §5.2 → Tasks 2–6; §5.3 → Task 9; §5.4 regression → Task 9 full suite.

**Type consistency:** `BrowserPaneNavState` (renderer) / inline `{ canGoBack; canGoForward; isLoading }` (main-local, boundary-separated) used consistently; `runNavAction` / `emitPaneNavStateChanged` / `installNavStateEmitters` / `readNavState` names stable across tasks; `navAction` / `onNavStateChange` bridge methods match across preload, browserBridge, and types.

**Known soft spots (resolve during implementation):** exact tab ids + active-tab index in Tasks 3–4 tests; the record-lookup helper reused from `activateTab` in Task 2; the `BrowserPane.test.tsx` mock-driving helper shape in Task 8 (mirror the existing `onUrlChange`/`onTabsChange` drivers).

<!-- codex-reviewed: 2026-06-04T08:18:37Z -->

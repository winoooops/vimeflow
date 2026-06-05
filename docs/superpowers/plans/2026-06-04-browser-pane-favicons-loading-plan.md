# Browser pane — favicons + loading (L3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the built-in browser pane real per-tab favicons and an active-tab load bar, per `docs/superpowers/specs/2026-06-04-browser-pane-favicons-loading-design.md` (Approach A).

**Architecture:** Main resolves `page-favicon-updated` candidates into a size-capped `data:` URL (the renderer CSP forbids remote favicon hosts) under an SSRF Private-Network-Access policy, stores it per-tab, and ships it over the existing `tabs-changed` stream. The renderer renders `<img>` with the L1 `faviconPlaceholder` fallback. The active-tab load bar reuses L2's `navState.isLoading`, rendered as an absolutely-positioned chrome-layer strip (zero re-layout).

**Tech Stack:** Electron 42 main (`WebContentsView`, `session.fetch`, `AbortSignal.any`/`.timeout`, `node:crypto`), React/TypeScript renderer, Tailwind, Vitest + Testing Library.

**Conventions:** No semicolons, single quotes, trailing-comma es5, explicit return types on exported fns, arrow components, `test()` not `it()`, explicit `import { test, expect, vi } from 'vitest'` per new test file, co-located tests. Commit per task with `feat(browser): …` (lowercase subject). Run from the worktree `worktrees/browser-pane-favicons-loading`.

**Test harness note (main):** `electron/browser-pane.test.ts` mocks `WebContentsView` / `webContents` (listeners stored as `vi.fn()` calls — **not** a real `EventEmitter`) and `BrowserWindow`. Drive listeners via `listenerFor` / `callAllListeners` and capture emits via the `win.webContents.send` mock — see **Execution notes** below for the exact primitives + helpers. Read the top of `browser-pane.test.ts` first.

---

## Constants (add near the other browser-pane constants in `electron/browser-pane.ts`)

```ts
const FAVICON_BYTE_CAP = 32 * 1024 // decoded image bytes (§2.6 ≈32 KB)
const MAX_FAVICON_URL = 64 * 1024 // string-length cap for a passthrough data: favicon
const MAX_FAVICON_CANDIDATES = 4 // bound the candidate loop per event
const FAVICON_FETCH_TIMEOUT_MS = 5000 // per-candidate fetch timeout
```

---

## Execution notes (read before any task)

**Commit trailer.** Every commit below must end with the executor's required `Co-Authored-By` trailer — `Co-Authored-By: codex <codex@openai.com>` when codex-executed (per `AGENTS.md`), or the executing agent's equivalent. The `-m` lines shown omit it for brevity; add it.

**SSRF scope (Tasks 2/4).** The PNA guard is **hostname-classification only** (`isPrivateHost` on `new URL(url).hostname`) — the L3 baseline. Full DNS-resolution + IP-pinning to defeat DNS rebinding is the spec's documented "impl hardening detail" and is **out of scope for L3**: add a one-line `// TODO(L3-followup): DNS/IP pinning vs rebinding — see VIM-56 line` comment at the guard and file a follow-up issue. Tasks 2/4 therefore test literal private hosts only; do not claim rebinding-proof.

**Main-process test harness (Tasks 1–6).** `electron/browser-pane.test.ts` does **not** use a real `EventEmitter` — mirror the existing `BROWSER_PANE_NAV_STATE_CHANGED` tests (around `:612`):

- Create a pane: `const result = await handler(BROWSER_PANE_CREATE)(eventForSender(), { sessionId: 'pty-1', paneId: 'p1', workspaceId: 'w', initialUrl })` (await the returned create result).
- Drive a tab webContents listener: `listenerFor(viewIndex, eventName)(...)` — e.g. `listenerFor(0, 'page-favicon-updated')({}, candidates)` or `listenerFor(0, 'did-navigate')()`. `viewIndex` is creation order (first tab = view 0).
- Set a tab's committed URL: `vi.mocked(electronMock.views[0].webContents.getURL).mockReturnValue('https://example.com/')`.
- Capture an emitted IPC: `vi.mocked(electronMock.win.webContents.send).mock.calls.filter(([ch]) => ch === BROWSER_PANE_TABS_CHANGED)` (clear first via `…send).mockClear()`).

**One harness extension (do in Task 2 Step 0).** Add `fetch: vi.fn()` to the `fakeSession` object literal (`electron/browser-pane.test.ts:184`) so `view.webContents.session.fetch` is mockable (`fakeSession` is exposed as `electronMock.fakeSession`).

**Shared favicon test helpers (add once, Task 2 Step 0):**

```ts
const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}
const streamOf = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(c): void {
      if (bytes.byteLength > 0) c.enqueue(bytes)
      c.close()
    },
  })
const imageResponse = (
  type: string,
  bytes: Uint8Array,
  extra: Record<string, string> = {}
): Response =>
  ({
    ok: true,
    headers: new Headers({ 'content-type': type, ...extra }),
    body: streamOf(bytes),
  }) as unknown as Response
const makeDeferred = <T>(): { promise: Promise<T>; resolve: (v: T) => void } => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })

  return { promise, resolve }
}

// Invoke every webContents listener registered for an event (the fake stores them as vi.fn calls;
// did-navigate has two after L3 — the favicon reset, registered first, then emitUrlChanged).
const callAllListeners = (
  viewIndex: number,
  eventName: string,
  ...args: unknown[]
): void => {
  vi.mocked(electronMock.views[viewIndex].webContents.on).mock.calls
    .filter(([ev]) => ev === eventName)
    .forEach(([, fn]) => (fn as (...a: unknown[]) => void)(...args))
}

// Create a pane, bind helpers to its first tab (view 0). pageUrl drives the PNA origin check.
const faviconHarness = async (
  pageUrl: string
): Promise<{
  emitFavicon: (urls: string[]) => void
  emitNavigate: () => void
  emitNavigateInPage: () => void
  tabsChanged: () => Array<{ tabs: Array<{ id: string; favicon: string | null }> }>
  clearSends: () => void
}> => {
  await handler(BROWSER_PANE_CREATE)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    workspaceId: 'w',
    initialUrl: pageUrl,
  })
  vi.mocked(electronMock.views[0].webContents.getURL).mockReturnValue(pageUrl)

  return {
    emitFavicon: (urls) => callAllListeners(0, 'page-favicon-updated', {}, urls),
    emitNavigate: () => callAllListeners(0, 'did-navigate'),
    emitNavigateInPage: () => callAllListeners(0, 'did-navigate-in-page'),
    tabsChanged: () =>
      vi
        .mocked(electronMock.win.webContents.send)
        .mock.calls.filter(([ch]) => ch === BROWSER_PANE_TABS_CHANGED)
        .map(([, payload]) => payload as { tabs: Array<{ id: string; favicon: string | null }> }),
    clearSends: () => vi.mocked(electronMock.win.webContents.send).mockClear(),
  }
}
const lastFaviconOf = (h: { tabsChanged: () => Array<{ tabs: Array<{ id: string; favicon: string | null }> }> }): string | null => {
  const calls = h.tabsChanged()

  return calls[calls.length - 1].tabs[0].favicon
}
```

Tasks 2–6 use `faviconHarness` + `electronMock.fakeSession.fetch = vi.fn().mockResolvedValue(...)`. Each test's concrete assertions are spelled out per task.

---

## Task 1: Add the `favicon` field across the tab model (null everywhere)

Implements the §2.5 cross-boundary checklist. Required-nullable field → `tsc` forces every `BrowserPaneTab` literal to set it. No behavior yet; everything compiles and stays green.

**Files:**
- Modify: `src/features/browser/types.ts:24-29` (`BrowserPaneTab`)
- Modify: `electron/browser-pane.ts:143-147` (`BrowserPaneTabRecord`), `:149-154` (`BrowserPaneTabSnapshot`), `:883-890` (`tabSnapshots`), both `BrowserPaneTabRecord` construction sites (create `tab-0`, new-tab — `tsc` will flag them)
- Modify: `src/features/browser/browserBridge.ts:43-50` (bridge-absent fallback tab)
- Modify: `src/features/browser/components/BrowserPane.tsx:122-124` (initial tabs state)
- Test: `electron/browser-pane.test.ts`, `src/features/browser/browserBridge.test.ts`

- [ ] **Step 1: Write the failing main test** — `createPane`'s first tab snapshot carries `favicon: null`.

In `electron/browser-pane.test.ts` (reuse the existing create-pane harness):

```ts
test('createPane returns tabs with favicon null initially', async () => {
  const result = (await handler(BROWSER_PANE_CREATE)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    workspaceId: 'w',
    initialUrl: 'https://example.com/',
  })) as { tabs: Array<{ favicon: string | null }> }
  expect(result.tabs[0].favicon).toBe(null)
})
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run electron/browser-pane.test.ts -t 'favicon null initially'` → FAIL (`favicon` missing / type error).

- [ ] **Step 3: Add the field + null initializers.**

`src/features/browser/types.ts` — add to `BrowserPaneTab`:

```ts
export interface BrowserPaneTab {
  id: string
  url: string
  title: string | null
  active: boolean
  favicon: string | null
}
```

`electron/browser-pane.ts` — `BrowserPaneTabRecord`, `BrowserPaneTabSnapshot`, and `tabSnapshots`:

```ts
interface BrowserPaneTabRecord {
  id: string
  view: WebContentsView
  requestedUrl: string
  favicon: string | null
}

interface BrowserPaneTabSnapshot {
  id: string
  url: string
  title: string | null
  active: boolean
  favicon: string | null
}

private tabSnapshots(record: BrowserPaneRecord): BrowserPaneTabSnapshot[] {
  return [...record.tabs.values()].map((tab) => ({
    id: tab.id,
    url: this.tabUrl(tab),
    title: tab.view.webContents.getTitle() || null,
    active: tab.id === record.activeTabId,
    favicon: tab.favicon,
  }))
}
```

Then add `favicon: null` to each `BrowserPaneTabRecord` literal (`tsc` flags the two construction sites — the create `tab-0` record and the new-tab record).

`src/features/browser/browserBridge.ts` — the bridge-absent fallback tab:

```ts
tabs: [{ id: 'tab-0', url: request.initialUrl, title: null, active: true, favicon: null }],
```

`src/features/browser/components/BrowserPane.tsx:122-124` — initial tabs state:

```ts
const [tabs, setTabs] = useState<BrowserPaneTab[]>([
  { id: 'tab-0', url, title: null, active: true, favicon: null },
])
```

Then **update every existing `BrowserPaneTab` fixture in the test suites** so the required-nullable field compiles: add `favicon: null` to each tab literal in `src/features/browser/components/BrowserPane.test.tsx` and `BrowserTabBar.test.tsx` (and anything else `tsc` flags). Type-check must be green at the **end of this task** — these fixture updates are part of Task 1, not deferred to Tasks 7/8.

- [ ] **Step 4: Add the bridge-fallback test.**

In `src/features/browser/browserBridge.test.ts`:

```ts
test('createBrowserPane fallback (no bridge) returns favicon null', async () => {
  const result = await createBrowserPane({
    sessionId: 's',
    paneId: 'p',
    workspaceId: 'w',
    initialUrl: 'https://example.com/',
  })
  expect(result.tabs[0].favicon).toBe(null)
})
```

- [ ] **Step 5: Run + verify green.** `npx vitest run electron/browser-pane.test.ts src/features/browser/browserBridge.test.ts` → PASS. `npm run type-check` → clean.

- [ ] **Step 6: Commit.**

```bash
git add electron/browser-pane.ts src/features/browser/types.ts src/features/browser/browserBridge.ts \
  src/features/browser/components/BrowserPane.tsx src/features/browser/components/BrowserPane.test.tsx \
  src/features/browser/components/BrowserTabBar.test.tsx \
  electron/browser-pane.test.ts src/features/browser/browserBridge.test.ts
git commit -m "feat(browser): add per-tab favicon field (null) across the tab model"
```

---

## Task 2: Favicon resolver + installer — happy path (`page-favicon-updated` → `tabs-changed`)

Adds `resolveFaviconDataUrl`, `installFaviconEmitter`, and the PNA host guard, wired into both setup paths **before** `emitUrlChanged`. Tested through the public event/IPC surface (no private exports), per §5.2.

**Files:**
- Modify: `electron/browser-pane.ts` — new helpers + wiring at the create `tab-0` setup (before `:843`'s `emitUrlChanged`) and the new-tab setup (before `:1027`'s `emitUrlChanged`)
- Test: `electron/browser-pane.test.ts`

- [ ] **Step 0: Extend the harness.** Add `fetch: vi.fn()` to the `fakeSession` literal (`electron/browser-pane.test.ts:184`), and paste the shared favicon helpers from **Execution notes** (`flushMicrotasks`, `streamOf`, `imageResponse`, `makeDeferred`, `callAllListeners`, `faviconHarness`, `lastFaviconOf`) into the favicon `describe` block.

- [ ] **Step 1: Write the failing tests** (data: passthrough + http fetch → data: URL).

```ts
test('a data: image favicon candidate is stored verbatim', async () => {
  const h = await faviconHarness('https://example.com/')
  h.clearSends()
  h.emitFavicon(['data:image/png;base64,iVBORw0KGgo='])
  await flushMicrotasks()
  expect(lastFaviconOf(h)).toBe('data:image/png;base64,iVBORw0KGgo=')
})

test('an http image favicon is fetched (omit creds, no redirects) + inlined as a data URL', async () => {
  const h = await faviconHarness('https://example.com/')
  electronMock.fakeSession.fetch = vi
    .fn()
    .mockResolvedValue(imageResponse('image/png', new Uint8Array([1, 2, 3, 4])))
  h.clearSends()
  h.emitFavicon(['https://example.com/favicon.png'])
  await flushMicrotasks()
  expect(lastFaviconOf(h)).toMatch(/^data:image\/png;base64,/)
  expect(electronMock.fakeSession.fetch).toHaveBeenCalledWith(
    'https://example.com/favicon.png',
    expect.objectContaining({ redirect: 'error', credentials: 'omit' })
  )
})

test('the new-tab path also resolves favicons (view 1, not only the create path)', async () => {
  await handler(BROWSER_PANE_CREATE)(eventForSender(), { sessionId: 'pty-1', paneId: 'p1', workspaceId: 'w', initialUrl: 'https://a.com/' })
  await handler(BROWSER_PANE_NEW_TAB)(eventForSender(), { sessionId: 'pty-1', paneId: 'p1', url: 'https://b.com/' })
  vi.mocked(electronMock.views[1].webContents.getURL).mockReturnValue('https://b.com/')
  electronMock.fakeSession.fetch = vi.fn().mockResolvedValue(imageResponse('image/png', new Uint8Array([1])))
  vi.mocked(electronMock.win.webContents.send).mockClear()
  callAllListeners(1, 'page-favicon-updated', {}, ['https://b.com/favicon.png']) // view 1 = new tab
  await flushMicrotasks()
  const calls = vi
    .mocked(electronMock.win.webContents.send)
    .mock.calls.filter(([ch]) => ch === BROWSER_PANE_TABS_CHANGED) as Array<[string, { tabs: Array<{ id: string; favicon: string | null }> }]>
  const newTab = calls[calls.length - 1][1].tabs.find((t) => t.id !== 'tab-0')
  expect(newTab?.favicon).toMatch(/^data:image\/png;base64,/)
})
```

(Import `BROWSER_PANE_NEW_TAB` from `./browser-pane-channels` alongside `BROWSER_PANE_CREATE` if the test file doesn't already.)

- [ ] **Step 2: Run to verify failure.** `npx vitest run electron/browser-pane.test.ts -t favicon` → FAIL (no favicon ever emitted).

- [ ] **Step 3: Add the resolver, host guard, key, and streaming read** (top-level fns in `electron/browser-pane.ts`).

```ts
// NOTE: `createHash` (node:crypto) and the `ElectronSession` type alias are ALREADY imported in
// browser-pane.ts (lines 9, 12) — do not re-import. `createHash('sha1')` is an established pattern here.

const faviconKey = (candidates: string[]): string =>
  createHash('sha1').update(candidates.join('\n')).digest('hex')

const isImageDataUrl = (url: string): boolean =>
  /^data:image\/[a-z0-9.+-]+;base64,/i.test(url)

const isPrivateHost = (hostname: string): boolean => {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) {
    return true
  }
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 0 || a === 127 || a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true

  return false
}

// PNA: a private favicon target is allowed only when the page itself is private/local.
// TODO(L3-followup): hostname classification only — DNS resolution + IP pinning to defeat
// rebinding is deferred (spec §2.2 "impl hardening detail"); track as a VIM-56 follow-up.
const isFaviconHostAllowed = (pageUrl: string, faviconHost: string): boolean => {
  if (!isPrivateHost(faviconHost)) return true
  try {
    return isPrivateHost(new URL(pageUrl).hostname)
  } catch {
    return false
  }
}

const readCappedBody = async (
  res: Response,
  cap: number
): Promise<Buffer | null> => {
  const reader = res.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > cap) {
      await reader.cancel()

      return null
    }
    chunks.push(value)
  }

  return total === 0 ? null : Buffer.concat(chunks)
}

const resolveFaviconDataUrl = async (
  session: ElectronSession,
  pageUrl: string,
  url: string,
  resolutionSignal: AbortSignal
): Promise<string | null> => {
  if (url.startsWith('data:')) {
    if (!isImageDataUrl(url) || url.length > MAX_FAVICON_URL) return null
    const payload = url.slice(url.indexOf(',') + 1)
    if (payload.length === 0) return null
    const bytes = Buffer.from(payload, 'base64')
    if (bytes.length === 0 || bytes.length > FAVICON_BYTE_CAP) return null

    return url
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (!isFaviconHostAllowed(pageUrl, parsed.hostname)) return null

  const signal = AbortSignal.any([
    resolutionSignal,
    AbortSignal.timeout(FAVICON_FETCH_TIMEOUT_MS),
  ])
  try {
    const res = await session.fetch(url, {
      signal,
      redirect: 'error',
      credentials: 'omit',
    })
    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? ''
    if (!/^image\//i.test(type)) return null
    const declared = res.headers.get('content-length')
    if (declared && Number(declared) > FAVICON_BYTE_CAP) return null
    const buf = await readCappedBody(res, FAVICON_BYTE_CAP)
    if (!buf) return null
    const subtype = type.split('/')[1]?.split(';')[0]?.trim() || 'png'

    return `data:image/${subtype};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Add `installFaviconEmitter` (method on the manager class).**

```ts
private installFaviconEmitter(
  record: BrowserPaneRecord,
  view: WebContentsView,
  tabId: string
): void {
  let gen = 0
  let controller: AbortController | null = null
  let pendingKey: string | null = null
  let resolvedKey: string | null = null

  view.webContents.on('page-favicon-updated', (_event, favicons: string[]) => {
    const candidates = favicons
      .filter((u) => u.length <= MAX_FAVICON_URL)
      .slice(0, MAX_FAVICON_CANDIDATES)
    const key = faviconKey(candidates)
    if (key === resolvedKey || key === pendingKey) return

    controller?.abort()
    const myController = new AbortController()
    controller = myController
    pendingKey = key
    const myGen = ++gen

    void (async (): Promise<void> => {
      const pageUrl = view.webContents.getURL()
      let dataUrl: string | null = null
      for (const url of candidates) {
        if (myController.signal.aborted) break
        dataUrl = await resolveFaviconDataUrl(
          view.webContents.session,
          pageUrl,
          url,
          myController.signal
        )
        if (dataUrl !== null) break
      }

      const tab = record.tabs.get(tabId)
      if (!tab || myGen !== gen) return
      tab.favicon = dataUrl
      resolvedKey = dataUrl ? key : null
      pendingKey = null
      if (controller === myController) controller = null
      this.emitTabsChanged(record)
    })()
  })

  view.webContents.on('did-navigate', () => {
    controller?.abort()
    controller = null
    gen++
    pendingKey = null
    resolvedKey = null
    const tab = record.tabs.get(tabId)
    // No emit: the existing did-navigate emitUrlChanged carries the cleared favicon.
    if (tab) tab.favicon = null
  })
}
```

- [ ] **Step 5: Wire it into both setup paths — BEFORE `emitUrlChanged`.**

Create path (`browser-pane.ts` ~`:843`): insert `this.installFaviconEmitter(record, view, 'tab-0')` immediately **before** the `const emitUrlChanged = …` block, so its `did-navigate` reset is registered ahead of `emitUrlChanged`'s `did-navigate` listener.

New-tab path (~`:1027`): insert `this.installFaviconEmitter(record, view, tabId)` immediately **before** that path's `const emitUrlChanged = …` block.

- [ ] **Step 6: Run + verify green.** `npx vitest run electron/browser-pane.test.ts -t favicon` → PASS. `npm run type-check` → clean.

- [ ] **Step 7: Commit.**

```bash
git add electron/browser-pane.ts electron/browser-pane.test.ts
git commit -m "feat(browser): resolve real per-tab favicons to capped data URLs"
```

---

## Task 3: Resolver transport edge cases + candidate fallback

**Files:** Modify `electron/browser-pane.test.ts` only (behavior already implemented in Task 2 — this locks it down).

- [ ] **Step 1: Write the failing/locking tests.**

```ts
test.each([
  ['non-image content-type', imageResponse('text/html', new Uint8Array([1]))],
  ['non-ok response', { ok: false, headers: new Headers(), body: streamOf(new Uint8Array()) } as unknown as Response],
  ['zero-byte image body', imageResponse('image/png', new Uint8Array())],
  ['over-cap via content-length', imageResponse('image/png', new Uint8Array([1]), { 'content-length': String(40 * 1024) })],
])('http favicon %s → null', async (_label, response) => {
  const h = await faviconHarness('https://example.com/')
  electronMock.fakeSession.fetch = vi.fn().mockResolvedValue(response)
  h.clearSends()
  h.emitFavicon(['https://example.com/favicon.png'])
  await flushMicrotasks()
  expect(lastFaviconOf(h)).toBe(null)
})

test('over-cap via streamed bytes → null', async () => {
  const h = await faviconHarness('https://example.com/')
  electronMock.fakeSession.fetch = vi
    .fn()
    .mockResolvedValue(imageResponse('image/png', new Uint8Array(40 * 1024))) // no content-length
  h.clearSends()
  h.emitFavicon(['https://example.com/favicon.png'])
  await flushMicrotasks()
  expect(lastFaviconOf(h)).toBe(null)
})

test('empty favicons array → null', async () => {
  const h = await faviconHarness('https://example.com/')
  h.clearSends()
  h.emitFavicon([])
  await flushMicrotasks()
  expect(lastFaviconOf(h)).toBe(null)
})

test('candidate fallback: first non-ok, second image → second wins', async () => {
  const h = await faviconHarness('https://example.com/')
  electronMock.fakeSession.fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, headers: new Headers(), body: streamOf(new Uint8Array()) } as unknown as Response)
    .mockResolvedValueOnce(imageResponse('image/png', new Uint8Array([9, 9])))
  h.clearSends()
  h.emitFavicon(['https://example.com/a.png', 'https://example.com/b.png'])
  await flushMicrotasks()
  expect(lastFaviconOf(h)).toMatch(/^data:image\/png;base64,/)
  expect(electronMock.fakeSession.fetch).toHaveBeenCalledTimes(2)
})
```

- [ ] **Step 2: Run** `npx vitest run electron/browser-pane.test.ts -t favicon` → expect PASS (behavior exists). If any fails, fix the resolver (not the test).

- [ ] **Step 3: Commit.**

```bash
git add electron/browser-pane.test.ts
git commit -m "test(browser): favicon transport edge cases + candidate fallback"
```

---

## Task 4: SSRF Private-Network-Access policy

**Files:** Modify `electron/browser-pane.test.ts` (the policy code landed in Task 2; this proves it).

- [ ] **Step 1: Write the failing/locking tests.**

```ts
test.each(['127.0.0.1', '10.0.0.5', '169.254.169.254', 'localhost', '192.168.1.1'])(
  'public page → private favicon host %s is blocked (no fetch, null)',
  async (host) => {
    const h = await faviconHarness('https://example.com/')
    electronMock.fakeSession.fetch = vi.fn()
    h.clearSends()
    h.emitFavicon([`http://${host}/favicon.ico`])
    await flushMicrotasks()
    expect(electronMock.fakeSession.fetch).not.toHaveBeenCalled()
    expect(lastFaviconOf(h)).toBe(null)
  }
)

test('localhost page → its own localhost favicon is allowed (PNA)', async () => {
  const h = await faviconHarness('http://localhost:3000/')
  electronMock.fakeSession.fetch = vi
    .fn()
    .mockResolvedValue(imageResponse('image/png', new Uint8Array([1, 2])))
  h.clearSends()
  h.emitFavicon(['http://localhost:3000/favicon.png'])
  await flushMicrotasks()
  expect(electronMock.fakeSession.fetch).toHaveBeenCalledTimes(1)
  expect(lastFaviconOf(h)).toMatch(/^data:image\/png;base64,/)
})
```

- [ ] **Step 2: Run** → PASS. (`redirect: 'error'` + `credentials: 'omit'` were asserted in Task 2 Step 1.)

- [ ] **Step 3: Commit.**

```bash
git add electron/browser-pane.test.ts
git commit -m "test(browser): favicon SSRF PNA policy (public→private blocked, local→local allowed)"
```

---

## Task 5: Staleness (generation) + dedup + did-navigate reset ordering

**Files:** Modify `electron/browser-pane.test.ts` (behavior from Task 2; lock the concurrency guarantees).

- [ ] **Step 1: Write the failing/locking tests.**

```ts
test('a pre-navigation in-flight fetch never overwrites the new tab — even on the same favicon URL', async () => {
  const h = await faviconHarness('https://a.com/')
  const deferred = makeDeferred<Response>()
  electronMock.fakeSession.fetch = vi.fn().mockReturnValue(deferred.promise)
  h.emitFavicon(['https://a.com/icon.png']) // gen 1, in-flight
  h.emitNavigate() // did-navigate → reset + gen bump + abort
  h.clearSends()
  deferred.resolve(imageResponse('image/png', new Uint8Array([7]))) // old fetch resolves late
  await flushMicrotasks()
  expect(h.tabsChanged().some((e) => e.tabs[0].favicon !== null)).toBe(false) // gen guard discards it
})

test('a newer (non-deduped) favicon event supersedes an older in-flight fetch', async () => {
  const h = await faviconHarness('https://a.com/')
  const first = makeDeferred<Response>()
  electronMock.fakeSession.fetch = vi
    .fn()
    .mockReturnValueOnce(first.promise) // icon-a in flight (gen 1)
    .mockResolvedValueOnce(imageResponse('image/png', new Uint8Array([2, 2, 2]))) // icon-b (gen 2)
  h.emitFavicon(['https://a.com/icon-a.png']) // gen 1
  h.emitFavicon(['https://a.com/icon-b.png']) // newer key → gen 2 + abort gen 1
  await flushMicrotasks()
  const afterB = lastFaviconOf(h) // icon-b is committed
  expect(afterB).toMatch(/^data:image\/png;base64,/)
  first.resolve(imageResponse('image/png', new Uint8Array([9, 9, 9, 9]))) // stale gen-1 lands late
  await flushMicrotasks()
  expect(lastFaviconOf(h)).toBe(afterB) // unchanged — the stale gen-1 result is discarded
})

test('dedup: a repeat same-favicon event does not refetch', async () => {
  const h = await faviconHarness('https://a.com/')
  electronMock.fakeSession.fetch = vi
    .fn()
    .mockResolvedValue(imageResponse('image/png', new Uint8Array([3])))
  h.emitFavicon(['https://a.com/icon.png'])
  await flushMicrotasks()
  h.emitFavicon(['https://a.com/icon.png']) // same key → skip
  await flushMicrotasks()
  expect(electronMock.fakeSession.fetch).toHaveBeenCalledTimes(1)
})

test('did-navigate clears the favicon — carried in one tabs-changed (no stale-first)', async () => {
  const h = await faviconHarness('https://a.com/')
  electronMock.fakeSession.fetch = vi
    .fn()
    .mockResolvedValue(imageResponse('image/png', new Uint8Array([5])))
  h.emitFavicon(['https://a.com/icon.png'])
  await flushMicrotasks()
  h.clearSends()
  h.emitNavigate() // favicon reset (no emit) THEN emitUrlChanged sends the already-cleared snapshot
  await flushMicrotasks()
  // strict: EVERY post-navigation snapshot is cleared — a stale non-null emit before the clear fails
  expect(h.tabsChanged().length).toBeGreaterThan(0)
  expect(h.tabsChanged().every((e) => e.tabs[0].favicon === null)).toBe(true)
})

test('did-navigate-in-page does NOT reset the favicon', async () => {
  const h = await faviconHarness('https://a.com/')
  electronMock.fakeSession.fetch = vi
    .fn()
    .mockResolvedValue(imageResponse('image/png', new Uint8Array([5])))
  h.emitFavicon(['https://a.com/icon.png'])
  await flushMicrotasks()
  h.clearSends()
  h.emitNavigateInPage() // same document — emitUrlChanged snapshots the icon STILL set
  await flushMicrotasks()
  expect(lastFaviconOf(h)).toMatch(/^data:image\/png;base64,/)
})
```

`makeDeferred()`, `emitNavigate(record)` (emits `did-navigate` on the tab webContents and lets the existing `emitUrlChanged` fire), and `tabsChangedEvents` (array of captured payloads) extend the favicon harness.

- [ ] **Step 2: Run** `npx vitest run electron/browser-pane.test.ts -t favicon` → PASS. If the reset-ordering test fails with two emits, confirm `installFaviconEmitter` is wired **before** `emitUrlChanged` (Task 2 Step 5).

- [ ] **Step 3: Commit.**

```bash
git add electron/browser-pane.test.ts
git commit -m "test(browser): favicon staleness/dedup/reset-ordering guarantees"
```

---

## Task 6: Reconnect snapshot carries favicon

**Files:** Modify `electron/browser-pane.test.ts` (the reconnect builder already routes through `tabSnapshots`, Task 1 — this proves it).

- [ ] **Step 1: Write the test.**

```ts
test('reconnect createPane returns tabs carrying the current favicon', async () => {
  const h = await faviconHarness('https://a.com/')
  electronMock.fakeSession.fetch = vi
    .fn()
    .mockResolvedValue(imageResponse('image/png', new Uint8Array([2])))
  h.emitFavicon(['https://a.com/icon.png'])
  await flushMicrotasks()
  // same sessionId/paneId → the existing-pane (reconnect) branch returns tabSnapshots(existing)
  const reconnect = (await handler(BROWSER_PANE_CREATE)(eventForSender(), {
    sessionId: 'pty-1',
    paneId: 'p1',
    workspaceId: 'w',
    initialUrl: 'https://a.com/',
  })) as { tabs: Array<{ favicon: string | null }> }
  expect(reconnect.tabs[0].favicon).toMatch(/^data:image\/png;base64,/)
})
```

- [ ] **Step 2: Run** → PASS. **Step 3: Commit.**

```bash
git add electron/browser-pane.test.ts
git commit -m "test(browser): reconnect snapshot carries per-tab favicon"
```

---

## Task 7: Renderer `BrowserTabFavicon` + wire into `BrowserTabBar`

**Files:**
- Create: `src/features/browser/components/BrowserTabFavicon.tsx` + `BrowserTabFavicon.test.tsx`
- Modify: `src/features/browser/components/BrowserTabBar.tsx:1-4` (imports), `:63` (drop the inline `faviconPlaceholder` call), `:88-97` (replace the `.fav` glyph block)
- Modify: `src/features/browser/components/BrowserTabBar.test.tsx`

- [ ] **Step 1: Write the failing component test.**

`src/features/browser/components/BrowserTabFavicon.test.tsx`:

```ts
import { test, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BrowserTabFavicon } from './BrowserTabFavicon'

// NOTE: alt="" makes the img decorative — it has NO `img` role. Query the element via the DOM.
test('renders an img when favicon is set', () => {
  const { container } = render(<BrowserTabFavicon favicon="data:image/png;base64,AAAA" url="https://x.com/" />)
  expect(container.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,AAAA')
})

test('renders the placeholder glyph when favicon is null', () => {
  render(<BrowserTabFavicon favicon={null} url="https://x.com/pull/1" />)
  expect(screen.getByText('merge')).toBeInTheDocument() // faviconPlaceholder PR → merge
})

test('falls back to the placeholder when the img errors', () => {
  const { container } = render(<BrowserTabFavicon favicon="data:image/png;base64,bad" url="https://x.com/issues" />)
  fireEvent.error(container.querySelector('img')!)
  expect(screen.getByText('adjust')).toBeInTheDocument() // issue → adjust
})

test('resets the img error state when the favicon prop changes (§5.1)', () => {
  const { container, rerender } = render(<BrowserTabFavicon favicon="data:image/png;base64,bad" url="https://x.com/" />)
  fireEvent.error(container.querySelector('img')!) // error → placeholder
  expect(container.querySelector('img')).toBeNull()
  rerender(<BrowserTabFavicon favicon="data:image/png;base64,GOOD" url="https://x.com/" />)
  expect(container.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,GOOD') // reset
})
```

- [ ] **Step 2: Run to verify failure.** `npx vitest run src/features/browser/components/BrowserTabFavicon.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Create the component.**

`src/features/browser/components/BrowserTabFavicon.tsx`:

```tsx
import { useEffect, useState, type ReactElement } from 'react'
import { faviconPlaceholder, type FaviconTone } from '../faviconPlaceholder'

const TONE_CLASS: Record<FaviconTone, string> = {
  cyan: 'text-[#4fc8d6] bg-[rgba(79,200,214,0.12)]',
  mauve: 'text-[#cba6f7] bg-[rgba(203,166,247,0.12)]',
  coral: 'text-[#ff94a5] bg-[rgba(255,148,165,0.12)]',
}

export interface BrowserTabFaviconProps {
  favicon: string | null
  url: string
}

export const BrowserTabFavicon = ({
  favicon,
  url,
}: BrowserTabFaviconProps): ReactElement => {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [favicon])

  if (favicon && !failed) {
    return (
      <img
        src={favicon}
        alt=""
        decoding="async"
        onError={(): void => setFailed(true)}
        className="h-4 w-4 shrink-0 rounded-[5px] object-contain"
      />
    )
  }

  const { glyph, tone } = faviconPlaceholder(url)

  return (
    <span
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] ${TONE_CLASS[tone]}`}
    >
      <span aria-hidden="true" className="material-symbols-outlined text-[10px]">
        {glyph}
      </span>
    </span>
  )
}
```

(Move `TONE_CLASS` out of `BrowserTabBar.tsx` into this component; `BrowserTabBar` no longer needs it.)

- [ ] **Step 4: Wire into `BrowserTabBar.tsx`.** Remove the `faviconPlaceholder`/`TONE_CLASS` imports+const there, delete the `const fav = faviconPlaceholder(tab.url)` line (`:63`), and replace the `.fav` `<span>` block (`:88-97`) with:

```tsx
<BrowserTabFavicon favicon={tab.favicon} url={tab.url} />
```

Add `import { BrowserTabFavicon } from './BrowserTabFavicon'`.

- [ ] **Step 5: Add the `BrowserTabBar` pass-through test** (and confirm existing tab tests still pass after fixtures gain `favicon`).

```ts
test('passes tab.favicon through to the favicon slot', () => {
  const { container } = render(
    <BrowserTabBar
      tabs={[{ id: 't', url: 'https://x.com/', title: 'X', active: true, favicon: 'data:image/png;base64,AAAA' }]}
      onActivate={() => {}}
      onClose={() => {}}
      onNewTab={() => {}}
    />
  )
  expect(container.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,AAAA')
})
```

Update existing `BrowserTabBar.test.tsx` tab fixtures to include `favicon: null` (tsc-required).

- [ ] **Step 6: Run + verify green.** `npx vitest run src/features/browser/components/BrowserTabFavicon.test.tsx src/features/browser/components/BrowserTabBar.test.tsx` → PASS.

- [ ] **Step 7: Commit.**

```bash
git add src/features/browser/components/BrowserTabFavicon.tsx src/features/browser/components/BrowserTabFavicon.test.tsx src/features/browser/components/BrowserTabBar.tsx src/features/browser/components/BrowserTabBar.test.tsx
git commit -m "feat(browser): render real favicons with placeholder fallback in the tab strip"
```

---

## Task 8: Active-tab load bar in `BrowserToolbar` + tailwind keyframes

**Files:**
- Modify: `tailwind.config.js` (theme.extend keyframes/animation)
- Modify: `src/features/browser/components/BrowserToolbar.tsx:1` (import `BROWSER_IDENTITY`), `:63` (root `relative`), add the bar
- Modify: `src/features/browser/components/BrowserToolbar.test.tsx`
- Verify: `src/features/browser/components/BrowserPane.test.tsx` (favicon from tabs-changed + load bar via `navState.isLoading` — already wired by L2 + Task 1; add a confirming test)

- [ ] **Step 1: Add the tailwind animation.** In `tailwind.config.js` under `theme.extend`:

```js
keyframes: {
  'browser-load-bar': {
    '0%': { transform: 'translateX(-110%)' },
    '100%': { transform: 'translateX(340%)' },
  },
},
animation: { 'browser-load-bar': 'browser-load-bar 1.4s ease-in-out infinite' },
```

(Merge into existing `keyframes`/`animation` maps if present — do not clobber.)

- [ ] **Step 2: Write the failing toolbar test.**

```ts
test('renders the load bar only when isLoading', () => {
  const props = { /* existing required BrowserToolbar props */ } as const
  const { rerender, container } = render(<BrowserToolbar {...props} isLoading={false} />)
  expect(container.querySelector('[data-testid="browser-load-bar"]')).toBeNull()
  rerender(<BrowserToolbar {...props} isLoading={true} />)
  expect(container.querySelector('[data-testid="browser-load-bar"]')).not.toBeNull()
})
```

(Build `props` from the existing `BrowserToolbar.test.tsx` helper that already supplies the L2 nav props + address props.)

- [ ] **Step 3: Run to verify failure** → FAIL (no `browser-load-bar` node).

- [ ] **Step 4: Add the bar.** In `BrowserToolbar.tsx`: `import { BROWSER_IDENTITY } from '../browserIdentity'`; add `relative` to the root div's className (`:63`); render the bar as the last child of the root:

```tsx
{isLoading ? (
  <div
    data-testid="browser-load-bar"
    className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] overflow-hidden"
  >
    <div
      className="h-full w-2/5 motion-safe:animate-browser-load-bar motion-reduce:w-full motion-reduce:opacity-60"
      style={{
        background: `linear-gradient(90deg, transparent, ${BROWSER_IDENTITY.accent}, transparent)`,
      }}
    />
  </div>
) : null}
```

- [ ] **Step 5: Run toolbar test** → PASS.

- [ ] **Step 6: Add the `BrowserPane` integration test** (favicon via tabs-changed + load bar via nav-state).

```ts
// Use BrowserPane.test.tsx's EXISTING harness: `bridgeMocks` (the window.vimeflow.browserPane mock),
// the subscription callbacks captured from `onTabsChange` / `onNavStateChange`, and `settle` for async
// flushing. Adapt the names below to the file's actual exports (e.g. how it reads SESSION_ID/PANE_ID).
test('a tabs-changed event with a favicon updates the tab icon', async () => {
  const { container } = renderBrowserPane() // existing render helper for a configured pane
  const onTabs = vi.mocked(bridgeMocks.onTabsChange).mock.calls[0][0] // captured subscriber
  onTabs({
    sessionId: SESSION_ID,
    paneId: PANE_ID,
    tabs: [{ id: 'tab-0', url: 'https://x.com/', title: 'X', active: true, favicon: 'data:image/png;base64,AAAA' }],
  })
  await settle()
  expect(container.querySelector('img')).toHaveAttribute('src', 'data:image/png;base64,AAAA')
})

test('the load bar shows when nav-state isLoading is true', async () => {
  const { findByTestId } = renderBrowserPane()
  const onNav = vi.mocked(bridgeMocks.onNavStateChange).mock.calls[0][0]
  onNav({ sessionId: SESSION_ID, paneId: PANE_ID, tabId: 'tab-0', canGoBack: false, canGoForward: false, isLoading: true })
  expect(await findByTestId('browser-load-bar')).toBeInTheDocument()
})
```

(`renderBrowserPane` / `bridgeMocks` / `settle` / `SESSION_ID` / `PANE_ID` are the existing `BrowserPane.test.tsx` harness pieces the L2 nav-state renderer test already uses — reuse them, don't invent new ones. The img is decorative, so query the DOM, not `getByRole('img')`.)

- [ ] **Step 7: Run the full browser suite + checks.**

```bash
npx vitest run src/features/browser electron/browser-pane.test.ts
npm run lint
npm run type-check
```

Expected: all PASS / clean.

- [ ] **Step 8: Commit.**

```bash
git add tailwind.config.js src/features/browser/components/BrowserToolbar.tsx src/features/browser/components/BrowserToolbar.test.tsx src/features/browser/components/BrowserPane.test.tsx
git commit -m "feat(browser): active-tab load bar in the chrome layer"
```

---

## Final verification (after Task 8)

- [ ] `npm run lint && npm run type-check && npm run test` → all green.
- [ ] **Manual (real Electron build, §5.3 — NOT jsdom):** `npm run electron:dev`, open a browser pane:
  - github / a PR page / an issue page show their real site favicons; a faviconless page shows the L1 placeholder glyph.
  - The load bar animates (sliding cyan segment) while the active tab loads, gone when idle, no chrome jitter; under OS "reduce motion" it's the static strip.
  - A `localhost` dev server shows its own favicon; (optional) a public page that declares a `http://127.0.0.1/...` favicon shows the placeholder (PNA block).

---

## Spec-coverage self-check

- §2.1 favicon field across record/snapshot/`tabSnapshots`/renderer type → **Task 1**
- §2.2 resolver (candidate loop, data: passthrough, http fetch, cap both ways, canonical MIME) → **Task 2/3**
- §2.2/§2.4 SSRF PNA + `credentials:'omit'` + `redirect:'error'` → **Task 2/4**
- §2.3 generation staleness + dedup + bounded key → **Task 2/5**
- §2.4 one installer, both paths, reset before `emitUrlChanged`, did-navigate-only → **Task 2/5**
- §2.5 cross-boundary field checklist (bridge fallback, BrowserPane initial state) → **Task 1**
- §2.6 ≈32 KB cap / payload bound → **Task 2** (constants) / **Task 3** (over-cap tests)
- §3 `BrowserTabFavicon` img + onError + reset, wired into `BrowserTabBar` → **Task 7**
- §4 load bar (reuse `isLoading`, chrome-layer absolute, motion, tailwind keyframes, BrowserToolbar-owned) → **Task 8**
- §5 component + main-process + reconnect + bridge tests → **Tasks 1,3,4,5,6,7,8**; §5.3 manual → Final verification

<!-- codex-reviewed: 2026-06-05T03:50:59Z -->

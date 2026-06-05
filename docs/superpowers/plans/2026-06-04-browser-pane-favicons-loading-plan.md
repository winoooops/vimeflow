# Browser pane — favicons + loading (L3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the built-in browser pane real per-tab favicons and an active-tab load bar, per `docs/superpowers/specs/2026-06-04-browser-pane-favicons-loading-design.md` (Approach A).

**Architecture:** Main resolves `page-favicon-updated` candidates into a size-capped `data:` URL (the renderer CSP forbids remote favicon hosts) under an SSRF Private-Network-Access policy, stores it per-tab, and ships it over the existing `tabs-changed` stream. The renderer renders `<img>` with the L1 `faviconPlaceholder` fallback. The active-tab load bar reuses L2's `navState.isLoading`, rendered as an absolutely-positioned chrome-layer strip (zero re-layout).

**Tech Stack:** Electron 42 main (`WebContentsView`, `session.fetch`, `AbortSignal.any`/`.timeout`, `node:crypto`), React/TypeScript renderer, Tailwind, Vitest + Testing Library.

**Conventions:** No semicolons, single quotes, trailing-comma es5, explicit return types on exported fns, arrow components, `test()` not `it()`, explicit `import { test, expect, vi } from 'vitest'` per new test file, co-located tests. Commit per task with `feat(browser): …` (lowercase subject). Run from the worktree `worktrees/browser-pane-favicons-loading`.

**Test harness note (main):** `electron/browser-pane.test.ts` already mocks `WebContentsView` / `webContents` (as an `EventEmitter`) and `BrowserWindow` (L2 added nav tests). Favicon tests drive the tab's `webContents` events (`emit('page-favicon-updated', …)`, `emit('did-navigate')`) and assert the captured `BROWSER_PANE_TABS_CHANGED` payload. Add a `session.fetch` mock on the mocked session. Reuse the existing helpers rather than re-inventing them — read the top of `browser-pane.test.ts` first.

---

## Constants (add near the other browser-pane constants in `electron/browser-pane.ts`)

```ts
const FAVICON_BYTE_CAP = 32 * 1024 // decoded image bytes (§2.6 ≈32 KB)
const MAX_FAVICON_URL = 64 * 1024 // string-length cap for a passthrough data: favicon
const MAX_FAVICON_CANDIDATES = 4 // bound the candidate loop per event
const FAVICON_FETCH_TIMEOUT_MS = 5000 // per-candidate fetch timeout
```

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
  const { result } = await createPaneViaHarness() // existing helper that invokes BROWSER_PANE_CREATE
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
git add electron/browser-pane.ts src/features/browser/types.ts src/features/browser/browserBridge.ts src/features/browser/components/BrowserPane.tsx electron/browser-pane.test.ts src/features/browser/browserBridge.test.ts
git commit -m "feat(browser): add per-tab favicon field (null) across the tab model"
```

---

## Task 2: Favicon resolver + installer — happy path (`page-favicon-updated` → `tabs-changed`)

Adds `resolveFaviconDataUrl`, `installFaviconEmitter`, and the PNA host guard, wired into both setup paths **before** `emitUrlChanged`. Tested through the public event/IPC surface (no private exports), per §5.2.

**Files:**
- Modify: `electron/browser-pane.ts` — new helpers + wiring at the create `tab-0` setup (before `:843`'s `emitUrlChanged`) and the new-tab setup (before `:1027`'s `emitUrlChanged`)
- Test: `electron/browser-pane.test.ts`

- [ ] **Step 1: Write the failing tests** (data: passthrough + http fetch → data: URL).

```ts
test('page-favicon-updated with a data: image candidate sets favicon to that data URL', async () => {
  const { record, captureTabsChanged } = await createPaneViaHarness()
  const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
  record.tabs.get('tab-0')!.view.webContents.emit('page-favicon-updated', {}, [dataUrl])
  await flushMicrotasks()
  expect(captureTabsChanged().tabs[0].favicon).toBe(dataUrl)
})

test('page-favicon-updated with an http image candidate fetches + inlines a data URL', async () => {
  const { record, session, captureTabsChanged } = await createPaneViaHarness()
  session.fetch = vi.fn().mockResolvedValue(
    imageResponse('image/png', new Uint8Array([1, 2, 3, 4]))
  )
  record.tabs.get('tab-0')!.view.webContents.setURL('https://example.com/') // committed page origin
  record.tabs.get('tab-0')!.view.webContents.emit('page-favicon-updated', {}, [
    'https://example.com/favicon.png',
  ])
  await flushMicrotasks()
  expect(captureTabsChanged().tabs[0].favicon).toMatch(/^data:image\/png;base64,/)
  expect(session.fetch).toHaveBeenCalledWith(
    'https://example.com/favicon.png',
    expect.objectContaining({ redirect: 'error', credentials: 'omit' })
  )
})
```

`imageResponse(type, bytes)` is a small local helper returning `{ ok: true, headers: new Headers({ 'content-type': type }), body: streamOf(bytes), arrayBuffer: async () => bytes.buffer }`. Add it beside the other test helpers.

- [ ] **Step 2: Run to verify failure.** `npx vitest run electron/browser-pane.test.ts -t favicon` → FAIL (no favicon ever emitted).

- [ ] **Step 3: Add the resolver, host guard, key, and streaming read** (top-level fns in `electron/browser-pane.ts`).

```ts
import { createHash } from 'node:crypto'

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
  session: Session,
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
  ['non-ok response', { ok: false, headers: new Headers(), body: streamOf(new Uint8Array()) }],
  ['zero-byte image body', imageResponse('image/png', new Uint8Array())],
  ['over-cap via content-length', imageResponse('image/png', new Uint8Array([1]), { 'content-length': String(40 * 1024) })],
])('http favicon %s → favicon null', async (_label, response) => {
  const { record, session, captureTabsChanged } = await faviconHarness('https://example.com/')
  session.fetch = vi.fn().mockResolvedValue(response)
  emitFavicon(record, ['https://example.com/favicon.png'])
  await flushMicrotasks()
  expect(captureTabsChanged().tabs[0].favicon).toBe(null)
})

test('over-cap via streamed bytes → favicon null', async () => {
  const { record, session, captureTabsChanged } = await faviconHarness('https://example.com/')
  session.fetch = vi.fn().mockResolvedValue(
    imageResponse('image/png', new Uint8Array(40 * 1024)) // no content-length; streamed cap trips
  )
  emitFavicon(record, ['https://example.com/favicon.png'])
  await flushMicrotasks()
  expect(captureTabsChanged().tabs[0].favicon).toBe(null)
})

test('empty favicons array clears to null', async () => {
  const { record, captureTabsChanged } = await faviconHarness('https://example.com/')
  emitFavicon(record, [])
  await flushMicrotasks()
  expect(captureTabsChanged().tabs[0].favicon).toBe(null)
})

test('candidate fallback: first non-ok, second image → second wins', async () => {
  const { record, session, captureTabsChanged } = await faviconHarness('https://example.com/')
  session.fetch = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, headers: new Headers(), body: streamOf(new Uint8Array()) })
    .mockResolvedValueOnce(imageResponse('image/png', new Uint8Array([9, 9])))
  emitFavicon(record, ['https://example.com/a.png', 'https://example.com/b.png'])
  await flushMicrotasks()
  expect(captureTabsChanged().tabs[0].favicon).toMatch(/^data:image\/png;base64,/)
  expect(session.fetch).toHaveBeenCalledTimes(2)
})
```

`faviconHarness(pageUrl)` and `emitFavicon(record, urls)` are thin wrappers over Task 2's harness (set the tab's committed URL, return `{ record, session, captureTabsChanged }`). Add them once near the top of the favicon test block.

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
  'public page → private favicon host %s is blocked (no fetch, favicon null)',
  async (host) => {
    const { record, session, captureTabsChanged } = await faviconHarness('https://example.com/')
    session.fetch = vi.fn()
    emitFavicon(record, [`http://${host}/favicon.ico`])
    await flushMicrotasks()
    expect(session.fetch).not.toHaveBeenCalled()
    expect(captureTabsChanged().tabs[0].favicon).toBe(null)
  }
)

test('localhost page → its own localhost favicon is allowed (PNA)', async () => {
  const { record, session, captureTabsChanged } = await faviconHarness('http://localhost:3000/')
  session.fetch = vi.fn().mockResolvedValue(imageResponse('image/png', new Uint8Array([1, 2])))
  emitFavicon(record, ['http://localhost:3000/favicon.png'])
  await flushMicrotasks()
  expect(session.fetch).toHaveBeenCalledTimes(1)
  expect(captureTabsChanged().tabs[0].favicon).toMatch(/^data:image\/png;base64,/)
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
  const { record, session, captureTabsChanged } = await faviconHarness('https://a.com/')
  const deferred = makeDeferred() // { promise, resolve }
  session.fetch = vi.fn().mockReturnValue(deferred.promise)
  emitFavicon(record, ['https://a.com/icon.png']) // starts in-flight fetch (gen 1)
  emitNavigate(record) // did-navigate → reset + gen bump + abort
  deferred.resolve(imageResponse('image/png', new Uint8Array([7]))) // old fetch resolves late
  await flushMicrotasks()
  expect(captureTabsChanged().tabs[0].favicon).toBe(null) // discarded by gen guard
})

test('dedup: a repeat same-favicon event does not refetch', async () => {
  const { record, session } = await faviconHarness('https://a.com/')
  session.fetch = vi.fn().mockResolvedValue(imageResponse('image/png', new Uint8Array([3])))
  emitFavicon(record, ['https://a.com/icon.png'])
  await flushMicrotasks()
  emitFavicon(record, ['https://a.com/icon.png']) // same key → skip
  await flushMicrotasks()
  expect(session.fetch).toHaveBeenCalledTimes(1)
})

test('did-navigate clears favicon in a single tabs-changed; did-navigate-in-page does not reset', async () => {
  const { record, session, tabsChangedEvents } = await faviconHarness('https://a.com/')
  session.fetch = vi.fn().mockResolvedValue(imageResponse('image/png', new Uint8Array([5])))
  emitFavicon(record, ['https://a.com/icon.png'])
  await flushMicrotasks()
  tabsChangedEvents.length = 0
  emitNavigate(record) // did-navigate (full commit) — favicon reset, carried by emitUrlChanged
  const navEmits = tabsChangedEvents.filter((e) => e.tabs[0].favicon === null)
  expect(navEmits.length).toBe(1) // exactly one cleared snapshot, no stale-first

  // in-page navigation keeps the icon
  record.tabs.get('tab-0')!.view.webContents.emit('did-navigate-in-page')
  await flushMicrotasks()
  expect(record.tabs.get('tab-0')!.favicon).toMatch(/^data:image\/png;base64,/)
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
  const { record, session } = await faviconHarness('https://a.com/')
  session.fetch = vi.fn().mockResolvedValue(imageResponse('image/png', new Uint8Array([2])))
  emitFavicon(record, ['https://a.com/icon.png'])
  await flushMicrotasks()
  const reconnect = await createPaneViaHarness({ sessionId: record.sessionId, paneId: record.paneId })
  expect(reconnect.result.tabs[0].favicon).toMatch(/^data:image\/png;base64,/)
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

test('renders an img when favicon is set', () => {
  render(<BrowserTabFavicon favicon="data:image/png;base64,AAAA" url="https://x.com/" />)
  expect(screen.getByRole('img', { hidden: true })).toHaveAttribute('src', 'data:image/png;base64,AAAA')
})

test('renders the placeholder glyph when favicon is null', () => {
  render(<BrowserTabFavicon favicon={null} url="https://x.com/pull/1" />)
  expect(screen.getByText('merge')).toBeInTheDocument() // faviconPlaceholder PR → merge
})

test('falls back to the placeholder when the img errors', () => {
  render(<BrowserTabFavicon favicon="data:image/png;base64,bad" url="https://x.com/issues" />)
  fireEvent.error(screen.getByRole('img', { hidden: true }))
  expect(screen.getByText('adjust')).toBeInTheDocument() // issue → adjust
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
  render(
    <BrowserTabBar
      tabs={[{ id: 't', url: 'https://x.com/', title: 'X', active: true, favicon: 'data:image/png;base64,AAAA' }]}
      onActivate={() => {}}
      onClose={() => {}}
      onNewTab={() => {}}
    />
  )
  expect(screen.getByRole('img', { hidden: true })).toHaveAttribute('src', 'data:image/png;base64,AAAA')
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
test('a tabs-changed event with a favicon updates the tab icon', async () => {
  renderBrowserPaneWithBridge() // existing harness
  emitBridgeTabsChanged({ tabs: [{ id: 'tab-0', url: 'https://x.com/', title: 'X', active: true, favicon: 'data:image/png;base64,AAAA' }] })
  expect(await screen.findByRole('img', { hidden: true })).toHaveAttribute('src', 'data:image/png;base64,AAAA')
})

test('the load bar shows when nav-state isLoading is true', async () => {
  renderBrowserPaneWithBridge()
  emitBridgeNavState({ canGoBack: false, canGoForward: false, isLoading: true })
  expect(await screen.findByTestId('browser-load-bar')).toBeInTheDocument()
})
```

(`emitBridgeTabsChanged` / `emitBridgeNavState` reuse the `window.vimeflow.browserPane` mock from `BrowserPane.test.tsx`.)

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

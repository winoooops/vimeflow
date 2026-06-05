# Browser pane — favicons + loading (L3: real per-tab favicons + active-tab load bar)

## 1. Overview & scope

### Context

L1 (`2026-06-03-browser-pane-chrome-redesign-design.md`, PR #338) shipped the Arc
two-row chrome with **deterministic placeholder favicons** — `faviconPlaceholder(url)`
(`src/features/browser/faviconPlaceholder.ts`) maps each tab's URL to a Material-Symbol
glyph + tone, rendered in the 16px `.fav` slot (`BrowserTabBar.tsx:63,88-97`) — and
**reserved no space for a load bar** (L1 §5.3). L2 (`2026-06-03-browser-pane-nav-controls-design.md`,
PR #345) wired the active tab's `did-start-loading` / `did-stop-loading` into an
**active-tab-gated** `navState.isLoading` (`browser-pane.ts:950-951`; `emitPaneNavStateChanged`
gated at `:924`) that drives the reload↔stop toggle.

L1 fixed the L3 contract verbatim:

- **§5.2** — "_a pure `faviconPlaceholder(url)` helper … L3 swaps the glyph/tone source
  for the real favicon, keeping the 16px slot._"
- **§5.3** — "_the native `WebContentsView` paints above React, [so] the load bar
  **cannot** be a React overlay over `.page` — L3 must place it in the chrome layer
  (e.g. a 2px strip along the toolbar's bottom edge, above the native region)._"

This is **#316 Phase 2b**.

### What L3 delivers (Approach A)

1. **Real per-tab favicons** — each tab's `webContents` `page-favicon-updated` event
   supplies the page's favicon URLs (`favicons: string[]`); main selects one, **fetches it,
   and delivers a size-capped `data:` URL** to the renderer (the renderer CSP forbids loading
   arbitrary remote favicon hosts — see In scope). This replaces the URL-heuristic
   placeholder, which stays as the **fallback** for tabs with no favicon (or one that fails to
   fetch/decode). Favicon is **per-tab**: it rides the existing `tabs-changed` stream (which
   already ships the full `tabs[]`), not L2's active-tab-gated `nav-state`.
2. **The active-tab load bar** — an indeterminate animated cyan strip in the **chrome
   layer** (toolbar bottom edge), shown while the active tab loads. It **reuses L2's existing
   `navState.isLoading`** — no new main-process signal, no new IPC. Absolutely positioned so
   toggling it is **zero re-layout** (no native-view bounds change).

### In scope (L3)

- A `favicon: string | null` field — a ready-to-render **`data:` URL** (or null) — on the
  tab model: renderer `BrowserPaneTab` (`types.ts:24`), main `BrowserPaneTabSnapshot`
  (`browser-pane.ts:149`) + `BrowserPaneTabRecord` (`:143`). Populated main-side, carried to
  the renderer over the **existing** `tabs-changed` event + the `createPane` `tabs[]`
  snapshot (so reconnect hydration is free; §2).
- A single `page-favicon-updated` installer on each tab's `webContents` in **both**
  view-setup paths (create `:846-849`, new-tab `:1030-1033`), mirroring how L2 routed its
  loading listeners through `installNavStateEmitters` to avoid a third duplicate (§2).
- **Main-side favicon resolution** (§2): on `page-favicon-updated(_e, favicons: string[])` try
  the candidate URLs **in array order** and take the first that passes **transport validation**
  (a reachable, non-empty `image/*` response within the byte cap; Electron documents no
  ordering, so a candidate that fails at fetch level falls back to the next; empty array →
  null). Each candidate is made CSP-safe — `http(s)` favicons are fetched main-side and encoded
  as a `data:` URL; favicons already supplied as `data:` URLs pass through (still capped). Main
  cannot decode every favicon format (SVG, ICO) to pre-validate the bytes, so a transport-valid
  response the renderer can't decode falls to the placeholder via img `onError` (§3) — not a
  loop retry. The renderer **never** loads a remote favicon host: the CSP `img-src` is
  deliberately `'self' data: blob:` + two CDNs with **no `https:` wildcard** (`csp.ts:27` + its
  rationale comment), so inlining as `data:` is the in-character fix, **not** a CSP relaxation.
- A favicon **reset on full-document navigation** (`did-navigate`, not `did-navigate-in-page`)
  so a stale icon never persists across a cross-document load (§2).
- Renderer: `BrowserTabBar`'s `.fav` slot renders `<img src={favicon}>` with
  `faviconPlaceholder(url)` as the empty/`onError` fallback (§3).
- The load bar in `BrowserToolbar`, driven by the existing `isLoading` prop (§4).

### Out of scope (L3) — deferred

- **Per-tab loading spinner (VIM-67).** A spinner in each tab's favicon slot while _that_
  tab loads needs a **per-tab** `loading` signal — L2 deliberately gated loading to the
  active tab, and the handoff shows static favicons with no tab spinner. Split to **VIM-67**
  (Option B), blocked by this issue. L3's load bar is **active-tab only**.
- **Load _progress_ percentage.** `did-start/stop-loading` are binary; the bar is
  indeterminate. Electron exposes no main-frame load progress for `WebContentsView`.
- **Secure-state / cert lock changes** — the address lock stays L1's scheme-only
  derivation (L1 §4.2).
- No change to the `WebContentsView` host, tab lifecycle, partitions, bounds, the
  address-bar state machine, nav-action/nav-state, or `open-external`.

### Success criteria (detail in §5)

1. Each tab shows its site's real favicon once loaded; a tab with no favicon (or a broken
   favicon URL) shows the L1 placeholder; favicons are correct per-tab including background
   tabs and after reconnect.
2. The active tab shows an animated load bar in the chrome layer while loading, gone when
   idle, with **zero chrome re-layout** and no native-view jitter; `prefers-reduced-motion`
   is respected.
3. No new IPC channel and no CSP relaxation — favicon rides `tabs-changed` as an inlined
   `data:` URL; the load bar reuses `navState.isLoading`.
4. `npm run lint`, `npm run type-check`, `npm run test` pass; new main + component behavior
   is covered.

## 2. Favicon — per-tab data model + main wiring

### 2.1 The `favicon` field (a resolved `data:` URL)

`favicon` is a **ready-to-render `data:` URL or `null`** — never a remote URL (§1: CSP). It
rides the existing per-tab transport:

| shape                       | file                  | change                                                                                 |
| --------------------------- | --------------------- | -------------------------------------------------------------------------------------- |
| `BrowserPaneTabRecord`      | `browser-pane.ts:143` | `+ favicon: string \| null` (resolved data: URL; `null` at construction in both paths) |
| `BrowserPaneTabSnapshot`    | `browser-pane.ts:149` | `+ favicon: string \| null`                                                            |
| `tabSnapshots()`            | `browser-pane.ts:883` | map `favicon: tab.favicon`                                                             |
| `BrowserPaneTab` (renderer) | `types.ts:24`         | `+ favicon: string \| null`                                                            |

Both `tabs-changed` (`emitTabsChanged :904`) and the `createPane` result (create `:860`,
**reconnect `:744`**) build `tabs[]` from `tabSnapshots`, so favicon reaches the renderer on the
live stream **and** the reconnect snapshot with no bespoke field (unlike L2's `navState`). The
field is required-but-nullable, so `tsc` enforces the plumbing — every `BrowserPaneTab` literal
must add `favicon` (§2.5).

### 2.2 Resolving a favicon: candidates → fetch/inline → encode

`page-favicon-updated(event, favicons: string[])` reports the page's declared icon URLs. The
Electron contract is only "an array of URLs" — **no documented ordering** — so the resolver
**tries candidates in array order and takes the first that passes transport validation**
(reachable, `image/*`, within cap), rather than betting on one position (a candidate that fails
at fetch level falls back to the next):

```text
// per-tab closure state (§2.3): gen, controller, pendingKey, resolvedKey
on page-favicon-updated(_e, favicons):
  candidates = favicons.filter(u => u.length <= MAX_FAVICON_URL).slice(0, MAX_CANDIDATES)
  key = hash(candidates.join('\n'))     // full surviving URLs → key identity == resolution (§2.3)
  if key === resolvedKey or key === pendingKey: return     // already shown / in flight — dedup (§2.3)
  controller?.abort()                                      // abort the previous resolution
  myController = new AbortController()                     // LOCAL to this invocation
  controller = myController                                // publish as the current resolution
  pendingKey = key
  myGen = ++gen                                            // tag this (non-deduped) resolution (§2.3)
  dataUrl = null
  for url of candidates:                                   // full URLs; first transport-valid wins
    if myController.signal.aborted: break                 // superseded — stop (this invocation's signal)
    dataUrl = await resolveFaviconDataUrl(session, url, myController.signal)
    if dataUrl !== null: break
  if tab gone or myGen !== gen: return                    // superseded → bail, touch no shared state
  tab.favicon = dataUrl
  resolvedKey = dataUrl ? key : null                      // only a real icon counts as "shown"; retry empties
  pendingKey = null
  if controller === myController: controller = null       // clear the shared ref only if still ours
  emitTabsChanged
```

(An empty `favicons` array makes the loop a no-op → `dataUrl` stays `null` → the tab shows the
placeholder.)

`resolveFaviconDataUrl(session, url, resolutionSignal)` — resolve **one** candidate to a `data:`
URL or `null`:

- **`data:` URL** → accept only a canonical `data:image/<subtype>;base64,<payload>` with a
  **non-empty** payload and a decoded size within the cap (the candidate already passed the
  `MAX_FAVICON_URL` string-length filter, so the stored URL is bounded); else `null`. (Inline
  favicons skip the network.)
- **`http(s):` URL** → fetched main-side under a strict **SSRF policy** — the favicon URL is
  page-controlled, so this must not become an arbitrary fetch primitive:
  `session.fetch(url, { signal, redirect: 'error', credentials: 'omit' })` on the tab's partition
  session (`view.webContents.session`, for its cache / proxy). **`credentials: 'omit'`** is explicit
  (Fetch defaults to `same-origin`): favicons are public assets, and sending cookies would enable a
  *credentialed* SSRF. Scheme must be `http(s)`, and `redirect: 'error'` so a redirect can't bypass
  the checks. The host guard uses the **Private-Network-Access model**: a target that is loopback /
  private / link-local / reserved (`localhost`, RFC1918, `169.254/16`, `::1`, metadata IPs) is
  rejected **only when the tab's committed page origin is *public*** — a private / local page (e.g. a
  `localhost` dev server) may still load its **own** local favicon, so L3 doesn't regress the pane's
  first-class localhost / intranet use case (cf. `LOCAL_DEV_HOST_PATTERN`, `BrowserPane.tsx:43`).
  (Robust enforcement resolves + pins the IP to defeat DNS rebinding — an impl hardening detail.) It
  is a Session network-stack fetch, not a renderer request, so no `webSecurity` semantics apply. The `signal`
  **combines** the resolution's shared `AbortController` (§2.3 — a superseding event /
  `did-navigate` aborts the **whole** resolution) with a **per-candidate** ≈5 s
  `AbortSignal.timeout`, via `AbortSignal.any([resolutionSignal, AbortSignal.timeout(…)])` — a
  candidate *timing out* aborts only that fetch (loop advances); a *supersede* aborts everything.
  Then validate: reject unless `res.ok`, `Content-Type` is `image/*`, and the body is **non-empty**;
  enforce the **byte cap both ways** (§2.6, ≈32 KB) — reject up-front when `Content-Length` exceeds
  it and abort the read once streamed bytes pass it (never buffer an unbounded body); then
  `data:image/${subtype};base64,${base64(bytes)}` with `subtype` from the validated `Content-Type`
  (canonical MIME, no extra params).
- **any other scheme** (`file:`, `chrome:`, …) or any throw / timeout / oversize → `null`.

`resolveFaviconDataUrl` validates only at the **transport** level — main cannot decode every
favicon format (SVG, ICO) to pre-check the bytes, so a response that passes transport checks but
the renderer can't decode is **not** re-tried against later candidates; it commits, and the
renderer's img `onError` falls back to the placeholder (§3). The candidate loop advances only on
**fetch-level** failure (unreachable / non-`ok` / non-image / oversize); the loop is **bounded**
(`MAX_CANDIDATES`, e.g. 4) and shares one `AbortController`, so per-event favicon work is capped
and a superseding event cancels it at once. The fetch is per-tab and **not** active-gated —
background tabs resolve their own favicons.

### 2.3 Staleness & dedup (installer-closure state)

The installer (§2.4) holds per-tab closure state: a monotonic `gen` counter, the in-flight
`AbortController`, and two **bounded-digest** markers `pendingKey` / `resolvedKey` (hashes of the
**capped** candidate list — over-length URLs are dropped (`≤ MAX_FAVICON_URL`) and the list is
sliced to `MAX_CANDIDATES`, then the **full surviving URLs** are hashed, so the dedup key matches
exactly what gets resolved while staying bounded even for many / huge inline `data:` favicons):

- **Dedup** — a `page-favicon-updated` whose `key` equals `resolvedKey` (already shown) or
  `pendingKey` (in flight) returns immediately, with no refetch.
- **Staleness** — each resolution captures `myGen = ++gen` at the start and commits **only if**
  `gen` is unchanged when it finishes. Any newer **non-deduped** favicon event (one that passes the
  dedup check) **and** the `did-navigate` reset bump `gen` and `abort()` the in-flight fetch — so a
  fetch started before a navigation can never overwrite the new document's tab, **even if the new
  page declares the same favicon URL** (the key would match, but the generation will not). A
  deduped repeat returns early and leaves the in-flight resolution untouched. Key equality alone is
  *not* the staleness guard. (In practice `did-navigate` — the document commit — fires **before**
  the new document's `page-favicon-updated`, which is parsed from the committed DOM, so the reset's
  key-clear lands ahead of the new page's favicon events; dedup never suppresses a freshly-navigated
  favicon.)
- **Reset** — `did-navigate` aborts the controller, bumps `gen`, clears `pendingKey` /
  `resolvedKey` and `tab.favicon`, and emits **nothing itself** (wired before `emitUrlChanged`,
  §2.4).

The state is closure-local (not record fields): the installer runs once per view and the view
outlives renderer reloads, so it survives reconnect alongside `record.favicon`.

### 2.4 One installer, both setup paths (+ navigate reset)

A private `installFaviconEmitter(record, view, tabId)` wires:

- `page-favicon-updated` → the resolver (§2.2);
- `did-navigate` → reset: **abort the in-flight fetch**, **bump `gen`** (invalidating any pending
  resolution, §2.3), and clear `tab.favicon`, `pendingKey`, and `resolvedKey` — full-document
  commits only, **not** `did-navigate-in-page` (same document keeps its icon). The reset does
  **not** emit; it is registered before the existing did-navigate `emitUrlChanged` (which rebuilds
  `tabSnapshots`), which then sends the already-cleared favicon in one snapshot.

Invoked from **both** view-setup paths — create-path `tab-0` and new-tab — **before** the
existing `emitUrlChanged` listeners are wired (i.e. ahead of `browser-pane.ts:846` / `:1030`),
so the reset is registered first. `EventEmitter` fires listeners in registration order, so the
clear runs before the navigation's url-changed snapshot — no stale-favicon frame. Like L2's
`installNavStateEmitters`, it centralizes the favicon listeners in one place instead of a third
inline copy.

### 2.5 Wiring checklist (field across the main/renderer boundary)

No new channel — but the required-nullable field must land in **every** `BrowserPaneTab` literal,
or `tsc` fails (the good kind of silent-failure guard):

- main: record field (`:143`), snapshot field (`:149`), `tabSnapshots` map (`:883`); init
  `favicon: null` at both tab-record constructions (create + new-tab).
- renderer: `BrowserPaneTab` (`types.ts:24`); the initial tabs-state literal
  (`BrowserPane.tsx:122-124`) → `favicon: null`; the **bridge-absent `createBrowserPane`
  fallback** (`browserBridge.ts:43-50`) → `favicon: null`.
- the create result + `tabs-changed` inherit favicon via `tabSnapshots` (create `:860` and
  reconnect `:744` both route through it).

### 2.6 Payload note

The `data:` URL travels inside every `tabs-changed` payload (which also fires on
`page-title-updated`). To keep that bounded the byte cap is a tight **≈32 KB** (favicons render at
16px; standard icons fit well under it, oversize ones fall back to the placeholder), and the stored
string is length-bounded (passthrough by `MAX_FAVICON_URL`, http-fetched by the byte cap). Worst
case is `MAX_TABS_PER_PANE` (20) × ~44 KB base64 ≈ <1 MB on a title-only emit, typically just a few
small icons; favicon bytes are **recomputed only on `page-favicon-updated`** (cached on the record),
so title updates re-send the cached value, never a refetch. If profiling still shows IPC pressure,
the deferred optimization is to move favicons off `tabs-changed` onto a dedicated per-tab
`favicon-changed` event (or a custom `img-src`-allowed favicon protocol serving cached bytes by tab
id) — out of scope for L3.

## 3. Favicon — renderer rendering + fallback

L1 renders every `.fav` slot from `faviconPlaceholder(tab.url)` (`BrowserTabBar.tsx:63`, glyph
box at `:88-97`). L3 makes the slot prefer the real favicon, falling back to that placeholder —
**same 16px footprint, zero re-layout**.

### 3.1 `BrowserTabFavicon` (new presentational child)

Extract the `.fav` slot into a small component owning the img/placeholder choice + its error
state:

```tsx
const BrowserTabFavicon = ({
  favicon,
  url,
}: {
  favicon: string | null
  url: string
}): ReactElement => {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [favicon]) // a new favicon clears a prior load error

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
  const { glyph, tone } = faviconPlaceholder(url) // unchanged L1 placeholder branch
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

- `favicon` is the resolved `data:` URL (§2) or `null`. Null **or** a decode error → the L1
  placeholder, so a broken/absent icon is always covered.
- The img is **decorative** (`alt=""`): the tab button already carries the accessible name
  (`aria-label="browser tab <title>"`, `BrowserTabBar.tsx:84`).
- `object-contain` keeps non-square icons undistorted in the 16px slot; the rounded footprint is
  identical to the placeholder box, so swapping img↔placeholder never reflows the tab.
- `useEffect(… [favicon])` resets `failed` when the favicon changes, so a later navigation's icon
  retries cleanly.

### 3.2 Wire into `BrowserTabBar`

Replace the inline `.fav` glyph block (`BrowserTabBar.tsx:88-97`) with
`<BrowserTabFavicon favicon={tab.favicon} url={tab.url} />`. The `faviconPlaceholder(tab.url)`
call at `:63` moves into the child (only the placeholder branch needs it). Nothing else in the
tab capsule changes — title, close-x, active styling, and overflow scroll stay L1.

### 3.3 No renderer network churn

`favicon` is a `data:` URL, so the `<img>` makes **no network request** — the bytes are inline.
`onError` fires only on a corrupt / oversized decode, never a fetch miss, and the renderer never
reaches a favicon host (the point of resolving main-side; §1 CSP / §2).

## 4. Load bar — chrome-layer rendering (active tab)

### 4.1 Signal — reuse L2's active-tab `isLoading`

No new main signal. `BrowserPane` already holds `navState.isLoading` (L2; `BrowserPane.tsx:115`)
and passes it to `BrowserToolbar` (`:584`). The load bar is **active-tab** — you see one page at a
time, so L2's active-tab gating is exactly right. Background-tab loading does **not** drive the bar
(that's the per-tab spinner, VIM-67).

### 4.2 Placement — toolbar bottom edge, out of flow

The bar can't overlay `.page` (native view occludes DOM; L1 §5.3), so it renders as a 2px strip at
`BrowserToolbar`'s **bottom edge** (chrome layer, above the native region) — visually the handoff's
"top of page" position, mechanically the bottom of the toolbar. The toolbar root gains `relative`
(`BrowserToolbar.tsx:63`); the bar is `absolute inset-x-0 bottom-0 h-[2px]`, rendered only when
`isLoading`. Being absolute, toggling it is **zero re-layout** — the toolbar's 40px height and the
native-view bounds never change.

### 4.3 Appearance + motion

An indeterminate animated cyan segment — the handoff load bar relocated: a ~40%-wide cyan gradient
(`linear-gradient(90deg, transparent, <web accent>, transparent)`) sliding across a clipped 2px
track (the handoff `vfLoad` translateX keyframes, ~1.4s ease-in-out infinite), reusing
`BROWSER_IDENTITY.accent` (L1 §3.3 reserved it for L3). The keyframes are a new `tailwind.config.js`
animation applied via `motion-safe:`; `prefers-reduced-motion` (`motion-reduce:`) drops the slide
for a static low-opacity cyan strip, so "loading" stays legible without motion.

### 4.4 Ownership

`BrowserToolbar` owns the bar — it already receives `isLoading` for the reload↔stop toggle
(`BrowserToolbar.tsx:12,55-56`), so **no new prop** and no `BrowserPane` change for the load bar
(the favicon field still touches `BrowserPane.tsx`'s initial tabs literal, §2.5). Address bar, nav
buttons, open-external, and the grid are untouched.

```tsx
// inside the BrowserToolbar root (now `relative`); BROWSER_IDENTITY imported
{isLoading ? (
  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] overflow-hidden">
    <div
      className="h-full w-2/5 motion-safe:animate-browser-load-bar motion-reduce:w-full motion-reduce:opacity-60"
      style={{
        background: `linear-gradient(90deg, transparent, ${BROWSER_IDENTITY.accent}, transparent)`,
      }}
    />
  </div>
) : null}
```

```js
// tailwind.config.js — theme.extend
keyframes: {
  'browser-load-bar': {
    '0%': { transform: 'translateX(-110%)' },
    '100%': { transform: 'translateX(340%)' },
  },
},
animation: { 'browser-load-bar': 'browser-load-bar 1.4s ease-in-out infinite' },
```

## 5. Testing & acceptance

Tests follow repo conventions (L1 §6 / L2 §5): Vitest (`test()` not `it()`), explicit
`import { test, expect, vi } from 'vitest'` per file, co-located `*.test.tsx`, Testing Library, and
the `window.vimeflow.browserPane` bridge-mock from `BrowserPane.test.tsx`.

### 5.1 Component tests

- **`BrowserTabFavicon`** (new): renders `<img src={favicon}>` when `favicon` is set; renders the
  L1 placeholder glyph (`faviconPlaceholder(url)`) when `favicon` is `null`; **falls back to the
  placeholder on the img `onError`**; **resets** that error state when the `favicon` prop changes.
  The 16px slot matches the placeholder (no reflow).
- **`BrowserTabBar`**: passes each `tab.favicon` to `BrowserTabFavicon`; the existing tab behavior
  (activate / close / new, active styling, single-tab close-x hidden) stays green.
- **`BrowserToolbar`**: the load bar renders **only when `isLoading`** (absent otherwise) and is
  the `absolute inset-x-0 bottom-0` strip (present / removed — real animation + `motion-reduce` are
  §5.3 browser checks, not jsdom); back / forward / reload and the grid are unchanged from L2.
- **`BrowserPane` (container)**: a `tabs-changed` event carrying a tab with a `favicon` updates that
  tab's icon (a non-matching `sessionId` / `paneId` is ignored); the load bar reflects
  `navState.isLoading` via L2's existing nav-state wiring.

### 5.2 Main-process tests (`browser-pane.test.ts`)

Exercised through the **public surface** — the `page-favicon-updated` / `did-navigate` webContents
events and the emitted `tabs-changed` + `createPane` snapshot, not the private resolver (no
test-only exports), mirroring L2 §5.2. `session.fetch` is mocked.

- **Resolve + transport**: `page-favicon-updated` with an `http(s)` candidate + a mocked `image/png`
  `session.fetch` → the next `tabs-changed` carries that tab's `favicon` as a `data:image/png;base64,…`
  URL; a `data:` candidate passes through; a non-image `Content-Type`, a non-`ok` response, a
  **zero-byte `image/*` body**, an over-cap body (via `Content-Length` **and** via streamed bytes),
  and an empty `favicons` array each yield `favicon: null` (→ placeholder).
- **Candidate fallback**: first candidate non-`ok`, second `image/*` → the second's data: URL is
  committed (the loop advances, not stuck at index 0).
- **Fetch policy (SSRF)**: a **public** page's favicon pointing at a private / loopback host
  (`127.0.0.1`, RFC1918, `169.254.x`, `localhost`) → `favicon: null`; the **same** target from a
  `localhost` / private page is **allowed** (PNA model); a redirected response is rejected
  (`redirect: 'error'`); the fetch carries `credentials: 'omit'`.
- **Staleness (§2.3 generation guard)**: with a deferred in-flight favicon fetch, a `did-navigate`
  (or a newer `page-favicon-updated`) bumps `gen`; the old fetch's result is **discarded** —
  including when the post-navigation page declares the **same favicon URL** (the old bytes never
  overwrite the new tab).
- **Dedup**: a repeat `page-favicon-updated` with the same `favicons` while resolved / in-flight
  triggers **no** second `session.fetch`.
- **`did-navigate` reset ordering**: a full-document navigation emits a **single** `tabs-changed`
  with `favicon` already `null` (no stale-icon emit ahead of the clear); `did-navigate-in-page` does
  **not** reset the favicon.
- **Reconnect snapshot**: `createPane` on an existing record returns `tabs[]` whose entries carry
  their current `favicon` (rides `tabSnapshots`, §2.5).
- **Bridge-absent fallback** (`browserBridge.test.ts`): `createBrowserPane` without a bridge returns
  a tab with `favicon: null`.

### 5.3 Real-browser verification (NOT jsdom)

jsdom runs no CSS animation and decodes no images, so these are **manual** acceptance steps in a real
Electron build (`npm run electron:dev`), per L1 §6.3 / L2 §5.3:

- Real favicons render as images in the tab strip (github / a PR page / an issue page show their
  site icons, not the placeholder glyphs); a faviconless page shows the placeholder.
- The load bar animates (sliding cyan segment) while the active tab loads and disappears when idle,
  with no chrome jitter; under `prefers-reduced-motion` it shows the static strip (no slide).

### 5.4 Regression

L1 / L2 suites stay green: the tab capsule, toolbar grid, nav buttons, address bar, focus model, and
nav-state / reload↔stop behavior are unchanged — L3 only adds the favicon slot's img / placeholder
branch and the absolutely-positioned load bar.

### 5.5 Acceptance criteria (L3 done = all of)

1. Tabs show real per-tab favicons (incl. background tabs + after reconnect); absent / broken
   favicons fall back to the L1 placeholder. A **public** page cannot make main fetch a private /
   loopback favicon target (PNA guard), while a `localhost` / intranet page keeps its own favicon.
2. A favicon never persists stale across a navigation, and a pre-navigation fetch never overwrites
   the new document's icon (the §2.3 generation guard).
3. The active tab shows the chrome-layer load bar while loading with zero re-layout and no
   native-view jitter; `prefers-reduced-motion` is honored.
4. No new IPC channel and no CSP change; favicon rides `tabs-changed` as a capped `data:` URL.
5. `npm run lint`, `npm run type-check`, `npm run test` pass; the §5.3 manual checks are done.

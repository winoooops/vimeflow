# Built-in browser pane — design spec (Phase 1: stabilize the spike)

Status: codex-reviewed
Date: 2026-05-29
Owner: Vimeflow
Source: formalizes `docs/exploration/2026-05-28-builtin-browser/official-spec-and-plan.md`. The
product decision and architecture there are confirmed and already partially implemented by the
spike at commit `31f3493` plus in-progress working-tree changes.

## 1. Overview & scope

### Product decision

Ship a Vimeflow-owned browser pane built on Electron `WebContentsView`, with persistent
app-scoped partitions, first-class in-pane tabs, and a pane-scoped CDP-compatible automation
proxy. The browser is a durable workspace surface — GitHub, SaaS dashboards, documentation,
video/tutorial playback, music, and agent-observable web state — not a throwaway automation
target.

### Confirmed by the spike

The spike (`docs/exploration/2026-05-28-builtin-browser/`, commit `31f3493`) validated the
following. Non-DRM video playback and CDP control have captured artifacts under that directory's
`media/`; multi-tab behavior and cache / session reuse were validated interactively during the
spike and are re-confirmed by the automated tests in Section 5.

- Multi-tab behavior inside a docked browser pane (interactive; covered by tests in Section 5).
- Persistent cache / session reuse across reloads (interactive; partition persistence covered by
  tests in Section 5).
- Non-DRM video playback with audio — YouTube and equivalent
  (`media/browser-pane-video-audio.png`, `media/youtube-playback-state.txt`,
  `media/nondrm-video-audio-state.txt`).
- A pane-scoped CDP proxy that can list the target and run navigate/evaluate against the active
  tab (`media/cdp-targets.json`, `media/cdp-client-navigate-evaluate.txt`).

Passkey parity is explicitly deferred (see Non-goals).

### Phase-1 scope (this spec)

This spec covers **Phase 1: stabilize the spike** only. In scope:

- Lock the current `WebContentsView` host, persistent partitions with cache enabled (partition
  key scheme defined in Section 2), and the in-pane-tab model for popup / new-window flows.
- Keep the Shell / Browser picker in empty `SplitView` slots.
- Keep non-passkey auth fallback as accepted scope.
- Close the launch-acceptance gaps (Section 5) and pass `lint` / `type-check` / `test` plus a
  final Codex review against `main`.

### Phase-1 security contracts

Two security behaviors must hold in Phase 1 even though their richer UX is deferred:

- **Permission policy — deny by default.** Both the session's permission _request_ handler
  (`setPermissionRequestHandler`) and its synchronous permission _check_ handler
  (`setPermissionCheckHandler`) grant only `mediaKeySystem` (EME requests; no CDM ships in Phase 1,
  so playback that requires Widevine still fails), `storage-access`, and `top-level-storage-access`
  (so SaaS / OAuth flows that rely on the Storage Access API work). Camera, microphone,
  geolocation, and notifications are **denied** with no prompt, in both the request and check
  paths (camera / microphone arrive as Electron's `media` permission with media-type details, not
  separate strings). The user-facing permission prompts that would allow these are Phase 2. WebAuthn account
  selection picks the sole credential when exactly one exists and otherwise cancels (falling back to
  non-passkey sign-in) rather than guessing among several — Section 5, task 9. (The spike installs
  the request handler today; the matching check handler and the safe account-selection behavior are
  Phase-1 gaps — Section 5.)
- **CDP access boundary.** The pane-scoped CDP proxy is reachable on loopback only, requires a
  per-pane capability token plus an origin check on the WebSocket upgrade, lists only
  registered browser-pane targets (never the trusted Vimeflow shell `webContents`), and forwards
  only the allowlisted CDP domains (Section 4). Raw Electron remote debugging stays dev-only. The
  agent-plugin registration and pane-level grant UI that govern _which_ automation clients may
  request a token are Phase 4; the token / origin / allowlist enforcement itself is Phase 1.

Explicitly **out of scope** for Phase 1 (tracked for later phases in the source plan):

- Productized browser chrome — favicons, loading / stop / reload, back / forward,
  clear-site-data, and user-facing permission prompts (Phase 2).
- Restoring the **multi-tab list and prior active-tab selection within a pane** (a recreated pane
  re-seeds to a single tab), and crash-recovery UI (Phase 3). Note: a renderer **refresh** already
  preserves the tab list in Phase 1 (the native record survives and `createPane` returns its full
  `tabs[]` — Section 2). Reliable browser-pane restore across a **graceful** app restart is **not** a
  Phase-1 guarantee: the backend clears its session cache on shutdown (`state.rs:76` via
  `main.ts:344-363`), so the owning session — and the pane that references its `browserSessionId` —
  is not recreated, and the on-disk partition cookies / cache persist but sit unreferenced. Making
  sessions (and thus login) survive a graceful quit belongs to the terminal-session lifecycle, not
  this browser-pane milestone.
- The automation-API registration contract and pane-level grant UI (Phase 4).
- CDM / Widevine and signed / platform WebAuthn distribution decisions (Phase 5).

### Non-goals (all phases)

- No system Chrome profile import; no Google account sync; no Chrome extension support.
- No plugin runtime implementation.
- No Widevine claim on stock Electron unless a CDM-capable distribution is selected (Phase 5).
- No passkey requirement for launch; a non-passkey sign-in fallback is acceptable.

## 2. Architecture

### Process boundary

Browser content is hosted in the **Electron main process** as `WebContentsView` instances added to
the workspace `BrowserWindow`'s `contentView` (`electron/browser-pane.ts`). The React renderer
draws only Vimeflow browser **chrome** — address bar, tab strip, controls — and positions the
native view via IPC; it never hosts page content in a `<webview>` or iframe. This keeps page
processes isolated from the trusted shell renderer.

### Persistent partition

Each browser pane uses one persistent Electron session partition, keyed per workspace and session:

```
persist:vimeflow-browser:<workspaceId>:<sessionId>
```

The session is created with `session.fromPartition(partition, { cache: true })`
(`browser-pane.ts:653-654`). The `<workspaceId>` and `<sessionId>` segments are each run through
`sanitizePartitionSegment` (`[^a-zA-Z0-9._-] → '-'`, truncated to 96 chars, `:187-188`) so the
partition name stays Electron-safe.

**Isolation and the `<sessionId>` segment.** The `<sessionId>` segment is the pane's
`browserSessionId` (`BrowserPane.tsx:179`), resolved by `browserSessionIdForSession` to
`session.browserSessionId ?? <shell pane ptyId> ?? session.id` (`useSessionManager.ts:160-163`). That
value is `:`-free (so the composite key is unambiguous) and is **persisted** in the pane store (see
"Persistence & reconnect" below for what that does and does not recover across a restart).
`<workspaceId>` is the session's `projectId`. The key contains no `paneId`, so **all browser panes —
and all their tabs — within one session share a single partition**; partitions are never shared
across sessions, so there is no cross-session cookie / cache leakage. Isolation does not depend on
`sanitizePartitionSegment`: even if two `projectId`s sanitize or truncate to the same string, the
distinct `browserSessionId` segment keeps sessions apart. (If a future phase keys partitions on
`workspaceId` alone — to share a login across a workspace's sessions — it must hash or escape the raw
id rather than rely on `sanitizePartitionSegment`, whose lossy mapping could otherwise collide
distinct workspaces.)

All tabs across the session's browser panes share that one partition, so cookies, HTTP cache,
IndexedDB, localStorage, service-worker registrations, and site sessions persist and are reused
across tabs and across renderer reloads — scoped to Vimeflow, never the system Chrome profile. A
per-partition policy installer (`installPartitionPolicy`) attaches the permission and
`select-webauthn-account` handlers exactly once per partition (Section 1 security contracts).

### Persistence & reconnect (Phase 1)

Browser panes are persisted client-side; what survives depends on whether the main process stayed
alive:

- **Pane store.** The renderer writes a `vimeflow:browser-panes:v1` localStorage record
  (`useSessionManager.ts:175`) holding, per browser pane, its stable `browserSessionId`, `paneId`,
  `browserUrl`, and `active` flag. On mount, `restoreStoredBrowserPanes` re-creates those panes for
  the sessions the backend restored.
- **Renderer refresh (full recovery).** The main process is still alive, so `createPane` takes its
  reconnect path (`browser-pane.ts:638-648`) and returns the existing native record — its full
  `tabs` snapshot and active tab included — so cache, login, and the multi-tab list all survive a
  refresh intact.
- **On-disk partition (always durable).** The `persist:` partition's cookies / cache / storage are
  written to `userData` and survive any process exit; they are reused only when a pane is later
  created with the same `browserSessionId` partition key.
- **Graceful restart (login NOT restored in Phase 1).** On a normal quit the sidecar is shut down
  (`main.ts:344-363`) and the backend clears its session cache (`state.rs:76`), so the owning
  terminal session is not recreated on relaunch — `restoreStoredBrowserPanes` has no session to
  attach to, no pane re-references the partition, and the (still on-disk) cookies sit unused, so the
  user re-authenticates. The stable `browserSessionId` would make restore work _if_ the session
  returned (e.g. after a crash that skips the shutdown hook and leaves the cache), but that is
  best-effort, not a Phase-1 guarantee. Persisting sessions across a graceful quit is a follow-up in
  the terminal-session lifecycle.
- **Not restored in Phase 1.** Regardless of path, the multi-tab list and prior active-tab selection
  _within_ a pane are not restored across a full restart (a recreated pane re-seeds to one tab) —
  that is Phase 3.

### Tab model

A pane owns an ordered set of native tabs. The renderer-facing shape is:

```ts
interface BrowserPaneTab {
  id: string // stable per-tab id, e.g. "tab-0"
  url: string
  title: string | null
  active: boolean
}
```

In main, each pane is a `BrowserPaneRecord` holding `tabs: Map<string, { view: WebContentsView }>`
(keyed by tab id), `activeTabId`, a monotonic `nextTabIndex` for id allocation, and the pane's
`lastBounds` / `visible` state. Exactly one tab is active at a time.

### Active tab = visible view = CDP target

The active tab is the only `WebContentsView` given real (visible) bounds; inactive tabs keep their
`webContents` alive but are positioned at zero bounds (`{ x: 0, y: 0, width: 0, height: 0 }`). The
active tab is also the single CDP target for the pane — switching the active tab re-targets the CDP
proxy and tears down any prior CDP attachment (Section 4).

### Popup / new-window → in-pane tab

`webContents.setWindowOpenHandler` always returns `{ action: 'deny' }`, so Electron never spawns a
detached `BrowserWindow`. For `window.open` / new-window requests whose URL passes
`isAllowedPopupUrl` (`about:blank` or an http/https URL — other schemes are denied outright), the
handler instead creates a first-class in-pane tab via `createOwnedTab` on the same partition,
activating it unless the disposition is `background-tab` (`browser-pane.ts:797-808`).

**Phase-1 popup scope, precisely:** the new tab is opened by navigating to the requested URL
(`loadURL`), so it carries cookies and session state from the shared partition but does **not**
preserve the JS `window.opener` reference, the `postMessage` channel back to the originating page,
the referrer, a `postBody`, or `frameName`. This supports the common redirect-based OAuth flow —
the popup/redirect navigates to a callback URL that completes via the shared cookie/session, which
is what the spike validated. OAuth or SaaS flows that depend on a `window.opener.postMessage`
hand-off, or on POSTing a body to the popped window, are **not** guaranteed in Phase 1 and rely on
the accepted non-passkey / full-redirect fallback. Restoring opener / postMessage semantics, if a
target site needs them, is tracked for a later phase.

## 3. Operations & IPC contract

### Required operations

The pane exposes eight spec-required operations, each an `invoke` channel handled in main
(`electron/browser-pane.ts`, registrations at `:564-596`) and surfaced to the renderer through the
`BrowserPaneBridge` (`src/features/browser/types.ts:89-108`, implemented in `browserBridge.ts`):

| Operation     | Channel (`browser-pane-channels.ts`) | Request type                 | Result                                                                                                                  |
| ------------- | ------------------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `createPane`  | `browser-pane:create`                | `BrowserPaneCreateRequest`   | `BrowserPaneCreateResult` `{url,title,partition,tabs[]}`                                                                |
| `setBounds`   | `browser-pane:set-bounds`            | `BrowserPaneBoundsRequest`   | `void` — positions only the active tab; inactive tabs forced to zero bounds                                             |
| `navigate`    | `browser-pane:navigate`              | `BrowserPaneNavigateRequest` | `void` — navigates the active tab                                                                                       |
| `newTab`      | `browser-pane:new-tab`               | `BrowserPaneNewTabRequest`   | `void` — creates a first-class tab (optional `url`)                                                                     |
| `activateTab` | `browser-pane:activate-tab`          | `BrowserPaneTabRequest`      | `void` — switches active tab; re-targets CDP; emits tabs + url                                                          |
| `closeTab`    | `browser-pane:close-tab`             | `BrowserPaneTabRequest`      | `void` — refuses to close the final tab; if the active tab closed, activates the first remaining tab in insertion order |
| `destroyPane` | `browser-pane:destroy`               | `BrowserPaneDestroyRequest`  | `void` — tears down all tabs and clears the record                                                                      |
| `getCdpInfo`  | `browser-pane:cdp-info`              | `BrowserPaneDestroyRequest`  | `BrowserCdpInfo` `{url,token,origin,targetId}`                                                                          |

Beyond those eight, a `focusPane` invoke (`browser-pane:focus`, `BrowserPaneDestroyRequest → void`)
brings a pane's active tab forward — **nine invoke channels in total** — and three main→renderer
events complete the surface:

- `browser-pane:focused` → `BrowserPaneFocusedEvent` (`onFocus`)
- `browser-pane:url-changed` → `BrowserPaneUrlChangedEvent` (`onUrlChange`; carries the active
  tab's url/title plus the full `tabs[]` snapshot)
- `browser-pane:tabs-changed` → `BrowserPaneTabsChangedEvent` (`onTabsChange`; emitted on tab
  create / activate / close so the React chrome re-renders the tab strip). Each tab snapshot's `url` is non-empty — the requested target URL until navigation commits (task 7)

### IPC layering (touch-points per channel)

Because the browser pane runs in **Electron main** (not the Rust sidecar), a new pane IPC touches
five files — distinct from the Rust backend's four-file path:

1. `electron/browser-pane-channels.ts` — the channel-name constant.
2. `electron/browser-pane.ts` — `ipcMain.handle(channel, …)` registration plus the handler method.
3. `electron/preload.ts` — `contextBridge` exposure on `window` (an invoke wrapper, or an event
   subscription for the three events).
4. `src/features/browser/browserBridge.ts` — the typed renderer-side wrapper the React components
   call (shape pinned by `BrowserPaneBridge` in `types.ts`).
5. `src/features/browser/types.ts` — the shared request / result / event types.

Missing any one leaves a channel that unit tests may still pass on but that silently fails at
runtime; the launch-acceptance tests (Section 5) exercise the full path.

### Current implementation state

All eight operations are implemented. `createPane`, `setBounds`, `navigate`, `destroyPane`, and
`getCdpInfo` shipped in the spike (`31f3493`); `newTab`, `activateTab`, `closeTab`, and the
`tabs-changed` event arrived with the in-progress multi-tab work. The remaining Phase-1 work
(Section 5) is correctness / lint / test stabilization and added test coverage — not new
operations.

## 4. Auth, cache & automation boundary

### Auth & cache policy

- Cache is enabled and persistent by default (`session.fromPartition(…, { cache: true })`,
  Section 2).
- Cookies and site storage are scoped to Vimeflow partitions, never the system Chrome profile, so
  a GitHub / Google / SaaS login performed once in a pane is reusable on later visits within the
  same workspace + session.
- OAuth popups become in-pane tabs on the shared partition (Section 2), within the Phase-1 popup
  scope.
- Passkeys are deferred; `select-webauthn-account` selects the sole credential when there is exactly
  one and otherwise cancels (non-passkey fallback) rather than guessing among several (Section 1;
  Section 5, task 9).

### Automation boundary (CDP-compatible proxy)

The pane-scoped proxy is a minimal CDP-compatible endpoint that exposes only registered browser
panes and forwards a restricted command set to each pane's **active tab**. It never exposes the
trusted Vimeflow shell `webContents`.

- **Transport & binding.** An HTTP + WebSocket server is created lazily and bound to loopback on an
  ephemeral port (`createServer(…).listen(0, '127.0.0.1')`, `browser-pane.ts:1320`).
  `getCdpInfo.url` is the base URL `http://127.0.0.1:<port>` (`:1178`); the base path itself is not
  served — the token-gated HTTP listing endpoints are `/json/version` (`:1356`) and `/json/list`
  (`:1368`). The per-pane target socket is
  `ws://127.0.0.1:<port>/devtools/page/<encoded-targetId>?token=<cdpToken>` (`:1335`), where
  `<targetId>` is the pane's composite id described in the next bullet.
- **Per-pane capability token.** Each pane gets a `randomBytes(24).toString('base64url')` token at
  creation (`:676`). `getCdpInfo` returns `{ url, token, origin, targetId }`, where `origin` is the
  fixed `vimeflow://agent-plugin/local` (`BROWSER_CDP_ORIGIN`, `:160`) and `targetId` is the pane's
  composite id `record.id` = `<sessionId>:<paneId>` (`:1177`) — the exact key the upgrade lookup
  requires, so automation clients must use it verbatim (not the bare `paneId`). The composite is
  collision-free because `<sessionId>` is a `:`-free UUID (Section 2), and it is
  `encodeURIComponent`-encoded on the socket path (`:1335`).
- **Upgrade gating.** The WebSocket upgrade is accepted only when the token matches (a `?token=`
  query param or an `Authorization: Bearer <token>` header, `:1486`) and the request origin is
  absent or equals `BROWSER_CDP_ORIGIN` (`:1480`). The HTTP listing requires the same token.
  `BROWSER_CDP_ORIGIN` (`vimeflow://agent-plugin/local`) is a sentinel identifier for the trusted
  agent-plugin — a non-browser CDP client that omits the `Origin` header (the normal case) or sends
  this exact string; it is not a wire-valid browser origin (an `Origin` header carries no path), so
  browser-page clients are not the intended consumer. The 24-byte per-pane token is the primary
  gate; the origin check is defense-in-depth.
- **Command allowlist.** Forwarded methods are restricted to a fixed domain allowlist
  (`ALLOWED_CDP_DOMAINS`, `:164-173`): `Accessibility`, `DOM`, `Emulation`, `Input`, `Log`,
  `Network`, `Page`, `Runtime`. The only method accepted outside those domains is the
  locally-answered `Browser.getVersion` (`:1633`); everything else is rejected. `Page.navigate`
  arguments are URL-validated before forwarding (`:1648`).
- **Active-tab targeting.** Commands and the CDP attachment are routed to the pane's active tab
  (`activeWebContents()`); switching the active tab closes any prior attachment and re-targets the
  new active tab (Section 2). In-flight commands on a closed attachment are **abandoned** — the
  client observes the socket close and must reconnect and re-issue against the new target; Phase 1
  does not queue, drain, or replay commands across a tab switch.
- **Dev-only raw debugging.** Electron's raw remote-debugging port stays dev-only and is never the
  production automation path.

## 5. Phase-1 stabilization plan, testing & launch acceptance

### Stabilization tasks

The spike is feature-complete (all nine invoke channels plus three events implemented), but the
in-progress working tree is not yet clean: `npm run type-check` and `npm run lint` currently fail
(tasks 1–2), and `BrowserPane.test.tsx`'s bridge mock may not yet expose `newBrowserPaneTab`, so
confirm the focused-test baseline (red vs green) before starting. Phase 1 closes these gaps, in
order:

1. **Fix the type-check failure.** `isTabRequest` (`browser-pane.ts:304`) reads `value.tabId` after
   a guard that has narrowed `value` to a type without `tabId`, so `npm run type-check` fails
   (TS2339). Re-narrow from a record check, e.g.
   `isRecord(value) && isString(value.sessionId) && isString(value.paneId) && isString(value.tabId)`.
2. **Clear the 9 ESLint errors.** `prefer-nullish-coalescing` (`browser-pane.ts:643,645,1375`),
   `padding-line-between-statements` (`browser-pane.ts:858`, `BrowserPane.tsx:94,326`), the cspell
   unknown word `webauthn` (`browser-pane.ts:1194` — add to the project dictionary / inline
   ignore), and `no-unnecessary-condition` (`BrowserPane.tsx:328,473`). Use `npm run lint:fix`
   where safe; hand-edit the cspell and `no-unnecessary-condition` cases.
3. **Add the matching `setPermissionCheckHandler` and test the allow/deny list.** Mirror the request
   handler's allowlist (`mediaKeySystem`, `storage-access`, `top-level-storage-access` → allow;
   everything else → deny) inside `installPartitionPolicy`, so the deny-by-default guarantee
   (Section 1) holds on both the request and check paths. Add a test (`browser-pane.test.ts`)
   asserting that both handlers allow exactly `mediaKeySystem`, `storage-access`, and
   `top-level-storage-access`, and deny the real Electron permission strings — `media` (camera /
   microphone), `geolocation`, and `notifications` — so a wrong permission name or an accidental
   allow fails the gate.
4. **Add React tab-strip tests** (`BrowserPane.test.tsx`). Cover: clicking a tab calls
   `activateTab`; the close `×` calls `closeTab` and stops event propagation; `+` calls `newTab`;
   and an `onTabsChange` event re-renders the tab strip and address bar. (Currently only the 4
   pre-existing tests exist; the tab UI is untested.)
5. **Add a CDP active-tab test** (`browser-pane.test.ts`). Assert that a forwarded `Page.navigate` /
   `Runtime.evaluate` reaches the active tab's debugger; that activating another tab **closes the
   prior CDP attachment** and a fresh connection to the same pane target attaches to the new active
   tab's debugger; and that a command sent on the now-closed prior attachment is **not** forwarded to
   the old tab (Section 4's abandon-on-switch semantics). This closes the gap where launch-acceptance
   bullet 5 is otherwise evidenced only by the manual spike artifact
   `media/cdp-client-navigate-evaluate.txt`.
6. **Add a preload / channel-wiring test.** Assert that `electron/preload.ts` exposes all nine
   browser-pane invoke channels and the three event subscriptions used by `browserBridge.ts`, so a
   dropped `contextBridge` entry or a channel-name typo for the new `newTab` / `activateTab` /
   `closeTab` / `onTabsChange` path is caught (the five-layer IPC path of Section 3 can otherwise
   pass bridge + component tests yet fail at runtime).
7. **Make every emitted / persisted tab URL non-empty.** `tabSnapshots` reads `webContents.getURL()`
   (`browser-pane.ts:755-762`), which is `''` for a just-created tab before its `loadURL` commits, so
   both the `tabs[]` snapshots **and** the top-level `BrowserPaneUrlChangedEvent.url` emitted at
   creation can push `''` into the address bar and the persisted `browserUrl`, poisoning restart
   restore. Carry the requested target URL on the tab and use it as the fallback wherever an
   active-tab URL is emitted (the `tabs[]` snapshots and `url-changed.url`) until navigation commits,
   and have the pane store ignore empty URLs.
8. **Add a `createPane` reconnect test** (`browser-pane.test.ts`). Assert that calling `createPane`
   for an already-registered pane returns the **existing** native record — its full `tabs[]` snapshot
   and active tab — without building a new `WebContentsView`, so the renderer-refresh recovery path
   (Section 2) is locked by a test, matching launch-acceptance #3's "reconnect (unit-tested)" claim.
9. **Make WebAuthn account selection safe.** `select-webauthn-account` currently auto-selects the
   first credential unconditionally (`browser-pane.ts:1194-1196`), silently picking an arbitrary
   account when several discoverable credentials exist. With passkeys deferred, select the credential
   only when `details.accounts.length === 1`; otherwise `callback(null)` to cancel and fall back to
   the accepted non-passkey flow. Add a test for both the single- and multi-credential cases.

Tasks 1–3, 7, and 9 are mechanical / verbatim code changes (well suited to an unattended coder);
tasks 4–6 and 8 are test-design work.

### Testing approach

- **Electron main** (`electron/browser-pane.test.ts`): partition + cache + `addChildView` +
  `loadURL` on create; bounds routing across tabs; popup→tab; CDP token / origin gating; the new CDP
  active-tab forwarding (task 5); the `createPane` reconnect path (task 8); the permission
  request/check allow-deny list (task 3); and safe WebAuthn account selection (task 9).
- **Renderer bridge** (`src/features/browser/browserBridge.test.ts`): each `BrowserPaneBridge`
  method delegates to the correct channel with the correct payload (`tabs[]` in the create result;
  `newTab` / `activateTab` / `closeTab` delegation).
- **Component** (`src/features/browser/components/BrowserPane.test.tsx`): the tab-strip + address-bar
  behavior (task 4).
- **Preload / channel wiring** (task 6): `electron/preload.ts` exposes every browser-pane channel the
  bridge uses — a missing `contextBridge` exposure or channel-name mismatch for `newTab` /
  `activateTab` / `closeTab` / `onTabsChange` would pass the bridge and component tests yet fail at
  runtime.
- **Verification gate:** `npm run lint`, `npm run type-check`, and `npm run test` must all pass
  before the working tree is committed.

### Launch acceptance

| #   | Criterion                                                                                        | How it is evidenced                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `+ add pane → Browser` creates a docked browser pane                                             | `EmptySlot` picker wiring + `createPane` test                                                                                                                                                                                                                           |
| 2   | New-window opens as an in-pane tab; redirect-based OAuth completes in-pane                       | popup→tab test (`browser-pane.test.ts`) + manual smoke of a redirect-based OAuth flow (opener/postMessage/postBody popups are out of scope — Section 2)                                                                                                                 |
| 3   | Browser cache + login survive a renderer refresh; the on-disk partition persists across any exit | `createPane` reconnect (unit-tested) + persistent on-disk partition. Graceful-restart login restore is **out of Phase-1 scope** — the backend clears its session cache on shutdown (`state.rs:76`); the manual smoke documents the current restart behavior (Section 2) |
| 4   | YouTube / equivalent non-DRM video plays with audio                                              | spike artifacts (`media/browser-pane-video-audio.png`, `youtube-playback-state.txt`) + manual smoke                                                                                                                                                                     |
| 5   | CDP proxy lists the pane target and runs navigate/evaluate on the active tab                     | task-5 automated test + spike artifacts (`media/cdp-targets.json`, `cdp-client-navigate-evaluate.txt`)                                                                                                                                                                  |
| 6   | `npm run lint`, `npm run type-check`, `npm run test` pass                                        | local + CI run after tasks 1–9                                                                                                                                                                                                                                          |
| 7   | Final Codex review against `main` returns zero structural findings                               | Phase-C local codex review + PR-time review                                                                                                                                                                                                                             |

Bullets 2 and 4 require a human / Claude run of the Electron app (bullet 4 has spike artifacts and
bullet 2's popup→tab path is also unit-tested; the manual smoke targets a redirect-based OAuth flow,
not an opener/postMessage popup). Bullet 3 is Phase-1 only for the **renderer-refresh** leg (the
`createPane` reconnect path, unit-tested) and for the on-disk persistence of the partition itself.
Login does **not** automatically survive a **graceful** app restart in Phase 1: the backend clears
its session cache on shutdown (`state.rs:76` via `main.ts:344-363`), so the owning session is not
recreated and no browser pane re-references the partition — its cookies / cache remain on disk but
unreferenced. The restart smoke documents this current behavior; making sessions survive a graceful
quit is a follow-up in the terminal-session lifecycle. Tab-list restoration _within_ a pane is
Phase 3.

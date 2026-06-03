# Browser pane — chrome redesign (L1) — implementation plan

Implements `docs/superpowers/specs/2026-06-03-browser-pane-chrome-redesign-design.md`.
Scope = L1 (Arc chrome restyle): frontend + two small backend touches
(`open-external` IPC, `focus-address` event). Nav controls render disabled, no load
bar, favicons are placeholders. Tasks are ordered by dependency (leaf → integration).

## Conventions

- No semicolons, single quotes, trailing commas (es5); arrow components; explicit
  return types on exports; `test()` not `it()`; co-located `*.test.tsx`/`*.test.ts`;
  every new test file imports **only the Vitest helpers it uses** (`test`, `expect`,
  and `vi`/`beforeEach`/… only where actually used — `noUnusedLocals` rejects unused
  imports).
- Inline comments: one short line max, no task/PR references (CLAUDE.md).
- After each task: `npm run lint` + `npm run type-check` + the touched test file green.

## Task 1 — Chrome surface tokens

- `tailwind.config.js`: add `browser-bar` `#121226` and `browser-tab-active`
  `#23233b` (the only handoff surfaces with no existing token; spec §2.5).
- Keep `docs/design/tokens.css` / `tokens.ts` in sync (project convention).
- **Verify:** the same hex appears in `tailwind.config.js`, `tokens.css`, and
  `tokens.ts` (a grep/sync check — Tailwind does **not** fail the build on unknown
  utility names, so build success alone proves nothing). Visual confirmation that the
  tokens render is folded into Task 10's screenshot checklist.

## Task 2 — `PaneIdentity` type + `BROWSER_IDENTITY` (spec §3.1)

- `src/agents/registry.ts`: extract `export interface PaneIdentity { name; short;
  glyph; accent; accentDim; accentSoft; onAccent }`; make
  `export interface AgentDef extends PaneIdentity { id; model }`. No `AGENTS` value
  changes; `AgentId` / key-set unchanged.
- `src/features/browser/browserIdentity.ts`: `export const BROWSER_IDENTITY:
  PaneIdentity` with cyan accent (`#4fc8d6`), `accentDim 0.16`, `accentSoft 0.30`,
  `onAccent #06232a`, `glyph '⊕'`.
- **Tests:** `browserIdentity.test.ts` asserts the cyan accent + `PaneIdentity`
  shape; `registry.test.ts` is **unchanged** and still passes (key-set assertion
  intact — guards the decoupling).

## Task 3 — `faviconPlaceholder` helper (spec §5.2)

- `src/features/browser/faviconPlaceholder.ts`: pure `(url) => { glyph, tone }` —
  PR URL → `merge`/mauve, issue URL → `adjust`/coral, else → `public`/cyan.
- **Tests:** the three branches + a malformed URL (falls back to default).

## Task 4 — `open-external` IPC (spec §5.4)

- `electron/browser-pane-channels.ts`: `BROWSER_PANE_OPEN_EXTERNAL`.
- `electron/browser-pane.ts`: `ipcMain.handle` → **reject** a malformed
  `{ sessionId, paneId }` payload (matching the existing invoke-handler contract — fail
  fast, don't swallow), resolve the active tab's `webContents.getURL()` (committed
  URL) → open via `shell.openExternal` only if scheme is `http(s)`; otherwise **no-op**
  (a valid payload whose loaded URL just isn't openable, e.g. `about:blank`). Resolve
  URL main-side (don't trust the renderer). Add the paired **`ipcMain.removeHandler`**
  in `dispose()` (the existing install/dispose contract for every browser-pane invoke
  channel).
- `electron/preload.ts`: expose `browserPane.openExternal(ref)`.
- `src/features/browser/types.ts`: `BrowserPaneBridge.openExternal` + request type.
- `src/features/browser/browserBridge.ts`: `openExternalBrowserPane` (no-op when the
  bridge is absent).
- **Tests:** `browser-pane.test.ts` — http(s) opens (mock `shell.openExternal`),
  `about:blank`/non-http(s) **no-op**, **malformed payload rejects**, pending-nav opens
  the committed URL, and `dispose()` removes the handler; `preload.test.ts` —
  `openExternal` exposed; **`browserBridge.test.ts` + the typed bridge mock** updated
  with `openExternal` (required, or `type-check` fails).

## Task 5 — `focus-address` event for page-focused `⌘L` (spec §4.4)

- `electron/browser-pane-channels.ts`: `BROWSER_PANE_FOCUS_ADDRESS`.
- `electron/browser-pane.ts`: in `installAppShortcutForwarding`'s
  `before-input-event`, match `KeyL` + the platform modifier (mac `meta && !ctrl`,
  else `ctrl && !meta`), no `alt`/`shift`, ignore auto-repeat → `preventDefault` +
  `BrowserWindow.fromId(record.windowId).webContents.send(BROWSER_PANE_FOCUS_ADDRESS,
  { sessionId, paneId })` + focus the app window. Extract the match as a **pure,
  platform-injected predicate** `isFocusAddressShortcut(input, platform)` so it is
  unit-testable without a real OS.
- `electron/preload.ts` · `types.ts` · `browserBridge.ts`: `onFocusAddress(cb)`,
  mirroring `onFocus`.
- **Tests:** unit `isFocusAddressShortcut` with **injected platform** — `Cmd+L` on
  darwin and `Ctrl+L` on non-darwin match; `Ctrl+L` on darwin, `Cmd+L` on non-darwin,
  any `alt`/`shift`, auto-repeat, and non-`keyDown` types do **not**;
  `browser-pane.test.ts` — a matching event emits `BROWSER_PANE_FOCUS_ADDRESS` for the
  right `{ sessionId, paneId }` **and** calls `preventDefault` + focuses the app window
  (`win.webContents.focus`); a non-match does neither; `preload.test.ts` +
  **`browserBridge.test.ts` (+ typed mock)** — `onFocusAddress` exposed (required, or
  `type-check` fails).

## Task 6 — `BrowserAddressBar` (presentational, spec §4)

- `src/features/browser/components/BrowserAddressBar.tsx`: prop-driven by
  `isEditing`. Display mode = `<button type="button">` rendering `URL`-parsed
  `scheme`/`host`/`path` segments + scheme-derived lock (`lock` https /`lock_open`
  else) + platform `⌘L` kbd hint, platform-resolved `aria-label`. Edit mode = the
  `<input>` (focused + selected via `useEffect` on `isEditing`). Callbacks:
  `onBeginEdit()`, `onDraftChange(v)`, `onSubmit(url)`, `onCancel()`.
- **Tests:** display segments + lock per scheme; **a malformed URL renders raw (host
  color) without crashing** (spec §4.2); the display button's `aria-label` is
  platform-resolved; entering edit focuses + selects the input; click/Enter/Space →
  `onBeginEdit`; `Enter` → `onSubmit(draft)`; `Escape`/blur → `onCancel`; icons
  `aria-hidden`.

## Task 7 — `BrowserTabBar` (spec §2.3)

- `src/features/browser/components/BrowserTabBar.tsx`: WEB chip (`public`, cyan);
  capsule tabs `[favicon][title][close-x]` (active = `browser-tab-active` neutral
  capsule, **not** cyan); favicon from `faviconPlaceholder`; close-x revealed on
  hover/`tab--active`/`focus-within`/`focus-visible`, hidden when one tab; new-tab
  `add`; divider; close-pane `close` **only when `onClose` provided**.
  Tabs container `overflow-x:auto` (reachable scroll).
- **Tests:** active = neutral capsule (not `accent`); favicon glyph matches helper;
  close-x absent at one tab; close-pane absent when `onClose` undefined; callbacks;
  **a11y** — close-x is keyboard-reachable (revealed on `focus-within`/`focus-visible`,
  not hover-only) and every decorative icon span has `aria-hidden="true"`.

## Task 8 — `BrowserToolbar` (spec §2.4)

- `src/features/browser/components/BrowserToolbar.tsx`: 3-col grid
  `minmax(min-content,1fr) auto minmax(min-content,1fr)`, `overflow:hidden`;
  back/forward/reload as **native-`disabled`** `.navbtn`s (no `onClick`); centered
  address pill (`width:min(520px,100%)`, `min-width:0`) hosting `BrowserAddressBar`;
  open-external `open_in_new` (enabled when an active tab exists).
- **Tests:** nav buttons `disabled`, no handler fired; open-external calls the bridge
  with the pane ref; grid + `overflow:hidden` present (structure); decorative icon
  spans have `aria-hidden="true"`.

## Task 9 — `BrowserPane` container integration (spec §3.2, §4, §2.2)

- Compose `BrowserTabBar` + `BrowserToolbar` over the existing `.page`/`contentRef`.
- Focus: **constant 2px border** on the outer container, color-only toggle
  (`BROWSER_IDENTITY.accent` focused / `rgba(74,68,79,0.22)` not) + focused glow
  `box-shadow: 0 0 0 6px <accentDim>, 0 8px 32px rgba(0,0,0,.35)`; raise the focused
  pane's stacking. Replaces `ring-1 ring-primary/35`. Native bounds unchanged
  (border constant).
- Promote `isAddressEditingRef` → `isEditing` state; preserve the `draft`/
  `committedUrl` machine verbatim (drop only the Go button + its tab-to-Go branch);
  pass controlled props/callbacks to `BrowserAddressBar`.
- `⌘L`: a chrome-root (`[data-browser-pane-id]`) keydown handler — matching via the
  renderer's `shortcutConfig` platform modifier (mac `meta`, else `ctrl`) — plus an
  `onFocusAddress` subscription (filter by `{ sessionId, paneId }`), both
  `setIsEditing(true)`; neither fires for other panes/editor/dialogs.
- Wire open-external to `openExternalBrowserPane`.
- **Tests:** update `BrowserPane.test.tsx` — focus border toggles on the container;
  `onSubmit` → `normalizeUrl` + `navigate`; `⌘L` routing (chrome-focused keydown
  honoring the platform modifier — darwin `Cmd+L`, non-darwin `Ctrl+L` — and a matching
  `focus-address` both set `isEditing`; outside-chrome `⌘L`, and `focus-address` with a
  **wrong `sessionId`** or **wrong `paneId`**, do **not** — proving the filter, so one
  page-focused shortcut can't edit every pane); ported draft/committedUrl edge
  cases (idle-sync pause, blur-cancel, redirect); **drop** Tab-to-Go/idle-Go
  assertions, add Enter-submit; and tab activate/close/new + open-external clicks
  call the bridge with `{ sessionId: browserSessionId, paneId }` (guards the derived
  session id — child callback tests alone wouldn't catch a wrong id that no-ops the IPC).

## Task 10 — Manual real-browser verification (spec §6.3)

- Launch the Electron app with `npm run electron:dev` (`npm run dev` is renderer-only
  Vite — no native `WebContentsView`), open a browser pane, and switch the session to
  the **quad** layout so each pane is ≈¼ width (~300px on a 1280px window).
- **Visual chrome (spec §6.6.1):** WEB chip, neutral active-tab capsule, address pill
  (lock + colored segments + ⌘L), and the cyan **focused** border+glow vs the faint
  **unfocused** border all match `Browser Pane.html` — screenshot focused + unfocused.
- **Icons:** every Material Symbol (`public`, `merge`, `adjust`, `close`, `add`,
  `arrow_back`, `arrow_forward`, `refresh`, `lock`, `lock_open`, `open_in_new`)
  renders as a glyph, not raw ligature text — screenshot as evidence.
- **Narrow layout:** at the quad width the toolbar shows no horizontal overflow and no
  wrap; the address truncates with an ellipsis — screenshot as evidence.
- `npm run lint`, `npm run type-check`, and `npx vitest run` (finite — bare
  `npm run test` is watch mode) all green.

## Out of scope (L2 / L3)

Real back/forward/reload + history enablement and the reload↔stop toggle (L2); real
favicons + the live load bar (L3). L1 only renders their placeholders/disabled states
forward-compatibly.

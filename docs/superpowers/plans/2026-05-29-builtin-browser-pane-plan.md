# Built-in browser pane — Phase 1 implementation plan

Status: codex-reviewed
Date: 2026-05-29
Spec: [`docs/superpowers/specs/2026-05-29-builtin-browser-pane-design.md`](../specs/2026-05-29-builtin-browser-pane-design.md)

This plan executes the Phase-1 stabilization tasks from Section 5 of the spec. The spike is
feature-complete; this is correctness / lint / test stabilization over the in-progress working
tree, not new feature work. Read the spec for the rationale behind each item — this plan only
sequences the work and pins its verification.

## Execution model

- **Coder:** `kimi -w <worktree> --afk -p '<task>'` implements one step at a time, headless.
- **Reviewer:** `codex review --base main` (and per-step `codex exec` on the staged diff) gates
  each step; proxy cleared, stdin `< /dev/null`, no `--model`.
- **Verifier:** Claude runs the step's focused test plus `npm run lint` / `npm run type-check`
  before moving on; the working tree is committed only when all three pass.
- **Isolation:** steps run sequentially on the one worktree because they touch overlapping files
  (`electron/browser-pane.ts`, `src/features/browser/components/BrowserPane.tsx`).

## Baseline check (before starting)

The in-progress tree currently **fails** `npm run type-check` and `npm run lint`. Confirm the
focused-test baseline first — `BrowserPane.test.tsx`'s bridge mock may not yet expose
`newBrowserPaneTab`:

```bash
npm run type-check; npm run lint
npx vitest run electron/browser-pane.test.ts src/features/browser/browserBridge.test.ts \
  src/features/browser/components/BrowserPane.test.tsx
```

## Ordered steps

Code changes first (unblock compilation and lock behavior), then the test additions.

### Step 1 — Type-check fix (spec task 1) · mechanical

- `electron/browser-pane.ts:304` — `isTabRequest` reads `value.tabId` after a guard that narrowed
  off `tabId`. Re-narrow from a record check:
  `isRecord(value) && isString(value.sessionId) && isString(value.paneId) && isString(value.tabId)`.
- **Verify:** `npm run type-check` passes.

### Step 2 — Lint fixes (spec task 2) · mechanical

- `prefer-nullish-coalescing` (`browser-pane.ts:643,645,1375`), `padding-line-between-statements`
  (`browser-pane.ts:858`, `BrowserPane.tsx:94,326`), cspell `webauthn` (`browser-pane.ts:1194` →
  dictionary / inline ignore), `no-unnecessary-condition` (`BrowserPane.tsx:328,473`).
- Run `npm run lint:fix` for the auto-fixable rules; hand-edit cspell + `no-unnecessary-condition`.
- **Verify:** `npm run lint` passes.

### Step 3 — `setPermissionCheckHandler` + permission test (spec task 3) · code + test

- In `installPartitionPolicy`, add a `setPermissionCheckHandler` mirroring the request handler's
  allowlist (`mediaKeySystem`, `storage-access`, `top-level-storage-access` → allow; else deny).
- Test (`browser-pane.test.ts`): both handlers allow exactly those three and deny the real Electron
  strings `media` (camera / microphone), `geolocation`, `notifications`.
- **Verify:** `npx vitest run electron/browser-pane.test.ts` + lint + type-check.

### Step 4 — Safe WebAuthn account selection (spec task 9) · code + test

- `browser-pane.ts:1194-1196` — replace unconditional first-credential auto-select: select only
  when `details.accounts.length === 1`; otherwise `callback(null)` (cancel → non-passkey fallback).
- Test both the single- and multi-credential cases.
- **Verify:** `npx vitest run electron/browser-pane.test.ts` + lint + type-check.

### Step 5 — Non-empty tab URL everywhere (spec task 7) · code

- Carry the requested target URL on the tab record and use it as the fallback wherever an
  active-tab URL is emitted — `tabSnapshots` (`browser-pane.ts:755-762`) **and** the top-level
  `BrowserPaneUrlChangedEvent.url` — until navigation commits.
- Pane store (`useSessionManager.ts`): on **write**, do not persist an empty `browserUrl`; on
  **restore**, treat an empty / missing `browserUrl` as absent and fall back to the default URL —
  note `pane.browserUrl ?? <default>` does **not** catch `''`, so filter empty strings explicitly.
- **Verify:** `npx vitest run electron/browser-pane.test.ts src/features/browser/browserBridge.test.ts src/features/sessions/hooks/useSessionManager.test.ts`,
  plus `npm run lint` and `npm run type-check`.

### Step 6 — `createPane` reconnect test (spec task 8) · test

- `browser-pane.test.ts`: calling `createPane` for an already-registered pane returns the existing
  native record (full `tabs[]` + active tab) without building a new `WebContentsView`.
- **Verify:** `npx vitest run electron/browser-pane.test.ts`.

### Step 7 — CDP active-tab + abandon-on-switch test (spec task 5) · test

- `browser-pane.test.ts`: a forwarded `Page.navigate` / `Runtime.evaluate` reaches the active tab's
  debugger; activating another tab closes the prior attachment and a fresh connection targets the
  new active tab; a command on the now-closed attachment is **not** forwarded to the old tab.
- **Verify:** `npx vitest run electron/browser-pane.test.ts`.

### Step 8 — React tab-strip tests (spec task 4) · test

- `BrowserPane.test.tsx`: clicking a tab → `activateTab`; close `×` → `closeTab` + stopPropagation;
  `+` → `newTab`; an `onTabsChange` event re-renders the tab strip and address bar. (Add the
  missing `newBrowserPaneTab` bridge-mock export surfaced in the baseline check.)
- **Verify:** `npx vitest run src/features/browser/components/BrowserPane.test.tsx`.

### Step 9 — Preload / channel-wiring test (spec task 6) · test

- In `src/features/browser/browserBridge.test.ts`, assert every `BrowserPaneBridge` method invokes
  its matching `BROWSER_PANE_*` channel constant (from `electron/browser-pane-channels.ts`) and that
  the three event subscriptions register on their matching channels — so a dropped `preload.ts`
  `contextBridge` entry or a channel-name typo for `newTab` / `activateTab` / `closeTab` /
  `onTabsChange` is caught. Drive the existing hoisted `window` bridge mock.
- **Verify:** `npx vitest run src/features/browser/browserBridge.test.ts`.

### Step 10 — Full verification + commit

- `npm run lint && npm run type-check && npm run test` all green.
- Commit the in-progress tree plus all Step 1–9 changes as the Phase-1 browser pane, using a
  Conventional-Commits subject (`feat: …`, lowercase after the type — commitlint enforces it) and
  the repo's `Co-Authored-By` commit-trailer convention.

## Hand-off to the remaining phases

- **Phase C (local review):** `codex review --base main` from this worktree; fix structural
  findings; iterate to "patch is correct" / zero structural findings.
- **Phase D (PR):** `/lifeline:request-pr Y` — clean tree, push `-u`, base `main`.
- **Phase E (PR review loop):** `/lifeline:upsource-review` — poll Claude Code Review + connector,
  fix, verify, push, resolve threads, until only low-level findings remain.

## Manual smokes (cannot be automated by kimi/codex)

- **Bullet 2:** a redirect-based OAuth flow opens / completes as an in-pane tab.
- **Bullet 3 (restart leg):** sign in, fully quit and relaunch; document whether login persists
  (the spec notes graceful quit clears the backend session cache — `state.rs:76`).
- **Bullet 4:** YouTube (or equivalent non-DRM) video plays with audio.

<!-- codex-reviewed: 2026-05-29T13:54:17Z -->

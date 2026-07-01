---
id: e2e-testing
category: e2e-testing
created: 2026-04-19
last_updated: 2026-07-01
ref_count: 10
---

# E2E Testing

## Summary

Current E2E coverage uses WebdriverIO with `@wdio/electron-service` for the
Electron shell. Older findings below document the previous WebdriverIO +
tauri-driver + WebKitGTK chain; keep the process-lifecycle debugging lesson, but
do not reintroduce tauri-driver or WebKit-specific workarounds into the current
Electron path.

## Findings

### 1. WebKit DMA-BUF renderer crash on Linux + AMD/Mesa — needs `WEBKIT_DISABLE_DMABUF_RENDERER=1`

- **Source:** debug session | PR #70 | 2026-04-19
- **Severity:** HIGH
- **File:** `tests/e2e/{core,terminal,agent}/wdio.conf.ts`
- **Finding:** On Fedora 43 + webkit2gtk4.1 2.50.5 + AMD GPU, WebKitGTK's DMA-BUF renderer initialises, fails, and the webview silently dies during startup. WDIO sees `invalid session id when running "element"` on the first selector query because the WebDriver session was deleted the moment the app crashed. Masquerades as a spec/timing bug. `npm run tauri:dev` already sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` for the same reason; the WDIO path didn't.
- **Fix:** `onPrepare` in each WDIO config sets `process.env.WEBKIT_DISABLE_DMABUF_RENDERER = '1'` before `startTauriDriver()`. Env propagates WDIO launcher → tauri-driver → WebKitWebDriver → app.
- **Commit:** `947da57 fix(e2e): set WEBKIT_DISABLE_DMABUF_RENDERER in WDIO onPrepare`

### 2. WDIO 9 injects `webSocketUrl: true` + non-W3C `unhandledPromptBehavior: "ignore"`

- **Source:** debug session | PR #70 | 2026-04-19
- **Severity:** HIGH
- **File:** `tests/e2e/{core,terminal,agent}/wdio.conf.ts`
- **Finding:** WDIO 9 auto-injects BiDi capabilities unless `wdio:enforceWebDriverClassic: true` is set. WebKitWebDriver rejects both with `session not created: Failed to match capabilities`. Request body capture via a local HTTP proxy confirmed WDIO was rewriting the capability block after the config was loaded.
- **Fix:** Add `'wdio:enforceWebDriverClassic': true` to every capability block. Source: `node_modules/webdriver/build/node.js:1065-1072`.
- **Commit:** `7f1c053 feat(e2e): land Phase 1a WebdriverIO smoke suite for Tauri`

### 3. WebKitGTK WebDriver doesn't implement `element/click`

- **Source:** debug session | PR #70 | 2026-04-19
- **Severity:** MEDIUM
- **File:** `tests/e2e/shared/actions.ts`
- **Finding:** `element.click()` via the W3C WebDriver Actions API returns `unsupported operation`. Happens for every native click in specs that interact with buttons/tabs.
- **Fix:** `clickBySelector(sel)` uses `browser.execute((s) => document.querySelector(s)?.click())` to dispatch the DOM event directly. Same shape for `focusBySelector`.
- **Commit:** `7185f09 feat(e2e): land Phase 1b specs (nav, terminal-io, lifecycle, agent)`

### 4. xterm keystrokes can't be synthesised via Actions — target `.xterm-helper-textarea` directly

- **Source:** debug session | PR #70 | 2026-04-19
- **Severity:** MEDIUM
- **File:** `tests/e2e/shared/terminal.ts`
- **Finding:** Related to (3). WebKit's Actions API is missing, so `browser.keys()` doesn't type into the focused xterm. xterm binds its input handler to a hidden `.xterm-helper-textarea`; dispatching synthetic `InputEvent` (per character, `inputType: 'insertText'`) + `KeyboardEvent('keydown', { key: 'Enter', keyCode: 13 })` routes keystrokes into the PTY writer path.
- **Fix:** `typeInActiveTerminal(s)` / `pressEnterInActiveTerminal()` helpers in `tests/e2e/shared/terminal.ts`. Works for ASCII; non-BMP characters (surrogate pairs) would need widening.
- **Commit:** `7185f09`

### 5. `tput cols` returns empty under xvfb — read `$COLUMNS` instead

- **Source:** debug session | PR #70 | 2026-04-19
- **Severity:** MEDIUM
- **File:** `tests/e2e/terminal/specs/terminal-resize.spec.ts`
- **Finding:** CI runs `xvfb-run` which spawns the PTY with empty `TERM`. `tput cols` emits nothing when `TERM` is missing, the shell substitution `echo TAG$(tput cols)END` collapses to `TAGEND`, and the regex `/TAG(\d+)END/` never matches. Passed locally where the user shell has `TERM` set; flaked on CI with `"never produced a value"` error, timing out after 15s.
- **Fix:** Use `${COLUMNS}` — bash/zsh update it from SIGWINCH / TIOCGWINSZ and don't require `TERM`. Tagged echo pattern is otherwise the same.
- **Commit:** `edadd2c fix(e2e): read COLUMNS instead of tput cols in resize spec for CI`

### 6. `tauri-driver` binary path differs across install methods

- **Source:** debug session | PR #70 | 2026-04-19
- **Severity:** MEDIUM
- **File:** `tests/e2e/shared/tauri-driver.ts`
- **Finding:** Hardcoded `~/.local/bin/tauri-driver` (correct on my workstation, where the rustup shim had no default toolchain so I installed via `cargo install --root ~/.local`) fails on GitHub Actions, which uses `$CARGO_HOME/bin = ~/.cargo/bin/tauri-driver` by default. Surfaces as `spawn .../tauri-driver ENOENT` and kills the WDIO session before it starts.
- **Fix:** `resolveTauriDriver()` checks in order: `$TAURI_DRIVER_PATH` env override → `~/.cargo/bin/tauri-driver` → `~/.local/bin/tauri-driver` → bare `tauri-driver` on PATH. Also bumped `waitForPort` 5s → 15s to give cold CI runners slack, and attached an on-error handler so a missing binary surfaces a useful message instead of a raw ENOENT stack.
- **Commit:** `b781cd7 fix(e2e): resolve tauri-driver across cargo and .local install roots`

### 7. WebKitWebDriver on Linux allows one concurrent session — serialize workers

- **Source:** debug session | PR #70 | 2026-04-19
- **Severity:** MEDIUM
- **File:** `tests/e2e/{core,terminal,agent}/wdio.conf.ts`
- **Finding:** Default WDIO config ran specs in parallel workers; second spec immediately got `Maximum number of active sessions` from WebKitWebDriver. Earlier still, using `beforeSession` / `afterSession` (per-worker lifecycle) to spawn tauri-driver raced the port bind and produced `ECONNREFUSED` on whichever worker lost.
- **Fix:** Two required changes — (a) `maxInstances: 1, maxInstancesPerCapability: 1` so specs run sequentially; (b) driver lifecycle in `onPrepare` / `onComplete` (run once per invocation) instead of `beforeSession`. `waitForPort()` polls the TCP port until it actually accepts connections before WDIO proceeds, because the spawned child reports "ready" at fork time, not at bind time.
- **Commit:** `7f1c053`

### 8. `tauri::generate_context!()` embeds `frontendDist` at compile time

- **Source:** debug session | PR #70 | 2026-04-19
- **Severity:** HIGH
- **File:** `src-tauri/src/lib.rs`, `package.json:test:e2e:build`
- **Finding:** Every Vite rebuild needs a follow-up `cargo build` or the stale bundle stays baked into the binary via `generate_context!`. Observed an infuriating hour where an updated `e2e-bridge.ts` clearly existed in `dist/assets/...js` but the running app still served the old bridge shape. Cargo's change detection for the `include_dir!`-style macro is unreliable — sometimes a cargo rebuild picks up a dist change, sometimes not.
- **Fix:** `test:e2e:build` npm script chains `vite build && cargo build --features e2e-test,tauri/custom-protocol` so both always run. Touching `src-tauri/src/lib.rs` before cargo forces re-embed if cargo's file-watching misses the dist change. Without `tauri/custom-protocol`, the binary loads `devUrl=http://localhost:5173/` instead of embedded assets and the webview is blank.
- **Commit:** `7f1c053`

### 9. Host-global `/proc` agent detector collides with real Claude Code processes

- **Source:** debug session | PR #70 | 2026-04-19
- **Severity:** HIGH
- **File:** `src-tauri/src/agent/commands.rs`, `src-tauri/src/agent/detector.rs`
- **Finding:** Detector scans `/proc/<pid>/cmdline` for any `argv[0] = "claude"` and attributes the first match to whatever PTY is polling. On a dev box running Claude Code sessions, the detector latches onto those and misattributes them to fresh Vimeflow PTYs. Breaks the `agent-detect-fake` E2E spec non-deterministically (real claude wins the race against the fixture) and produces false `AgentStatusPanel` renders in production.
- **Fix (interim):** `VIMEFLOW_DISABLE_AGENT_DETECTION` env short-circuits `detect_agent_in_session` to `Ok(None)`. Set in core + terminal WDIO configs (which don't exercise the detector); cleared in agent config so the feature stays under test. Agent spec also gets a `pgrep -x claude` `before`-guard that skips when the host has unrelated claude processes.
- **Fix (proper, tracked):** Detector should filter candidates by descent from the PTY's shell PID — walk `/proc/<pid>/stat`'s PPID chain. See [#71](https://github.com/winoooops/vimeflow/issues/71).
- **Commit:** `055687c fix(e2e): env-gate agent detection so host claude procs don't crash suite` (interim); detector rewrite pending.

## Diagnostic Patterns

Several of the failures above looked identical in the WDIO output
("invalid session id", "Failed to match capabilities"), but had
completely different root causes. The generic fast-failure modes:

| Symptom                                              | Usual root cause                                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| `invalid session id` within ~800ms of session create | App crashed during startup (renderer, panic, misconfigured IPC) — not a spec bug |
| `Failed to match capabilities`                       | WDIO-injected BiDi capabilities or W3C violations the driver rejects             |
| `unsupported operation when running "element"`       | WebKit WebDriver missing an Actions API endpoint                                 |
| `spawn <binary> ENOENT`                              | Binary path hardcoded / assumed install layout                                   |
| `Maximum number of active sessions`                  | Parallel workers contending for WebKitWebDriver's single-session limit           |
| `ECONNREFUSED` on port 4444                          | `spawn` fired but the child hasn't bound the port yet — need a readiness poll    |

**Useful diagnostic techniques:**

1. **Run a local HTTP proxy between WDIO and tauri-driver** to log actual request bodies — this is how (2) was found. `node:http`-based proxy on port 4444, with tauri-driver on 6666, inspecting the `POST /session` body that WDIO actually sends.
2. **Strings-check the compiled binary** for known identifiers to verify it was actually rebuilt: `strings src-tauri/target/debug/vimeflow | grep -c VIMEFLOW_DISABLE_AGENT_DETECTION`. Returning 0 after a "successful" `cargo build` means cargo's change detection didn't trigger a re-embed — re-touch `src-tauri/src/lib.rs` and try again.
3. **Temporary `/tmp` stamp files** from the Rust side are the fastest way to rule in/out whether a specific command was even hit before a crash. Revert before commit.
4. **Compare `npx wdio` vs `npm run test:e2e`** — they differ in PATH prefixing and the full env surface. If one passes and the other doesn't, the difference is almost always in env vars the script assumes vs what `npm run` actually propagates.

## Related

- Spec: `docs/superpowers/specs/2026-04-14-e2e-testing-design.md`
- PR: [#70](https://github.com/winoooops/vimeflow/pull/70)
- WSL2-specific WebKitGTK issue: [#65](https://github.com/winoooops/vimeflow/issues/65)
- Agent detector scope issue: [#71](https://github.com/winoooops/vimeflow/issues/71)

### 10. E2E bridge buffer-read returns first xterm in DOM, not the active pane, once a single wrapper hosts N xterms

- **Source:** github-codex-connector | PR #199 cycle 2 | 2026-05-12
- **Severity:** P2 / MEDIUM
- **File:** `src/lib/e2e-bridge.ts`
- **Finding:** `readPaneBuffer(pane)` resolved `pane.querySelector('.xterm-rows')` to the FIRST xterm-rows descendant inside the session-level `data-testid="terminal-pane"` wrapper. Pre-5b each wrapper contained exactly one xterm (the session's single TerminalPane), so first-match was correct by construction. Post-5b the wrapper contains a SplitView with N inner TerminalPanes, each carrying its own xterm. `getTerminalBufferForSession(sessionId)` therefore returned whichever pane's xterm was first in DOM — not necessarily the active/target pane. Once multi-pane sessions exist in production (5c+), E2E specs reading buffer-by-session-id would get incorrect text and assertions would silently regress. Class of bug: refactors that change "1 wrapper : 1 inner widget" to "1 wrapper : N inner widgets" need a sweep of every DOM query that assumed singularity.
- **Fix:** `readPaneBuffer` first looks for the inner TerminalPane wrapper with `data-focused="true"` (the active pane's marker, set by `TerminalPane/index.tsx` when `pane.active === true`), then scopes the `.xterm-rows` lookup to that wrapper. Falls back to the previous `pane.querySelector('.xterm-rows')` when no focused inner wrapper exists — preserves behavior for single-pane sessions (whose only pane has `data-focused="true"`) and the defensive case where no pane is active (write-site bug). Existing E2E specs and the `findActivePane`/`getVisibleSessionId` paths are unaffected because they operate at the session-wrapper level. Code-review heuristic: when a UI refactor changes the DOM cardinality under a stable test-anchor selector (testid / data-attr), grep the E2E bridge layer for every `.querySelector(...)` call that drops into the anchor — any first-match descendant query needs a disambiguation pass.
- **Commit:** _(see git log for the cycle-2 fix commit on PR #199)_

### 11. e2e-bridge PTY-id fallback selector orphaned by the same attr-migration that fixed F10

- **Source:** github-codex-connector | PR #199 cycle 3 | 2026-05-12
- **Severity:** P2 / MEDIUM
- **File:** `src/lib/e2e-bridge.ts`
- **Finding:** Cycle 1's TerminalZone refactor migrated `data-pane-id`/`data-pty-id`/`data-cwd`/`data-mode` from the session-level `terminal-pane` wrapper to the per-pane `split-view-slot`. `readTerminalBufferForSession` already had a session-id query path (unchanged: targets the session wrapper), but its pty-id fallback still read `[data-testid="terminal-pane"][data-pty-id="..."]` — a selector that NO element matches after the attr migration. Result: every caller passing a PTY id (and the bridge explicitly supports it via `getActiveSessionIds()`-then-feed-back-in pattern) silently received an empty buffer. Class of bug: when a refactor moves an attribute between DOM levels, every selector that READ the attribute at the old level needs a paired update. The first-cycle fix (data-attr migration) and the next-cycle find (pty-id selector orphaned) were two halves of the same change — should have been caught together via grep on the attribute name.
- **Fix:** Updated the pty-id fallback selector to `[data-testid="split-view-slot"][data-pty-id="..."]` — the new home of the pane-level pty-id. `readPaneBuffer(slot)` works on a split-view-slot the same way it works on the session wrapper: the slot contains exactly one inner TerminalPane wrapper that carries `data-focused="true"` iff `pane.active`, so the focused-first lookup returns the slot's xterm-rows. Comment block updated to reflect the post-5b DOM cardinality. Code-review heuristic: when migrating DOM attributes between levels (session-wrapper → per-pane-slot in this case), `grep -rn "data-<attr>" src/` BEFORE committing the migration — every read site needs a paired update or it silently breaks.
- **Commit:** _(see git log for the cycle-3 fix commit on PR #199)_

### 12. Electron E2E suites depend on the last renderer build mode

- **Source:** local migration wrap-up | 2026-05-16
- **Severity:** MEDIUM
- **File:** `package.json`, `.github/workflows/e2e.yml`
- **Finding:** `npm run electron:build` overwrites `dist/` with a production renderer that does not include `window.__VIMEFLOW_E2E__`. Running `npm run test:e2e:terminal` after that production build produced prompt-readiness failures and one explicit `window.__VIMEFLOW_E2E__ missing` error, even though the backend path migration was correct. The WDIO runtime env var only unlocks Electron main-process E2E behavior; the renderer bridge is compile-time gated by the Vite build.
- **Fix:** Public E2E scripts now run `npm run test:e2e:build` before their suite. CI still builds once, then calls explicit `test:e2e:*:run` scripts so the job does not rebuild for every suite.
- **Commit:** _(this migration wrap-up branch)_

### 13. Electron dev launcher can boot blank when it drops `--no-sandbox`

- **Source:** local migration wrap-up | 2026-05-16
- **Severity:** MEDIUM
- **File:** `vite.config.ts`, `tests/e2e/shared/electron-app.ts`
- **Finding:** `vite-plugin-electron` defaults to launching Electron with `--no-sandbox`, but this project overrode startup with `startup(['.'])` to preserve sandbox parity in dev. On Linux dev hosts without a working Chromium SUID/user-namespace sandbox, that can surface as a blank/crashed dev window even though the production renderer and packaged custom-protocol path are healthy.
- **Fix:** `electron:dev` now starts Electron with `startup(['.', '--no-sandbox'])`, matching the E2E launch path. Packaged production still keeps the sandbox unless the operator explicitly passes `--no-sandbox` for local AppImage smoke.
- **Commit:** _(this migration wrap-up branch)_

### 14. Electron dev CSP must allow Vite React's inline preamble

- **Source:** local migration wrap-up | 2026-05-16
- **Severity:** HIGH
- **File:** `electron/main.ts`
- **Finding:** The non-packaged dev CSP allowed `unsafe-eval` for Vite but not `unsafe-inline`. Vite React injects an inline refresh preamble into `index.html`; Chromium blocked it, then `@vitejs/plugin-react` threw `can't detect preamble`, leaving `#root` empty on the dark page. Production builds and packaged `vimeflow://app/index.html` still mounted, so the failure looked like a dev-only black window.
- **Fix:** Added `'unsafe-inline'` to the non-packaged `script-src`. Packaged CSP remains strict; the relaxation is limited to dev/E2E where Vite React and WDIO need inline bootstrap code.
- **Commit:** _(this migration wrap-up branch)_

### 15. Electron dev sandbox override needs visible documentation

- **Source:** github-claude | PR #214 | 2026-05-16
- **Severity:** MEDIUM
- **File:** `vite.config.ts`
- **Finding:** `electron:dev` launches Electron with `--no-sandbox`, which overrides `BrowserWindow.webPreferences.sandbox: true`; without an adjacent comment, the window-level setting falsely suggests the dev renderer is OS-sandboxed.
- **Fix:** Added a DEV ONLY comment at the `startup(['.', '--no-sandbox'])` call documenting the Linux CI/container SUID sandbox constraint and the deferred removal condition.
- **Commit:** _(see git log for the PR #214 sandbox-comment review-fix commit)_

### 16. Electron dev sandbox override must be scoped to CI/headless runs

- **Source:** github-claude | PR #214 | 2026-05-16
- **Severity:** MEDIUM
- **File:** `vite.config.ts`
- **Finding:** Adding a comment near `startup(['.', '--no-sandbox'])` documented the sandbox tradeoff but left the flag applied to every `electron:dev` launch. That made ordinary local dev sessions run without Chromium's renderer sandbox, even on hosts where the sandbox works.
- **Fix:** Compute Electron startup args from runtime context. Only CI and Linux headless/container runs without `DISPLAY` or `WAYLAND_DISPLAY` receive `--no-sandbox`; normal local dev starts Electron without the process-level sandbox override.
- **Commit:** _(see git log for the PR #214 scoped-sandbox review-fix commit)_

### 17. Electron dev sandbox CI detection must not apply outside Linux headless hosts

- **Source:** github-claude | PR #214 | 2026-05-16
- **Severity:** MEDIUM
- **File:** `vite.config.ts`
- **Finding:** The first scoped-sandbox fix OR'd `process.env.CI` with the Linux headless display check. That still passed `--no-sandbox` on macOS/Windows CI and on developer shells that export `CI=true`, even though the SUID sandbox workaround is Linux-specific.
- **Fix:** Remove the broad CI predicate and rely on the Linux headless display check. Normal local dev, macOS CI, and Windows CI keep Electron's renderer sandbox; Linux hosts without `DISPLAY` or `WAYLAND_DISPLAY` still get the dev-only workaround.
- **Commit:** _(see git log for the PR #214 Linux-headless sandbox review-fix commit)_

### 18. Electron dev sandbox override must be an explicit opt-in

- **Source:** github-claude | PR #214 | 2026-05-16
- **Severity:** MEDIUM
- **File:** `vite.config.ts`
- **Finding:** Even after narrowing the detection to Linux hosts without display variables, `electron:dev` still inferred `--no-sandbox` automatically on headless Linux. That made every CI/container/dev-shell run in that state silently drop Chromium's renderer sandbox with no visible opt-in.
- **Fix:** Removed runtime auto-detection from the Vite startup path. `electron:dev` now passes `--no-sandbox` only when `VIMEFLOW_NO_SANDBOX=1` is explicitly set, keeping normal dev and CI sandboxed by default while preserving a documented escape hatch for Linux hosts that cannot launch Chromium's sandbox.
- **Commit:** _(see git log for the PR #214 explicit sandbox opt-in review-fix commit)_

### 19. E2E input guard passes vacuously when `E2E_ROOT` contains no `.ts` files

- **Source:** github-claude | PR #374 cycle 1 | 2026-06-06
- **Severity:** MEDIUM
- **File:** `src/test/e2eInputGuard.test.ts`
- **Finding:** After computing `filePaths` from `listTypeScriptFiles(E2E_ROOT)`, the test immediately evaluates `expect(findings).toEqual([])`. If `tests/e2e` is empty, or if all e2e files are temporarily moved or renamed (e.g., during a directory restructure), `filePaths` is `[]`, `findings` is `[]`, and the assertion trivially passes — the guard silently grants a clean bill of health without having scanned a single file. The guard's stated purpose (preventing `browser.keys(...)` usage in e2e tests) evaporates silently.
- **Fix:** Added `expect(filePaths.length).toBeGreaterThan(0)` immediately after computing `filePaths`, requiring the guard to scan at least one e2e TypeScript file before checking findings. This distinguishes "no violations found" from "no files scanned".
- **Commit:** _(this cycle)_

### 20. Per-test Mocha timeout shorter than the sum of nested helper waits

- **Source:** github-codex-connector | PR #472 round 2 | 2026-06-15
- **Severity:** P2 / MEDIUM
- **File:** `tests/e2e/core/specs/browser-pane-overlay.spec.ts` L302
- **Finding:** The core WDIO config keeps Mocha's per-test timeout at 30s, but the browser overlay spec can legitimately spend more than that across sequential helper waits: 20s for the terminal, 10s for the split slot, 15s for the browser pane, 15s for CDP registration, plus the command-palette and bounds-capture waits. On a cold CI run Mocha aborted the test with a generic timeout even though the helper-specific budgets were still in progress, hiding the real bottleneck.
- **Fix:** Chained `.timeout(60_000)` on the `it(…)` call — the Mocha `Runnable.prototype.timeout()` API — in the browser overlay spec, giving the sequential waits enough headroom while leaving the project-wide 30s default in place for faster specs. This keeps the timeout local to the one spec that needs it.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 21. Codex/Kimi E2E status tests bypassed the real watcher pipeline

- **Source:** github-claude + local-codex verify | PR #563 cycle 1 | 2026-06-19
- **Severity:** LOW
- **File:** `tests/e2e/agent/specs/agent-runtime-regressions.spec.ts` L225-240 (original), plus new backend E2E helpers
- **Finding:** The Claude status test wrote a real `status.json`, started the real file watcher, and waited for the sidebar to update. The Codex/Kimi equivalent injected `agent-status`/`agent-turn` events directly through the renderer E2E bridge, testing React rendering but not the Rust-to-frontend event pipeline or the agent-specific filesystem/watcher paths.
- **Fix:** Added backend E2E helpers `e2e_start_codex_watcher` and `e2e_start_kimi_watcher` that seed a hermetic agent home (`~/.codex` or `KIMI_CODE_HOME`), create the locator-recognizable session directories and metadata, start the real agent watcher, restore the original env, and return the fixture path for the test to write. The spec now exercises real watcher ingestion for both Codex and Kimi before emitting agent-turn events.
- **Commit:** same commit as this entry

### 22. e2e_start_codex/kimi_watcher missing from Electron preload allowlist

- **Source:** github-claude | PR #563 round 2 | 2026-06-19
- **Severity:** HIGH
- **File:** `electron/backend-methods.ts`, `electron/backend-methods.test.ts`
- **Finding:** The Rust IPC router adds `e2e_start_codex_watcher` and `e2e_start_kimi_watcher`, and `tests/e2e/agent/specs/agent-runtime-regressions.spec.ts` calls both via `window.__VIMEFLOW_E2E__.invokeBackend`. `electron/backend-methods.ts` only allows `list_active_pty_sessions`, `e2e_agent_bridge_info`, and `e2e_seed_live_agent` when `allowE2eMethods` is enabled, so the preload gate rejects both calls.
- **Fix:** Added `e2e_start_codex_watcher` and `e2e_start_kimi_watcher` to `e2eBackendMethods` in `electron/backend-methods.ts` and covered them in `electron/backend-methods.test.ts` for default denial and explicit E2E enablement.
- **Commit:** same commit as this entry

### 23. e2e_emit_agent_status missing from Electron preload allowlist

- **Source:** github-claude | PR #563 round 3 | 2026-06-19
- **Severity:** HIGH
- **File:** `electron/backend-methods.ts`, `electron/backend-methods.test.ts`
- **Finding:** The Rust IPC router added `e2e_emit_agent_status` behind `#[cfg(feature = "e2e-test")]`, and the new E2E spec defined a helper that called `invokeBackend('e2e_emit_agent_status', ...)`. The PR extended `e2eBackendMethods` for four other new E2E probe methods but omitted `e2e_emit_agent_status`, so the Electron main process would reject the call with "Method not allowed" before it reached Rust.
- **Fix:** Added `e2e_emit_agent_status` to `e2eBackendMethods` and covered it in both the default-denial test and the `allowE2eMethods` `test.each` block in `electron/backend-methods.test.ts`.
- **Commit:** same commit as this entry

### 24. Watcher E2E test assumes ambient PTY has agent bridge enabled

- **Source:** github-claude | PR #563 round 3 | 2026-06-19
- **Severity:** MEDIUM
- **File:** `tests/e2e/agent/specs/agent-runtime-regressions.spec.ts`
- **Finding:** The "ingests app-data status files" scenario called `waitForVisiblePtyId()` to reuse the app's initial terminal PTY, then asserted `info.statusFile` was populated. `statusFile` is only non-null when the PTY was spawned with `enable_agent_bridge: true`. The assertion therefore depended on the E2E launch configuration rather than the test itself, and a violation would fail with a confusing "statusFile should be populated" message.
- **Fix:** Replaced the ambient-PTY reuse with a frontend-driven new session (`button[aria-label="New session"]`), waited for the visible PTY to change, and used that dedicated bridge-enabled session for the watcher/UI assertions. Added cleanup that closes the spawned tab after the scenario.
- **Commit:** same commit as this entry

### 25. E2E helper selector collides with an open configuration menu

- **Source:** deterministic CI failure | PR #642 round 1 | 2026-07-01
- **Severity:** MEDIUM
- **File:** `tests/e2e/shared/actions.ts`, `tests/e2e/core/specs/navigation.spec.ts`
- **Finding:** `clickLayoutButton` queried `button[aria-label="<layout>"]` globally. Hidden-layout menu checkboxes share those labels with the real layout switcher pills, so an open configuration menu could absorb the follow-up click and leave the split layout unchanged. The navigation smoke test also asserted dock content before opening the now-closed-by-default dock.
- **Fix:** Scoped layout-button clicks to `[data-testid="layout-switcher"]` so menu items cannot match, and made the navigation smoke open the dock via the real status-bar toggle before asserting the default Diff tab.
- **Commit:** same commit as this entry

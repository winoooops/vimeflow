# Changelog

🇺🇸 English | [🇨🇳 简体中文](./CHANGELOG.zh-CN.md)

All notable changes to Vimeflow are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project is
pre-1.0 so everything sits under `[Unreleased]` and is grouped by roadmap
phase (see `docs/roadmap/progress.yaml`).

**Pairing with reviews.** Each entry may cite patterns from
[`docs/reviews/patterns/`](docs/reviews/CLAUDE.md) that were applied,
updated, or created by the change — giving a linear timeline alongside
the thematic retrospective index.

**Updating.** On merge, append one bullet under the active phase in both
this file and `CHANGELOG.zh-CN.md`. Entry shape:
`- <change> ([#PR](url), <short-sha>) — patterns: [Name](docs/reviews/patterns/x.md)`.
Supplementary notes (scope, deferred items, spec paths) use indented
nested bullets (`    - …`). Security and Fixed entries should link a
pattern when one exists; bump its `ref_count` per `docs/reviews/CLAUDE.md`.

---

## [Unreleased]

### Phase 4 — Agent Status Sidebar (in progress)

#### Added

- WebdriverIO + tauri-driver E2E infrastructure with native Linux CI: 10 spec
  files (11 tests green locally on Fedora/Nobara) covering app launch, IPC
  round-trip, navigation, PTY spawn, terminal I/O, session lifecycle, multi-tab
  isolation, terminal resize, file→editor flow, and fake-claude agent
  detection. Frontend E2E bridge (`window.__VIMEFLOW_E2E__`) and Cargo
  `e2e-test` feature added.
  ([#70](https://github.com/winoooops/vimeflow/pull/70), `e97c1e8`) —
  patterns: [E2E Testing](docs/reviews/patterns/e2e-testing.md),
  [Cross-Platform Paths](docs/reviews/patterns/cross-platform-paths.md)
  - WSL2 scope (#65) deferred — "local env unsupported; use native Linux or CI".
  - Deferred follow-ups: REPL, structured logging (#61), transcript parsing
    in E2E, HMR orphan-PTY harness (#55), Phase 3 CI.
  - Spec: `docs/superpowers/specs/2026-04-14-e2e-testing-design.md`.
- UNIFIED design spec and canonical tokens (`docs/design/UNIFIED.md`,
  `tokens.css`, `tokens.ts`) — 5-zone layout contract, agent-state
  machine, component APIs.
  ([#68](https://github.com/winoooops/vimeflow/pull/68), `3d6bc9a`)
- Per-session statusline shell bridge + CWD storage in `PtyState` for
  watcher path derivation.
  ([#57](https://github.com/winoooops/vimeflow/pull/57),
  [#60](https://github.com/winoooops/vimeflow/pull/60),
  `de43dfc`, `e8d243c`) —
  patterns: [PTY Session Management](docs/reviews/patterns/pty-session-management.md)
- Transcript JSONL parser emitting `agent-tool-call` events.
  ([#63](https://github.com/winoooops/vimeflow/pull/63), `ca50df6`)
- `ts-rs` type codegen → `src/bindings/` for type-safe Rust ↔ TS boundary.
  ([#49](https://github.com/winoooops/vimeflow/pull/49), `53789f5`)

#### Changed

- Harness default backend swapped from `claude_code_sdk` to `claude -p`
  subprocess per role. Inherits the user's `~/.claude` CLI auth; the
  default path no longer requires `ANTHROPIC_API_KEY` or
  `ANTHROPIC_BASE_URL`. SDK is preserved as an opt-in fallback via
  `--client sdk` (still requires the API key when used).
  ([#73](https://github.com/winoooops/vimeflow/pull/73), `93a5338`) —
  patterns: [Policy Judge Hygiene](docs/reviews/patterns/policy-judge-hygiene.md),
  [Fail-Closed Hooks](docs/reviews/patterns/fail-closed-hooks.md),
  [Async Race Conditions](docs/reviews/patterns/async-race-conditions.md),
  [Command Injection](docs/reviews/patterns/command-injection.md),
  [Preflight Checks](docs/reviews/patterns/preflight-checks.md)
  - New modules: `cli_client.py` (stream-JSON parser + `ClaudeCliSession`
    with session resume / stderr drain / monotonic-budget timeout),
    `hook_runner.py` (CLI → Python hook bridge, fail-closed on both
    import-time and runtime errors), `policy_judge.py` (deny-by-default
    with `HARNESS_POLICY_JUDGE=ask` / `=explain` opt-in and a
    gitignored `.policy_allow.local` escape hatch), `sdk_client.py`
    (lazy-imported fallback — only module that touches `claude_code_sdk`).
  - Shared helpers in `client.py`: `build_base_settings`,
    `write_settings_file`, `create_client` (CLI factory mirrored by
    `sdk_client.create_client`).
  - Removed the `CLAUDE_CONFIG_DIR` override that was silently hiding
    the user's CLI auth. Swapped `--allowed-tools` (permissive) for
    `--tools` (exclusive) so the CLI tool surface matches the SDK's.
  - 12 rounds of cloud-review hardening: shell-quoted hook command
    paths (`shlex.quote`), concurrent stderr drain against pipe-buffer
    deadlock, atomic cache writes with `fcntl.flock`, user-private
    cache at `~/.claude/harness_policy_cache.json`, async
    `_query_claude` so SDK-path hooks don't stall the event loop,
    Python 3.9+ compatible `asyncio.wait_for` timeouts,
    `ResultEvent(is_error=True)` escalation to `"error"` status,
    first-writer-wins cache semantics.
  - Spec: `docs/superpowers/plans/2026-04-20-harness-claude-cli-subprocess.md`.
- README (English + zh-CN) refreshed with Phase 3/4 scope; progress
  tracker rebaselined.
  ([#67](https://github.com/winoooops/vimeflow/pull/67), `f590c18`) —
  patterns: [Documentation Accuracy](docs/reviews/patterns/documentation-accuracy.md)

#### Security

- Harness policy judge is now deny-by-default rather than LLM
  rubber-stamp. Unknown bash commands are blocked unless listed in
  `harness/.policy_allow.local` (gitignored, user-managed) or the
  operator sets `HARNESS_POLICY_JUDGE=ask` (LLM decides) /
  `=explain` (LLM advises but still denies). `hook_runner.py` fails
  CLOSED on every error path — import-time failures, hook exceptions,
  and a 45 s outer deadline so Claude CLI's own hook timeout can't
  SIGKILL us into a silent allow. Policy judge subprocess runs with
  `--tools ""` so it can't invoke tools or trigger user-level hooks.
  ([#73](https://github.com/winoooops/vimeflow/pull/73), `93a5338`) —
  patterns: [Policy Judge Hygiene](docs/reviews/patterns/policy-judge-hygiene.md),
  [Fail-Closed Hooks](docs/reviews/patterns/fail-closed-hooks.md)

#### Fixed

- PTY sessions destroyed by Vite HMR full-reload (e.g. `vim :w` inside the
  workspace, manual refresh, error-boundary reset). Moved session state to a
  Rust filesystem cache (single source of truth) and added a cursor-based
  replay protocol (`offset_start` + `byte_len` + per-pane `cursorRef`) with
  listen-before-snapshot ordering, so any remount transparently reattaches
  to the live PTY without losing or doubling bytes.
  ([#99](https://github.com/winoooops/vimeflow/pull/99), `cb0ffa6`) —
  patterns: [Async Race Conditions](docs/reviews/patterns/async-race-conditions.md),
  [PTY Session Management](docs/reviews/patterns/pty-session-management.md),
  [React Lifecycle](docs/reviews/patterns/react-lifecycle.md),
  [Resource Cleanup](docs/reviews/patterns/resource-cleanup.md)
  - 15-round Codex/Claude review cycle; final verdict ✅ APPROVE.
  - Retrospective: [`docs/reviews/retrospectives/2026-04-27-pty-reattach-review-cycle.md`](docs/reviews/retrospectives/2026-04-27-pty-reattach-review-cycle.md)
  - Design: [`docs/superpowers/specs/2026-04-25-pty-reattach-on-reload-design.md`](docs/superpowers/specs/2026-04-25-pty-reattach-on-reload-design.md)
  - Follow-ups deferred as separate issues: #100 (read-loop global mutex perf),
    #101 (kill_pty active rotation alignment), #102 (bridge-dir cleanup on
    CapReached), #103 (RingBuffer drain), #104 (dead `ManagedSession.cwd`),
    #105 (TerminalPane unused dep), #106 (`inner_sessions` visibility).
- `agent-status` `ContextBucket` test compared against hard-coded English
  instead of runtime locale.
  ([#69](https://github.com/winoooops/vimeflow/pull/69), `a656daf`) —
  patterns: [Testing Gaps](docs/reviews/patterns/testing-gaps.md)
- `tauri:dev` on Linux/Wayland failed to launch the WebKitGTK renderer
  under DMA-BUF; disabled DMA-BUF renderer in the dev script.
  ([#66](https://github.com/winoooops/vimeflow/pull/66), `07b5c6f`) —
  patterns: [Cross-Platform Paths](docs/reviews/patterns/cross-platform-paths.md)

### Phase 3 — Terminal Core

#### Added

- `portable-pty` + xterm.js terminal pane with Catppuccin Mocha theme,
  session caching, FitAddon, WebglAddon, and multi-tab support.
  ([#31](https://github.com/winoooops/vimeflow/pull/31), `ba395c7`) —
  patterns: [PTY Session Management](docs/reviews/patterns/pty-session-management.md),
  [Terminal Input Handling](docs/reviews/patterns/terminal-input-handling.md)
- `TauriTerminalService` IPC bridge: PTY stdout → Tauri events → xterm.js,
  xterm `onData` → `invoke(write_pty)` → PTY stdin. Resize wired via
  `ResizeObserver` + `FitAddon` + `resize_pty`. Cleanup kills session on
  unmount.
  ([#34](https://github.com/winoooops/vimeflow/pull/34), `2fc3fa2`,
  `1ecee29`) —
  patterns: [Resource Cleanup](docs/reviews/patterns/resource-cleanup.md),
  [Async Race Conditions](docs/reviews/patterns/async-race-conditions.md)

### Phase 2 — Workspace Layout Shell

#### Added

- 4-zone workspace grid: Icon Rail, Sidebar, Terminal Zone, Agent Activity
  panel. Context switcher tabs (Files / Editor / Diff) wired into the
  sidebar. All components use Obsidian Lens semantic tokens.
  ([#31](https://github.com/winoooops/vimeflow/pull/31), `ba395c7`) —
  patterns: [React Lifecycle](docs/reviews/patterns/react-lifecycle.md),
  [Accessibility](docs/reviews/patterns/accessibility.md)

#### Removed

- Chat-first UI: `ChatView`, `features/chat/`, chat domain types, mock
  messages. Project pivoted from chat manager to CLI agent workspace.
  ([#31](https://github.com/winoooops/vimeflow/pull/31), `ba395c7`)

### Phase 1 — Tauri Scaffold + CI Green

#### Added

- Tauri v2 scaffold (`src-tauri/`), `tauri:dev` / `tauri:build` npm
  scripts, `src/lib/environment.ts` (`isTauri()` detection), CI pipeline
  across macOS/Windows/Linux with Rust caching.
  ([#27](https://github.com/winoooops/vimeflow/pull/27), `9ce4d61`) —
  patterns: [CSP Configuration](docs/reviews/patterns/csp-configuration.md)

---

## Legend

- **Added** — new capability, file, command, or dependency.
- **Changed** — behavioral/API update that is not a bug fix.
- **Fixed** — bug fix (link a review pattern if one informed it).
- **Removed** — deleted capability, file, or dependency.
- **Security** — security-relevant fix (pattern link **required**).

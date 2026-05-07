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

### UI Handoff Migration

#### Added

- Handoff design tokens and `src/agents/registry.ts` landed as the first
  additive UI migration step.
  ([#171](https://github.com/winoooops/vimeflow/pull/171), `38af7ab`)
- Handoff app shell proportions, status bar, and session-tab strip landed
  while preserving the existing Tauri terminal integrations.
  ([#173](https://github.com/winoooops/vimeflow/pull/173), `266b3a0`)
- Sidebar session rows and browser-style session tabs were restyled and wired
  to `useSessionManager`; the roadmap now tracks step 4, Single TerminalPane,
  as the next handoff step.
  ([#174](https://github.com/winoooops/vimeflow/pull/174), `ab1b888`) —
  patterns: [Documentation Accuracy](docs/reviews/patterns/documentation-accuracy.md)

### Phase 4 — Agent Status Sidebar

#### Added

- Codex Adapter Stage 2 — `CodexAdapter` lands behind the existing
  `AgentAdapter` trait so a PTY running `codex` populates the same status
  panel as a Claude session: model, context window (driven by
  `last_token_usage`, not lifetime totals), 5h/7d rate limits, and
  durations. SQLite-primary session locator (schema-driven `logs` /
  `threads` discovery, named-placeholder tuple comparison on
  `(ts, ts_nanos) >= pty_start`) with FS-scan fallback. New rusqlite
  bundled dep. `cost.total_cost_usd` becomes `Option<f64>` (Rust → null on
  the wire → frontend override `number | null` → `BudgetMetrics` renders
  `'—'` for null in `ApiKeyVariant`). `ManagedSession.started_at` +
  `PtyState::get_started_at` added so the locator can gate on PTY start
  time. `BindContext { session_id, cwd, pid, pty_start }` and `BindError
{ Pending, Fatal }` added to `agent/adapter/types.rs`;
  `AgentAdapter::status_source` becomes fallible; `base::start_for` runs a
  bounded retry on `Pending` (5 × 100ms = 500ms total, well under
  `DETECTION_POLL_MS=2000`). Spec:
  [`docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md`](docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md);
  plan:
  [`docs/superpowers/plans/2026-05-04-codex-adapter-stage-2.md`](docs/superpowers/plans/2026-05-04-codex-adapter-stage-2.md).
  - **Scope expansion documented in
    [`docs/decisions/2026-05-04-codex-adapter-stage-2-scope-expansion.md`](docs/decisions/2026-05-04-codex-adapter-stage-2-scope-expansion.md):**
    the spec's three locked rules (no transcript tailer in v1; `/proc`
    verifier-only; `BindContext.pid` = shell PID) were all relaxed
    during implementation. The transcript tailer landed in v1 and
    reuses `claude_code/test_runners/*` to emit
    `AgentToolCallEvent` / `AgentTurnEvent` / test-run signals;
    `/proc/<pid>/fd/*` and `/proc/<pid>/cmdline` contribute Linux
    fast-paths when the SQLite logs query returns no rows (every fd
    candidate is round-tripped through `threads.rollout_path` for
    multi-fd disambiguation); `BindContext.pid` is now the detected
    agent PID via `detect_agent`, not the shell PID, because Codex's
    `logs.process_uuid` indexes by the codex child PID.
  - Six rollout JSONL fixtures under
    `src-tauri/tests/fixtures/codex/` pin the spec's locked parser
    rules (last_token_usage source, info-null partial update,
    incomplete-trailing-line silent drop, malformed-mid warn).
- README hero gif (`docs/media/hero-init.gif`) plus four static screenshots
  in `docs/media/`: workspace overview, agent status sidebar close-up, git
  diff viewer, and editor with vim mode. The hero recording (spawn `claude` →
  `/init` → tool calls stream live) doubles as the manual verification
  evidence that closed `p4-d6` (real Claude Code session, end-to-end).
  Capture pipeline (Kooha WebM → ffmpeg 1.5× / 15 fps / 1280px / 80-color
  palette) documented in `docs/media/CLAUDE.md`.
  - Bilingual mirror in `README.zh-CN.md`.
  - Roadmap (`docs/roadmap/progress.yaml`) bumped to v7: Phase 4 status →
    `done`, with a top-level note listing cross-phase items shipped during
    Phase 4 (#80, #83, #86, #107, #109, #115, #120).
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

- `/harness-plugin:github-review` rewritten to consume `chatgpt-codex-connector`
  inline reviews + Claude Code Review aggregated comments + human reviewer
  comments as a third source. State persistence via git commit-message
  trailers (no JSON state file) with lazy reconciliation against live GraphQL
  state. Codex-verified react+resolve chain: reply + `resolveReviewThread`
  fire only after local `codex exec` agrees the staged fix addressed the
  upstream finding.
  ([#112](https://github.com/winoooops/vimeflow/pull/112),
  [`e9b6bdc`](https://github.com/winoooops/vimeflow/commit/e9b6bdc),
  closes [#111](https://github.com/winoooops/vimeflow/issues/111)) —
  patterns: [Error Surfacing](docs/reviews/patterns/error-surfacing.md),
  [Documentation Accuracy](docs/reviews/patterns/documentation-accuracy.md),
  [Git Operations](docs/reviews/patterns/git-operations.md).
  - Disabled `.github/workflows/codex-review.yml` (renamed to `.disabled`).
    The aggregated Codex Action hit OpenAI quota every push for two PRs
    running ([PR #109 retrospective](docs/reviews/retrospectives/2026-04-29-tests-panel-bridge-session.md));
    single-commit revert if quota is restored later.
  - 7 self-dogfood cycles processed ~30 findings end-to-end; 16 of those
    were self-discovered regressions caught by the dogfood loop itself.
    0 follow-up issues filed.
  - Skill structure: thin orchestrator (`SKILL.md`, ~700 lines) +
    7 references (`parsing.md`, `empty-state-classification.md`,
    `verify-prompt.md`, `pattern-kb.md`, `commit-trailers.md`,
    `cleanup-recovery.md`, `input-resolution.md`) + 2 scripts
    (`scripts/helpers.sh`, `scripts/verify.sh`).
  - Retrospective: [`docs/reviews/retrospectives/2026-04-30-harness-github-review-rewrite-session.md`](docs/reviews/retrospectives/2026-04-30-harness-github-review-rewrite-session.md)
  - Spec: `docs/superpowers/specs/2026-04-29-harness-github-review-connector-design.md`
  - Plan: `docs/superpowers/plans/2026-04-29-harness-github-review-connector.md`
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

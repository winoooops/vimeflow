---
title: PR-A — Runtime-neutral Rust backend (Tauri keeps the shell)
date: 2026-05-13
status: draft
issue: TBD (one of four PRs in the Tauri → Electron migration sequence)
owners: [winoooops]
related:
  - docs/superpowers/plans/2026-05-13-electron-rust-backend-migration.md
  - docs/superpowers/specs/2026-05-13-pr-b-rust-sidecar-ipc-design.md (forthcoming)
  - docs/superpowers/specs/2026-05-13-pr-c-frontend-backend-bridge-design.md (forthcoming)
  - docs/superpowers/specs/2026-05-13-pr-d-electron-shell-design.md (forthcoming)
  - rules/common/design-philosophy.md
  - docs/reviews/patterns/async-race-conditions.md
  - docs/reviews/patterns/pty-session-management.md
---

# PR-A — Runtime-neutral Rust backend (Tauri keeps the shell)

## Context

This is the first of four sequenced PRs that migrate vimeflow's desktop
shell from Tauri to Electron while preserving the existing Rust backend.
The 4-PR slicing was carved at the runtime-neutral seam so each PR
ships to `dev` (a long-lived integration branch), tests stay green at
every merge point, and `main` only sees the full migration as one
atomic merge once all four PRs land green on `dev`.

```
PR-A  Rust backend de-Tauri (THIS spec) ──┐
PR-B  Rust sidecar + IPC protocol         │
PR-C  Frontend backend.ts rewires         ├─► merge dev → main
PR-D  Electron shell + Tauri removal      ┘
```

**Why migrate.** Three motivations:

1. **WebView rendering consistency.** Tauri uses each OS's native webview:
   WebKit2GTK on Linux, WebView2 on Windows, WKWebView on macOS. These
   diverge in CSS support, performance, and bug-for-bug behavior — the
   AppImage rendering fix in [#194](https://github.com/winoooops/vimeflow/pull/194)
   is one symptom; the suppressed double-scrollbar in
   [#195](https://github.com/winoooops/vimeflow/pull/195) is another.
   Electron ships a bundled Chromium so the app renders identically on
   every platform.
2. **WebKit2GTK FPS / lag.** The current Linux build (Fedora/Nobara) on
   Wayland shows observable input lag and dropped frames during fast
   xterm.js scrolling. Chromium (Electron) handles the same workload
   smoothly. This is the most user-visible driver of the migration.
3. **Ecosystem.** Electron's plugin / auto-updater / tray-integration
   story is more mature for the cross-platform desktop features the
   roadmap wants to add post-migration (system tray, global shortcuts,
   native menus, auto-update).

Accepted trade-off: installer size grows from ~12 MB (Tauri) to ~150 MB
(Electron's bundled Chromium + Node). Memory footprint roughly doubles
per window. These are recorded in the migration roadmap so reviewers
can weigh them.

**PR-A scope.** Extract every Tauri-coupled Rust surface — `tauri::State`,
`tauri::AppHandle`, `tauri::Runtime`, `tauri::Emitter`, `tauri::Manager`
— into runtime-neutral types: a consolidated `BackendState` deep module
plus an `EventSink` trait. Tauri **stays as the host** for this PR — a
thin `TauriEventSink` adapter at `src-tauri/src/runtime/tauri_bridge.rs`
keeps the Tauri command bodies wrapping the new plain functions. The
app boots, runs, and ships identically to today; the only observable
change is that every Rust unit test can now construct a `FakeEventSink`
fixture and run without spinning up a Tauri runtime.

The user-visible behavior contract is unchanged: same command names,
same event names, same serde payloads, same event ordering, same
session cache semantics on graceful exit.

## Goals

1. **Consolidated `BackendState` deep module** at
   `src-tauri/src/runtime/state.rs`. One struct owns the five domains
   today managed by Tauri (PTY, sessions, agents, transcripts, git)
   plus the `EventSink`. Per-domain locks preserved (Decision #9);
   external callers see business methods (`state.spawn_pty(req)`,
   `state.list_sessions()`), not raw `Arc<Mutex<...>>`.
2. **`EventSink` trait** at `src-tauri/src/runtime/event_sink.rs`.
   Generic `emit_json(event, payload)` + typed convenience helpers
   (`emit_pty_data`, `emit_pty_exit`, `emit_agent_status`,
   `emit_agent_tool_call`, `emit_test_run`, `emit_git_status_changed`).
   `FakeEventSink` test fixture in the same file behind `#[cfg(test)]`.
3. **`TauriEventSink` adapter** at
   `src-tauri/src/runtime/tauri_bridge.rs` — the single file where
   `tauri::AppHandle` appears in the runtime layer. Implements
   `EventSink` by routing every emit to `handle.emit(...)`. PR-D
   deletes this file.
4. **Tauri command bodies become thin wrappers.** Each
   `#[tauri::command]` function (in `terminal/commands.rs`,
   `agent/commands.rs`, `filesystem/{list,read,write}.rs`,
   `git/mod.rs`, etc.) collapses to:

   ```rust
   #[tauri::command]
   async fn spawn_pty(
       state: tauri::State<'_, Arc<BackendState>>,
       request: SpawnPtyRequest,
   ) -> Result<PtySession, String> {
       state.spawn_pty(request).await
   }
   ```

   The plain method `BackendState::spawn_pty` carries the actual logic.
   Tauri's role shrinks to "dispatch + ts-rs serde", which is exactly
   the surface PR-B's sidecar IPC router will replace.

5. **Event emission goes through `EventSink`.** Replace every
   `app_handle.emit(...)` / `app_handle.emit_to(...)` call in the Rust
   tree with `state.events.emit_*(...)`. PR-A preserves the exact
   event name strings and payload serde shapes — PR-B verifies the
   contract end-to-end across the sidecar.
6. **Agent adapter trait loses its `<R: tauri::Runtime>` generic.**
   `AgentAdapter<R>` becomes `AgentAdapter` (non-generic); concrete
   adapters (`ClaudeCodeAdapter`, `CodexAdapter`) take
   `Arc<BackendState>` in their constructor and emit through
   `state.events` instead of `AppHandle<R>`.
7. **Parity tests with `FakeEventSink`.** Every Rust unit test that
   today either skips because of Tauri runtime requirements or uses
   awkward `mock_app()` plumbing gets ported to construct
   `BackendState::with_fake_sink(...)`. New tests added for the
   refactored entry points so cross-domain interaction is observable
   (e.g., `spawn_pty` emits `pty-data` events; `start_agent_watcher`
   emits `agent-tool-call` after detecting a transcript line).
8. **Sequencing contract** is documented in §5 of this spec — PR-B
   will reference §5 as its consumer-side contract.

## Non-goals

1. **No new `[[bin]]` target.** PR-A is purely a library refactor.
   PR-B adds `[[bin]] vimeflow-backend` along with the IPC protocol.
2. **No IPC protocol design.** The wire format (length-prefix JSON,
   LSP-style per Decision #4) is fixed but not implemented here. PR-B
   builds `runtime/ipc.rs` against the `BackendState` API this PR ships.
3. **No frontend changes.** All TypeScript stays on `@tauri-apps/api`.
   PR-C rewires the frontend services. The renderer side of the
   migration sees nothing from PR-A.
4. **No Electron.** No Electron dependencies, no `electron/` directory,
   no `electron:dev` script. PR-D introduces the shell.
5. **No `src-tauri/` rename.** Even though the directory will misname
   itself once Tauri is gone, renaming is mechanically large and
   blame-noisy; deferred to a follow-up PR after `dev → main` merges.
6. **No Cargo dependency removal.** `tauri = "..."` stays in
   `Cargo.toml` because the `TauriEventSink` adapter and the
   `#[tauri::command]` wrapper functions still depend on it. PR-D
   removes the dep.
7. **No CI workflow changes.** `tauri-build.yml` keeps building Tauri.
   PR-D swaps the workflow.
8. **No `e2e-test` Cargo feature changes.** Feature stays library-only.
   PR-B will reference it from the new bin's `required-features`.
9. **No agent-adapter behavior changes.** Trait shape changes
   (drop `<R: Runtime>`) but every existing behavior — detection
   polling, transcript tailing, test-run emission — is preserved
   byte-identically.
10. **No event ordering changes.** The PTY-data-listener-before-spawn
    invariant and the test-run-listener-before-watcher-start invariant
    are preserved as-is. §3 calls them out explicitly in the parity
    test list.

## Decisions

| #   | Decision                                                                                              | Rationale                                                                                                                                                                                                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Four separate specs (A/B/C/D), one per PR                                                             | User-picked output shape. Each spec ships its own implementation plan via `superpowers:writing-plans`; the migration roadmap doc (the original plan) becomes the cross-spec index.                                                                                                                                                                    |
| 2   | Long-lived `dev` integration branch; merge to `main` once when all four PRs are green                 | User-proposed rollback strategy. Avoids any half-migrated state on `main`. Reverting the final `dev → main` merge is the rollback. PRs A-D each PR against `dev`, not `main`.                                                                                                                                                                         |
| 3   | Motivation: WebView consistency + WebKit2GTK FPS fix + ecosystem                                      | All three captured. The WebKit2GTK FPS issue is the most user-visible driver and the reason to spend installer-size cost.                                                                                                                                                                                                                             |
| 4   | IPC framing: length-prefix JSON (LSP-style)                                                           | Locked here even though PR-B implements it. Survives stray stdout writes; bounded per-frame corruption. Used by every production stdio protocol (LSP, DAP). Binary PTY payload type deferred to v2 (profile first).                                                                                                                                   |
| 5   | `BackendState` is a single consolidated struct with per-domain fields, not split objects              | Ousterhout deep module: external callers see business methods, not raw `Arc<Mutex<...>>` access. Aligns with `rules/common/design-philosophy.md`.                                                                                                                                                                                                     |
| 6   | `EventSink` is generic `emit_json` + typed convenience helpers                                        | Compile-time correctness via the typed helpers; one trait surface to mock; new events don't require touching the trait definition.                                                                                                                                                                                                                    |
| 7   | `TauriEventSink` is an adapter struct wrapping `AppHandle`                                            | `tauri::AppHandle` lives in exactly one file (`runtime/tauri_bridge.rs`). PR-D deletes the file as the mechanical Tauri-removal step.                                                                                                                                                                                                                 |
| 8   | Defer the `vimeflow-backend` bin target to PR-B                                                       | PR-A's blast radius stays library-only. PR-B's `Cargo.toml` adds `[[bin]]` + `required-features = ["e2e-test"]` propagation.                                                                                                                                                                                                                          |
| 9   | Per-domain locks on `BackendState` (preserve today's lock topology); not one BackendState-wide RwLock | Five rounds of compose-pressure testing (5a/5b/5c-1/5c-2/cycles) have validated the per-domain locks. A single RwLock would introduce cross-domain blocking (PTY-data hot path vs git-status reader) and mixes `std::sync` (sync) with `tokio::sync` (async) semantics. Deep module argument applies to the _interface_ layer, not the lock topology. |
| 10  | Sequencing contract is §5 of this spec (not a separate doc)                                           | Keeps the contract co-located with the surface that ships it. PR-B reads §5; if §5 changes mid-PR-A, PR-B's spec adjusts.                                                                                                                                                                                                                             |
| 11  | PR-A preserves every event name, payload serde shape, and command name verbatim                       | The behavior contract is "renderer can't tell the difference". PR-B's verify step runs both Tauri-bound and EventSink-bound paths against the same fixture and asserts byte-identical event streams.                                                                                                                                                  |
| 12  | `AgentAdapter<R: tauri::Runtime>` becomes non-generic `AgentAdapter`                                  | The `R` parameter only existed because trait methods took `&AppHandle<R>`. Once event emission goes through `state.events: Arc<dyn EventSink>`, the runtime parameter has no role. Drops a generic from every concrete adapter signature.                                                                                                             |

## §1 Architecture — module decomposition + file-level scope

### Module shape

```
src-tauri/src/
├── lib.rs                              # MODIFIED — creates BackendState in setup hook, registers thin command wrappers
├── main.rs                             # UNTOUCHED — still calls lib::run()
├── runtime/                            # NEW directory
│   ├── mod.rs                          # NEW — public re-exports
│   ├── state.rs                        # NEW — BackendState struct + methods (spawn_pty, list_sessions, ...)
│   ├── event_sink.rs                   # NEW — EventSink trait + typed helpers + FakeEventSink (#[cfg(test)])
│   └── tauri_bridge.rs                 # NEW — TauriEventSink adapter; the only file mentioning tauri::AppHandle in runtime/
├── terminal/
│   ├── mod.rs                          # MODIFIED — re-export state types unchanged
│   └── commands.rs                     # MODIFIED — every #[tauri::command] collapses to one-line forwarder to BackendState
├── agent/
│   ├── mod.rs                          # MODIFIED — module re-exports unchanged
│   ├── commands.rs                     # MODIFIED — thin Tauri wrappers around BackendState methods
│   ├── detector.rs                     # UNTOUCHED — pure detection logic, no Tauri surface today
│   ├── types.rs                        # UNTOUCHED — ts-rs payload structs
│   └── adapter/                        # MODIFIED — AgentAdapter trait drops <R: Runtime> generic
│       ├── mod.rs                      # MODIFIED — trait signature change
│       ├── base/                       # MODIFIED — base helpers take Arc<BackendState>
│       │   ├── diagnostics.rs          # UNTOUCHED — diagnostic helpers
│       │   ├── path_security.rs        # UNTOUCHED — path validation
│       │   ├── watcher_runtime.rs      # MODIFIED — emit via state.events; drop AppHandle<R>
│       │   └── transcript_state.rs     # MODIFIED — no AppHandle field
│       ├── claude_code/                # MODIFIED — concrete adapter de-generic; transcript + test_runners/emitter emit via state.events
│       └── codex/                      # MODIFIED — concrete adapter de-generic; transcript emits via state.events
├── filesystem/
│   ├── list.rs                         # MODIFIED — thin Tauri wrapper
│   ├── read.rs                         # MODIFIED — thin Tauri wrapper
│   ├── write.rs                        # MODIFIED — thin Tauri wrapper
│   └── ...                             # rest untouched
├── git/
│   ├── mod.rs                          # MODIFIED — thin Tauri wrappers
│   ├── status.rs                       # UNTOUCHED — pure data layer
│   ├── diff.rs                         # UNTOUCHED — pure data layer
│   └── watcher.rs                      # MODIFIED — emits via state.events
└── debug.rs                            # UNTOUCHED
```

### New files

| File                                    | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                          | LOC  |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------ | --- |
| `src-tauri/src/runtime/mod.rs`          | Re-exports: `pub use state::BackendState; pub use event_sink::EventSink; pub use tauri_bridge::TauriEventSink;` and behind `#[cfg(any(test, feature = "e2e-test"))] pub use event_sink::FakeEventSink;` — the cfg-gate matches the definition so production builds don't drag the fake into the public surface.                                                                                                                  | ~8   |
| `src-tauri/src/runtime/state.rs`        | `BackendState` struct with five per-domain fields (`pty`, `sessions`, `agents`, `transcripts`, `git`) + `events: Arc<dyn EventSink>`. Constructors: `new(app_data_dir, events)`, `with_fake_sink(...)` (test-only). Business methods: one per existing `#[tauri::command]` (19 today + 1 e2e). Each method body is what the corresponding command function used to contain, minus the `tauri::State<'_, T>` argument extraction. | ~450 |
| `src-tauri/src/runtime/event_sink.rs`   | `pub trait EventSink: Send + Sync + 'static`. Methods: `emit_json` (only required) + ~10 typed helpers (`emit_pty_data`, `emit_pty_exit`, `emit_pty_error`, `emit_agent_detected`, `emit_agent_disconnected`, `emit_agent_status`, `emit_agent_tool_call`, `emit_agent_turn`, `emit_test_run`, `emit_git_status_changed`). `FakeEventSink` test fixture in the same file behind `#[cfg(any(test, feature = "e2e-test"))]`.       | ~180 |
| `src-tauri/src/runtime/tauri_bridge.rs` | `pub struct TauriEventSink { handle: tauri::AppHandle }` with `pub fn new(handle: tauri::AppHandle) -> Self`. `impl EventSink for TauriEventSink { fn emit_json(...) { self.handle.emit(event, payload).map_err(                                                                                                                                                                                                                 | e    | e.to_string()) } }`. The only file in `runtime/`that imports`tauri::\*`. PR-D deletes this file. | ~30 |

### Modified files

| File                                                              | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | LOC delta    |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `src-tauri/src/lib.rs`                                            | Replace the five `.manage(...)` calls with a single `app.manage(Arc::new(BackendState::new(app_data_dir, Arc::new(TauriEventSink::new(app.handle().clone())))))`. The `#[tauri::command]` functions registered in `invoke_handler!` come from `terminal/commands.rs` etc. and now extract `tauri::State<'_, Arc<BackendState>>` and forward to `state.spawn_pty(...)`. The graceful-exit `RunEvent::ExitRequested` handler invokes `state.shutdown()` instead of the inline cache-wipe code. | +~25, -~30   |
| `src-tauri/src/terminal/commands.rs`                              | Replace 19 multi-statement command bodies with 19 one-liners (`state.spawn_pty(req).await`, etc.). Move the original bodies into `BackendState::spawn_pty` etc. in `runtime/state.rs`. PTY event emitter calls (`app.emit("pty-data", ...)`) become `state.events.emit_pty_data(...)`.                                                                                                                                                                                                       | +~30, -~250  |
| `src-tauri/src/agent/adapter/mod.rs`                              | Drop `<R: tauri::Runtime>` from the `AgentAdapter` trait. Methods that took `&AppHandle<R>` now take `&Arc<BackendState>`. Concrete adapters update their impls.                                                                                                                                                                                                                                                                                                                             | +~10, -~30   |
| `src-tauri/src/agent/adapter/claude_code/mod.rs`                  | Drop runtime generic. `pub struct ClaudeCodeAdapter` (was `<R>`). Constructor takes `Arc<BackendState>` (stored for later event emission) instead of `AppHandle<R>`.                                                                                                                                                                                                                                                                                                                         | +~15, -~25   |
| `src-tauri/src/agent/adapter/codex/mod.rs`                        | Same shape as claude_code.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | +~15, -~25   |
| `src-tauri/src/agent/adapter/base/watcher_runtime.rs`             | `start_agent_watcher`'s notify-spawned callback emits via `state.events.emit_agent_status(...)` instead of `handle.emit("agent-status", ...)`. The `start_agent_watcher` Tauri command body becomes a one-liner forwarding to `BackendState::start_agent_watcher`.                                                                                                                                                                                                                           | +~20, -~40   |
| `src-tauri/src/agent/adapter/base/transcript_state.rs`            | Transcript tailer holds `Arc<BackendState>` (was `AppHandle<R>`). `emit_agent_tool_call` / `emit_agent_turn` calls go through `state.events`.                                                                                                                                                                                                                                                                                                                                                | +~15, -~30   |
| `src-tauri/src/agent/adapter/claude_code/transcript.rs`           | Replace `AppHandle<R>` field with `Arc<BackendState>`. Emit routes change.                                                                                                                                                                                                                                                                                                                                                                                                                   | +~10, -~20   |
| `src-tauri/src/agent/adapter/codex/transcript.rs`                 | Same as claude_code.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | +~10, -~20   |
| `src-tauri/src/agent/adapter/claude_code/test_runners/emitter.rs` | `test-run` event emission swaps from `AppHandle` to `state.events.emit_test_run(...)`.                                                                                                                                                                                                                                                                                                                                                                                                       | +~5, -~15    |
| `src-tauri/src/agent/commands.rs`                                 | Thin Tauri wrappers. `start_agent_watcher`, `stop_agent_watcher`, `detect_agent_in_session` each becomes a one-liner.                                                                                                                                                                                                                                                                                                                                                                        | +~15, -~50   |
| `src-tauri/src/filesystem/list.rs`                                | Thin Tauri wrapper around `BackendState::list_dir`. Existing logic moves into the method body.                                                                                                                                                                                                                                                                                                                                                                                               | +~5, -~30    |
| `src-tauri/src/filesystem/read.rs`                                | Same pattern. Thin wrapper.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | +~5, -~25    |
| `src-tauri/src/filesystem/write.rs`                               | Same pattern. Thin wrapper.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | +~5, -~25    |
| `src-tauri/src/git/mod.rs`                                        | `git_status`, `git_branch`, `get_git_diff` become thin wrappers. Bodies move to `BackendState::git_status` etc. No data-layer changes (status.rs, diff.rs untouched — those are pure functions BackendState calls into).                                                                                                                                                                                                                                                                     | +~15, -~80   |
| `src-tauri/src/git/watcher.rs`                                    | `start_git_watcher` notify-watcher emits via `state.events.emit_git_status_changed(...)`. Tauri wrapper functions for `start_git_watcher` / `stop_git_watcher` become one-liners. **`GitStatusChangedPayload` is promoted from module-private `struct` to `pub struct`** so `runtime/event_sink.rs` can import it (the type itself is unchanged).                                                                                                                                            | +~15, -~50   |
| `src-tauri/Cargo.toml`                                            | Add `serde_json` if not already a direct dep (it's likely transitive today via Tauri). No Tauri changes — `tauri` stays. No new `[[bin]]` target (Decision #8).                                                                                                                                                                                                                                                                                                                              | +~2, -~0     |
| Various `*.test` Rust unit tests                                  | Tests that today either `#[cfg(target_os = "...")]`-gate or skip because of `mock_app()` complexity are rewritten to construct `BackendState::with_fake_sink(...)` and assert recorded events. New tests for the parity contract (see §3).                                                                                                                                                                                                                                                   | +~400, -~100 |

### Files NOT touched

| File / module                                                           | Why                                                                                                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src-tauri/src/main.rs`                                                 | Still just `vimeflow_lib::run()`. PR-D rewrites it to `vimeflow_lib::run_tauri()` (transitional) and PR-D's final state deletes the file entirely.                 |
| `src-tauri/src/agent/jsonl.rs`                                          | Pure parsing module. No Tauri references today; no changes needed.                                                                                                 |
| `src-tauri/src/agent/types.rs`                                          | ts-rs `#[derive(TS)]` types. Serde shapes don't change; bindings stay stable.                                                                                      |
| `src-tauri/src/git/status.rs`, `diff.rs`                                | Pure data-layer functions. `BackendState` methods call them; the functions themselves don't know about Tauri or EventSink.                                         |
| `src-tauri/src/terminal/state.rs`, `cache.rs`, `bridge.rs`, `events.rs` | Per-domain state implementations. `BackendState::pty` holds the existing `PtyState`; the internals are untouched.                                                  |
| `src-tauri/src/terminal/test_commands.rs`                               | The `list_active_pty_sessions` E2E command stays behind `#[cfg(feature = "e2e-test")]` and becomes a thin wrapper around `BackendState::list_active_pty_sessions`. |
| `src/bindings/*.ts`                                                     | Generated by `ts-rs` from `#[derive(TS)]` types. PR-A doesn't change any of those types; regenerate is a no-op. The `verify:bindings` CI check stays green.        |
| `src/**` (the entire frontend)                                          | PR-C territory.                                                                                                                                                    |
| `.github/workflows/*`                                                   | PR-D territory.                                                                                                                                                    |
| `tests/e2e/**`                                                          | PR-D territory.                                                                                                                                                    |

### `BackendState` skeleton (full body in §2)

```rust
pub struct BackendState {
    pub(crate) pty: PtyState,
    pub(crate) sessions: Arc<SessionCache>,
    pub(crate) agents: AgentWatcherState,
    pub(crate) transcripts: TranscriptState,
    pub(crate) git: GitWatcherState,
    pub(crate) events: Arc<dyn EventSink>,
}
```

The five domain fields are `pub(crate)` so other modules under
`src-tauri/src/` can still reach them where the existing code paths
require it (e.g., a watcher callback that needs `sessions` to look up
a cwd). External callers (the Tauri command wrappers, future PR-B IPC
router) see only the business methods.

### `EventSink` trait skeleton (full body in §2)

```rust
pub trait EventSink: Send + Sync + 'static {
    fn emit_json(
        &self,
        event: &str,
        payload: serde_json::Value,
    ) -> Result<(), String>;

    // Typed convenience helpers — default impls forward through emit_json.
    fn emit_pty_data(&self, payload: &PtyDataEvent) -> Result<(), String> { ... }
    fn emit_pty_exit(&self, payload: &PtyExitEvent) -> Result<(), String> { ... }
    fn emit_agent_status(&self, payload: &Value) -> Result<(), String> { ... }
    fn emit_agent_tool_call(&self, payload: &AgentToolCallEvent) -> Result<(), String> { ... }
    fn emit_test_run(&self, payload: &TestRunSnapshot) -> Result<(), String> { ... }
    fn emit_git_status_changed(&self, payload: &GitStatusChangedPayload) -> Result<(), String> { ... }
    // ... one per existing event in src/bindings/event-names
}
```

The typed helpers default to `self.emit_json(name, serde_json::to_value(payload).unwrap())`. Concrete implementations override `emit_json` only; the typed surface comes for free. Naming: `emit_<event_snake_case>` matches the event name on the wire one-to-one — grep-friendly.

### Net file count + LOC

- **New:** 4 files (`runtime/{mod,state,event_sink,tauri_bridge}.rs`), ~665 LOC.
- **Modified:** ~16 files (`lib.rs`, `terminal/commands.rs`, `agent/**`, `filesystem/{list,read,write}.rs`, `git/{mod,watcher}.rs`, `Cargo.toml`, plus test files), ~+612 / -~840 net.
- **Total:** ~+1277 / -~840, ~2120 LOC across ~20 files.

Larger than 5c-2 (~1000 LOC) but the rust-only blast radius keeps the reviewer surface narrower than the original maneuver-plan one-PR estimate. No frontend, no Electron, no CI, no docs/specs outside this one — every file in the diff is `src-tauri/src/` or its tests.

## §2 Rust APIs

### `event_sink.rs` — trait + typed helpers + fake

```rust
// src-tauri/src/runtime/event_sink.rs
use serde::Serialize;
use serde_json::Value;
use std::sync::{Arc, Mutex};

use crate::agent::adapter::claude_code::test_runners::types::TestRunSnapshot;
use crate::agent::types::{
    AgentDetectedEvent, AgentDisconnectedEvent, AgentToolCallEvent,
    AgentTurnEvent,
};
use crate::git::watcher::GitStatusChangedPayload;
use crate::terminal::types::{PtyDataEvent, PtyErrorEvent, PtyExitEvent};

/// Runtime-neutral event emission. Concrete impls:
///   - `TauriEventSink` (production today; defined in `tauri_bridge.rs`)
///   - `StdoutEventSink` (PR-B; defined in `runtime/ipc.rs`)
///   - `FakeEventSink` (tests; defined below behind #[cfg])
pub trait EventSink: Send + Sync + 'static {
    /// Emit a JSON payload under the given event name. The only required
    /// method; typed helpers default-implement on top.
    fn emit_json(&self, event: &str, payload: Value) -> Result<(), String>;

    // Typed convenience helpers. Default impls forward via emit_json so
    // implementers only override the one method. Each helper's name
    // mirrors the on-wire event name (snake_case → kebab-case via the
    // string literal) so grep'ing `emit_pty_data` finds the same call
    // sites that today grep as `"pty-data"`.

    fn emit_pty_data(&self, payload: &PtyDataEvent) -> Result<(), String> {
        self.emit_json("pty-data", serialize(payload)?)
    }

    fn emit_pty_exit(&self, payload: &PtyExitEvent) -> Result<(), String> {
        self.emit_json("pty-exit", serialize(payload)?)
    }

    fn emit_pty_error(&self, payload: &PtyErrorEvent) -> Result<(), String> {
        self.emit_json("pty-error", serialize(payload)?)
    }

    fn emit_agent_detected(&self, payload: &AgentDetectedEvent) -> Result<(), String> {
        self.emit_json("agent-detected", serialize(payload)?)
    }

    fn emit_agent_disconnected(&self, payload: &AgentDisconnectedEvent) -> Result<(), String> {
        self.emit_json("agent-disconnected", serialize(payload)?)
    }

    fn emit_agent_status(&self, payload: &Value) -> Result<(), String> {
        // Status payloads come from external statusline-bridge JSON and
        // are not strongly typed at the Rust layer. Stays Value-typed.
        self.emit_json("agent-status", payload.clone())
    }

    fn emit_agent_tool_call(&self, payload: &AgentToolCallEvent) -> Result<(), String> {
        self.emit_json("agent-tool-call", serialize(payload)?)
    }

    fn emit_agent_turn(&self, payload: &AgentTurnEvent) -> Result<(), String> {
        self.emit_json("agent-turn", serialize(payload)?)
    }

    fn emit_test_run(&self, payload: &TestRunSnapshot) -> Result<(), String> {
        self.emit_json("test-run", serialize(payload)?)
    }

    fn emit_git_status_changed(&self, payload: &GitStatusChangedPayload) -> Result<(), String> {
        self.emit_json("git-status-changed", serialize(payload)?)
    }
}

#[inline]
fn serialize<T: Serialize>(value: &T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|err| format!("event serialize: {err}"))
}

/// Test-only fake sink. Records every emit for assertion in unit tests.
/// Available behind `#[cfg(any(test, feature = "e2e-test"))]` so the
/// E2E build can use it for cache-wipe / injection scenarios too.
#[cfg(any(test, feature = "e2e-test"))]
pub struct FakeEventSink {
    recorded: Mutex<Vec<(String, Value)>>,
}

#[cfg(any(test, feature = "e2e-test"))]
impl FakeEventSink {
    pub fn new() -> Arc<Self> {
        Arc::new(Self { recorded: Mutex::new(Vec::new()) })
    }

    /// Snapshot of every event emitted so far, in order. Useful in
    /// parity tests: drive the BackendState path, then assert the
    /// recorded sequence matches the expected event timeline.
    pub fn recorded(&self) -> Vec<(String, Value)> {
        self.recorded.lock().expect("FakeEventSink poisoned").clone()
    }

    /// Convenience: count events matching a given name.
    pub fn count(&self, event: &str) -> usize {
        self.recorded()
            .iter()
            .filter(|(name, _)| name == event)
            .count()
    }
}

#[cfg(any(test, feature = "e2e-test"))]
impl EventSink for FakeEventSink {
    fn emit_json(&self, event: &str, payload: Value) -> Result<(), String> {
        self.recorded
            .lock()
            .map_err(|err| format!("FakeEventSink poisoned: {err}"))?
            .push((event.to_string(), payload));
        Ok(())
    }
}
```

### `tauri_bridge.rs` — production adapter

```rust
// src-tauri/src/runtime/tauri_bridge.rs
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use super::event_sink::EventSink;

/// Adapter that bridges the runtime-neutral `EventSink` trait to
/// Tauri's `AppHandle::emit`. This is the ONLY file in `src-tauri/src/runtime/`
/// that imports `tauri::*`. PR-D deletes this file as the mechanical
/// final step of the Tauri removal.
pub struct TauriEventSink {
    handle: AppHandle,
}

impl TauriEventSink {
    pub fn new(handle: AppHandle) -> Self {
        Self { handle }
    }
}

impl EventSink for TauriEventSink {
    fn emit_json(&self, event: &str, payload: Value) -> Result<(), String> {
        self.handle
            .emit(event, payload)
            .map_err(|err| format!("tauri emit {event}: {err}"))
    }
}
```

### `state.rs` — BackendState (skeleton; full methods migrate from today's command bodies)

```rust
// src-tauri/src/runtime/state.rs
use std::path::PathBuf;
use std::sync::Arc;

use crate::agent::watcher::AgentWatcherState;
use crate::agent::transcript_state::TranscriptState;
use crate::git::watcher::GitWatcherState;
use crate::terminal::cache::SessionCache;
use crate::terminal::state::PtyState;
use super::event_sink::EventSink;

/// Consolidated backend state. Owns the five per-domain state types
/// previously managed by Tauri's `manage<T>` mechanism, plus the
/// event sink. Per-domain locks live inside each domain's type
/// (`PtyState` already wraps `Arc<Mutex<...>>`; `AgentWatcherState`
/// already wraps `Arc<RwLock<...>>`; etc.) — `BackendState` is just
/// the carrier. See Decision #9 for the lock-strategy rationale.
///
/// Construction: production code calls `BackendState::new(app_data_dir,
/// Arc::new(TauriEventSink::new(handle)))` from Tauri's setup hook.
/// Tests call `BackendState::with_fake_sink(...)` to skip Tauri.
pub struct BackendState {
    pub(crate) pty: PtyState,
    pub(crate) sessions: Arc<SessionCache>,
    pub(crate) agents: AgentWatcherState,
    pub(crate) transcripts: TranscriptState,
    pub(crate) git: GitWatcherState,
    pub(crate) events: Arc<dyn EventSink>,
}

impl BackendState {
    /// Production constructor. `app_data_dir` is `tauri::Manager::path()
    /// .app_data_dir()` today (PR-B will pass `app.getPath('userData')`
    /// from Electron). `events` is the runtime-specific sink.
    ///
    /// Uses the existing `SessionCache::load_or_recover(cache_path)`
    /// helper. Cache file path is derived inline as
    /// `app_data_dir.join("sessions.json")` — the same expression
    /// `lib.rs` uses today (line 37 in the current main). No new
    /// `SessionCache` APIs introduced.
    pub fn new(app_data_dir: PathBuf, events: Arc<dyn EventSink>) -> Self {
        let cache_path = app_data_dir.join("sessions.json");
        let sessions = Arc::new(SessionCache::load_or_recover(cache_path));
        Self {
            pty: PtyState::new(),
            sessions,
            agents: AgentWatcherState::new(),
            transcripts: TranscriptState::new(),
            git: GitWatcherState::new(),
            events,
        }
    }

    /// Test-only constructor. Uses a `tempfile::TempDir` for the
    /// cache so on-disk state never bleeds between tests, plus a
    /// `FakeEventSink`. Returns `(state, fake_sink, temp_dir)` — the
    /// caller MUST hold `temp_dir` for the lifetime of the state, or
    /// `TempDir`'s `Drop` removes the cache file out from under the
    /// running test. (No cfg-gated `_temp_dir` field on `BackendState`
    /// itself — keeping the lifetime explicit at the call site is
    /// less surprising than a hidden field.)
    #[cfg(any(test, feature = "e2e-test"))]
    pub fn with_fake_sink() -> (
        Arc<Self>,
        Arc<super::event_sink::FakeEventSink>,
        tempfile::TempDir,
    ) {
        let temp_dir = tempfile::tempdir().expect("temp dir for test BackendState");
        let cache_path = temp_dir.path().join("sessions.json");
        let sink = super::event_sink::FakeEventSink::new();
        let events: Arc<dyn EventSink> = sink.clone();
        let state = Arc::new(Self {
            pty: PtyState::new(),
            sessions: Arc::new(SessionCache::load_or_recover(cache_path)),
            agents: AgentWatcherState::new(),
            transcripts: TranscriptState::new(),
            git: GitWatcherState::new(),
            events,
        });
        (state, sink, temp_dir)
    }

    /// Graceful shutdown. Clears the session cache so a clean exit
    /// followed by a fresh launch doesn't see ghost-Exited tabs. This
    /// is exactly what today's `RunEvent::ExitRequested` handler does
    /// inline in `lib.rs` via `SessionCache::clear_all()`. PR-D moves
    /// the call site from Tauri to Electron's `before-quit`; the
    /// method itself is runtime-neutral. Errors are logged at warn
    /// level — a clear-failure shouldn't block shutdown.
    pub fn shutdown(&self) {
        if let Err(err) = self.sessions.clear_all() {
            eprintln!("BackendState::shutdown: cache clear failed: {err}");
        }
    }

    // --- Business methods ---
    //
    // One method per existing #[tauri::command]. Each body is what the
    // corresponding command function used to contain, minus the
    // `tauri::State<'_, T>` arg extraction. Examples below; the
    // implementation plan lists all 19 + 1 e2e-test.

    pub async fn spawn_pty(
        self: &Arc<Self>,
        request: SpawnPtyRequest,
    ) -> Result<PtySession, String> {
        // Body migrated verbatim from terminal/commands.rs::spawn_pty.
        // The only changes are:
        //  1. Drop the `state: tauri::State<'_, PtyState>` and
        //     `app: AppHandle` arguments — read from `self.pty` and
        //     `self.events` instead.
        //  2. Replace `app.emit("pty-data", ...)` calls with
        //     `self.events.emit_pty_data(...)`.
        //  3. Replace `app.state::<Arc<SessionCache>>().inner()` with
        //     `self.sessions.clone()`.
        // Everything else (cache mutation order, lock acquisition,
        // bridge wiring, tombstone-first cleanup) is byte-identical.
        crate::terminal::pty::spawn_pty_inner(
            &self.pty,
            self.sessions.clone(),
            self.events.clone(),
            request,
        )
        .await
    }

    pub fn list_sessions(&self) -> Vec<SessionInfo> {
        self.sessions.list()
    }

    // ... write_pty, resize_pty, kill_pty, set_active_session,
    // reorder_sessions, update_session_cwd, detect_agent_in_session,
    // start_agent_watcher, stop_agent_watcher, list_dir, read_file,
    // write_file, git_status, git_branch, get_git_diff,
    // start_git_watcher, stop_git_watcher — implementation plan lists
    // each method's body migration source explicitly.
}
```

### Refactor pattern: a representative `#[tauri::command]` collapse

**Before (today's `terminal/commands.rs::spawn_pty`):**

```rust
#[tauri::command]
pub async fn spawn_pty(
    app: tauri::AppHandle,
    pty_state: tauri::State<'_, PtyState>,
    cache_state: tauri::State<'_, Arc<SessionCache>>,
    request: SpawnPtyRequest,
) -> Result<PtySession, String> {
    // ~70 lines of: spawn the PTY, wire up the read loop, push events
    // via `app.emit("pty-data", payload)`, register in cache, etc.
}
```

**After (PR-A):**

```rust
#[tauri::command]
pub async fn spawn_pty(
    state: tauri::State<'_, Arc<BackendState>>,
    request: SpawnPtyRequest,
) -> Result<PtySession, String> {
    state.spawn_pty(request).await
}
```

The 70 lines migrate verbatim into `BackendState::spawn_pty` (called via the new `crate::terminal::pty::spawn_pty_inner` helper that takes the three pieces of state as explicit parameters). The shape of every other Tauri command in the registry follows this template.

### Refactor pattern: replacing `app.emit` with `state.events.emit_*`

**Before (`terminal/commands.rs` inside the read-loop):**

```rust
let _ = app.emit("pty-data", PtyDataEvent {
    session_id: session_id.clone(),
    data: chunk_string,
    offset_start: prior_total,
    byte_len: bytes_read,
});
```

**After (PR-A):**

```rust
let _ = events.emit_pty_data(&PtyDataEvent {
    session_id: session_id.clone(),
    data: chunk_string,
    offset_start: prior_total,
    byte_len: bytes_read,
});
```

`events: Arc<dyn EventSink>` is captured by the spawned task as a cheap `Arc::clone` of `self.events` — same shape as `app: AppHandle` was captured before. **One added allocation per emit:** the typed-helper default impl goes through `serde_json::to_value(...)`, which constructs a `serde_json::Value` tree on the heap. Tauri's `AppHandle::emit` likewise serializes the payload internally, so the _net_ allocation cost on the PTY-data hot path is approximately a wash — but it is NOT zero. PR-B's binary-payload variant (deferred per Decision #4) is the path to a zero-allocation hot path when profiling justifies it.

### Refactor pattern: agent adapter de-generic (constructor-store ownership)

**Ownership decision.** Concrete adapters hold `Arc<BackendState>` as a
field (set at construction time via `for_attach(...)`); trait method
signatures DON'T take state as a parameter. This matches today's
lifetime — `for_attach` already returns a fresh `Arc<dyn AgentAdapter>`
per session attach, so handing it the `Arc<BackendState>` once at
construction is the natural fit. No cycle: `BackendState` does not hold
adapters back; the orchestrator owns the `Arc<dyn AgentAdapter>`.

**Before (`agent/adapter/mod.rs`):**

```rust
pub trait AgentAdapter<R: tauri::Runtime>: Send + Sync + 'static {
    fn detect(&self, app: &AppHandle<R>, info: &SessionInfo) -> Result<...>;
    fn start_watcher(&self, app: &AppHandle<R>, info: &SessionInfo) -> Result<...>;
    fn stop_watcher(&self, app: &AppHandle<R>, session_id: &str) -> Result<...>;
}

impl<R: tauri::Runtime> dyn AgentAdapter<R> {
    pub fn for_attach(
        agent_type: AgentType,
        pid: u32,
        pty_start: PtyStartId,
    ) -> Result<Arc<dyn AgentAdapter<R>>, String> {
        match agent_type {
            AgentType::ClaudeCode => Ok(Arc::new(ClaudeCodeAdapter)),
            AgentType::Codex => Ok(Arc::new(CodexAdapter::new(pid, pty_start))),
            // ...
        }
    }
}
```

**After (PR-A):**

```rust
pub trait AgentAdapter: Send + Sync + 'static {
    fn detect(&self, info: &SessionInfo) -> Result<...>;
    fn start_watcher(&self, info: &SessionInfo) -> Result<...>;
    fn stop_watcher(&self, session_id: &str) -> Result<...>;
}

impl dyn AgentAdapter {
    pub fn for_attach(
        state: Arc<BackendState>,
        agent_type: AgentType,
        pid: u32,
        pty_start: PtyStartId,
    ) -> Result<Arc<dyn AgentAdapter>, String> {
        match agent_type {
            AgentType::ClaudeCode => Ok(Arc::new(ClaudeCodeAdapter::new(state))),
            AgentType::Codex => Ok(Arc::new(CodexAdapter::new(state, pid, pty_start))),
            // ...
        }
    }
}

pub struct ClaudeCodeAdapter { state: Arc<BackendState> }
impl ClaudeCodeAdapter {
    pub fn new(state: Arc<BackendState>) -> Self { Self { state } }
}
impl AgentAdapter for ClaudeCodeAdapter {
    fn detect(&self, info: &SessionInfo) -> Result<...> {
        // Use self.state.events.emit_agent_detected(...) etc.
    }
    // ...
}
```

Every `<R>` reference in the entire `agent/adapter/` subtree disappears in
one go. Concrete adapters (`ClaudeCodeAdapter`, `CodexAdapter`) become
non-generic structs that hold `Arc<BackendState>` as their event-emission
handle. Trait method signatures lose the state parameter — the
orchestrator in `agent/commands.rs` just calls `adapter.detect(info)` etc.

### Refactor pattern: `lib.rs` setup hook

**Before (relevant slice of today's `lib.rs`):**

```rust
.setup(|app| {
    let app_data_dir = app.path().app_data_dir().map_err(|e| ...)?;
    let cache = Arc::new(SessionCache::load_or_default(&app_data_dir));
    app.manage(cache);
    Ok(())
})
.manage(PtyState::new())
.manage(AgentWatcherState::new())
.manage(TranscriptState::new())
.manage(GitWatcherState::new());
```

**After (PR-A):**

```rust
.setup(|app| {
    let app_data_dir = app.path().app_data_dir().map_err(|e| ...)?;
    let sink: Arc<dyn EventSink> = Arc::new(TauriEventSink::new(app.handle().clone()));
    let state = Arc::new(BackendState::new(app_data_dir, sink));
    app.manage(state);
    Ok(())
})
// no more individual .manage() calls — BackendState carries all five domains.
```

The graceful-exit `RunEvent::ExitRequested` handler changes from inline cache-wipe code to:

```rust
if let tauri::RunEvent::ExitRequested { .. } = event {
    if let Some(state) = handle.try_state::<Arc<BackendState>>() {
        state.shutdown();
    }
}
```

## §3 Testing approach

PR-A's behavior contract is "no observable change at the renderer". The
test strategy enforces this on three axes: command-body parity, event
ordering, and the Cargo-feature-gated E2E surface.

### Coverage targets

| File                                 | Tests                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runtime/state.rs`                   | Constructor: `BackendState::new(temp_dir, FakeEventSink::new())` succeeds; field defaults match today's `manage<T>()` defaults. `shutdown()` calls `sessions.clear_all()` (assert via a wrapped fake or by reading the cache file post-shutdown).                                                                                                                                                                       |
| `runtime/event_sink.rs`              | `FakeEventSink::emit_json` records every call with the right name + payload. Typed helpers route through `emit_json` (test by calling `emit_pty_data(...)` and asserting the recorded event name is `"pty-data"` and the payload deserializes back into `PtyDataEvent`). Concurrency: spawn N threads each calling `emit_json` and assert `recorded()` returns all N entries (no lost events under `Mutex` contention). |
| `runtime/tauri_bridge.rs`            | Skipped at unit-test level (would require a Tauri runtime). PR-A keeps the existing Tauri-bound integration tests as the proof; if those tests pass today and pass after the refactor, the bridge is correct. PR-B will add an integration test that loads a `MockRuntime` Tauri app and asserts the bridge calls `handle.emit` with the right args.                                                                    |
| `terminal/commands` (Tauri wrappers) | Existing wrapper tests that today construct `mock_app()` and call the `#[tauri::command]` function get **two** versions in PR-A: the original `mock_app` test stays (proves the Tauri wrapper still forwards correctly), and a new `BackendState::with_fake_sink()` test exercises the same body without Tauri. Both must pass — the parity is what proves PR-A didn't regress behavior.                                |
| `agent/adapter/**`                   | Same dual-test pattern. For each concrete adapter (`ClaudeCodeAdapter`, `CodexAdapter`): the existing Tauri-runtime-dependent test stays; a new `with_fake_sink` test runs the same scenario and asserts the recorded events match.                                                                                                                                                                                     |
| `git/watcher.rs`                     | `start_git_watcher` end-to-end test using a `tempfile::TempDir` git repo + `FakeEventSink`. Touch a file, wait for the notify callback, assert `git-status-changed` event recorded.                                                                                                                                                                                                                                     |
| Cross-domain parity smoke            | `spawn_pty + write_pty + kill_pty` happy path against `BackendState::with_fake_sink`. Assert the event sequence `pty-data → pty-data → pty-exit` is observable in `fake_sink.recorded()`.                                                                                                                                                                                                                               |

### Event ordering invariants

Three ordering invariants must NOT regress. Each gets a dedicated test
that drives the BackendState path against a `FakeEventSink` and asserts
the order in `recorded()`:

1. **PTY data listener attaches BEFORE the first spawn write.** Today
   this is enforced by `notifyPaneReady` + the buffer drain (5a/5b
   work). PR-A's `spawn_pty` body keeps that protocol byte-identical —
   the test asserts no `pty-data` event lands before the consumer
   side's `register_pending(ptyId)` completes.
2. **`test-run` listener registration BEFORE `start_agent_watcher`.**
   `agent_status` event today carries `test-run` updates piggy-backed
   on transcript watcher attachment. PR-A's `start_agent_watcher` body
   on `BackendState` keeps the same attachment ordering — the test
   asserts the first `test-run` event in `recorded()` arrives after
   the matching `agent-detected` event.
3. **`git-status-changed` listener registration BEFORE
   `start_git_watcher`.** Same shape as #2. New test for the parity
   contract.

### Mock strategy

- **`FakeEventSink`** is the only mock needed for non-IPC paths. It lives
  in `runtime/event_sink.rs` (Goal #2) behind `#[cfg(any(test, feature
= "e2e-test"))]` so existing `tempfile`-based integration tests can
  use it too.
- **`tempfile::TempDir`** for any test that constructs `BackendState`
  (the test constructor needs a cache path). Add `tempfile` to
  `[dev-dependencies]` if not already there — verify during
  implementation.
- **No `mock_app()` calls in new tests.** Every new test uses
  `BackendState::with_fake_sink()`. Existing `mock_app` tests stay as
  the Tauri-wrapper parity proof; they get deleted in PR-D when the
  wrappers go away.
- **Tokio runtime.** `BackendState::with_fake_sink()` doesn't spin a
  runtime; tests that exercise async methods use `#[tokio::test]` as
  they do today. No shared Tokio state across tests.

### Coverage gate

Today's gate per `rules/typescript/testing/CLAUDE.md` is ≥80% statements
on the TS side. The Rust side currently runs `cargo test` without an
explicit coverage threshold; PR-A keeps that — coverage on the new
files (`runtime/{state,event_sink,tauri_bridge}.rs`) is tracked via
`cargo test`'s default counters and reviewed during the PR.

### Pre-push gate

`cargo test` runs the full Rust suite. PR-A adds ~30-40 new test cases.
The existing Rust test count climbs from ~120 to ~155. `npm run test`
on the TypeScript side is unaffected (no `src/**` changes in this PR).

## §4 Risks & mitigations

| Risk                                                                                                                                                                                                                                                                                                                                                                                                     | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Event ordering regression in `spawn_pty`.** Today's spawn path orders things very carefully: spawn the PTY, attach the read-loop, register in cache, only THEN return so consumers can subscribe with the buffer drain protocol. Moving the body into `BackendState::spawn_pty` without preserving every line's relative order would break 5a/5b's `pendingPaneOps` invariants from the consumer side. | Code-review heuristic: the migration is "cut from `#[tauri::command]` body, paste into `BackendState` method body". No reorderings, no factoring, no abstractions added. The diff per command should be: (a) drop arg extraction, (b) replace `app.emit(...)` with `self.events.emit_*(...)`, (c) literally everything else verbatim. The parity tests in §3 catch any regression by asserting recorded event order matches a golden sequence captured from the pre-PR-A baseline. |
| **`AgentAdapter` `<R: Runtime>` removal triggers stale-test breakage.** Several tests today instantiate `NoOpAdapter` as `<NoOpAdapter as AgentAdapter<MockRuntime>>::method(...)`. The trait change drops the generic; those test call sites must update.                                                                                                                                               | Mechanical fix: search-replace `as AgentAdapter<MockRuntime>>::` → `as AgentAdapter>::` (and same for `tauri::Wry`). Implementation plan lists this as a sweep step under the agent-adapter task.                                                                                                                                                                                                                                                                                  |
| **`GitStatusChangedPayload` becoming `pub` widens the git module's exposed surface.** Today the type is module-private. The visibility change is small but worth flagging in code review so a future change doesn't unintentionally add fields and break the event contract.                                                                                                                             | `#[serde(deny_unknown_fields)]` is NOT added (would be a behavior change). The type stays exactly as-is; only its `pub` visibility changes. Documentation comment added to the type warning "this is part of the wire protocol — adding/renaming fields is a breaking change for the renderer". Same comment goes on `TestRunSnapshot` if its visibility also needs widening.                                                                                                      |
| **`FakeEventSink::recorded()` clones a `Vec<(String, Value)>` per call — could mask perf issues in tight loops.** A test that asserts on `fake_sink.recorded()` every iteration of a 10k-event loop will be O(n²) cumulative.                                                                                                                                                                            | Document the contract: `recorded()` is for end-of-test assertion, not per-iteration. For per-iteration use, expose `count(event)` (already in the design) which clones once internally — same complexity, but the test author sees the cost upfront. Add a doc-comment "WARNING: recorded() clones the full log — call once at end of test".                                                                                                                                       |
| **`Arc<dyn EventSink>` dynamic dispatch on the PTY-data hot path.** Every emit goes through a vtable. Today's `AppHandle::emit` is also a dynamic-dispatch path internally (Tauri uses `Box<dyn Manager<...>>` internally), so the net dispatch cost is similar — but a future profile-pass should validate this rather than assume.                                                                     | Defer perf measurement to PR-B's profile gate. PR-A's claim is "no NEW dynamic dispatch on the hot path"; the wash-with-AppHandle baseline is the contract. If PR-B profiling shows the trait object is a bottleneck, the v2 binary-payload variant skips it.                                                                                                                                                                                                                      |
| **`shutdown()` called twice on a graceful exit.** Tauri's `RunEvent::ExitRequested` can fire more than once on some platforms (Windows, particularly during fast Cmd+Q + relaunch). `SessionCache::clear_all()` is idempotent (clearing an empty cache is a no-op), but worth verifying with a "shutdown twice doesn't panic" test.                                                                      | New `BackendState::shutdown()` test asserts two back-to-back calls both return without panic and leave the cache empty. The underlying `clear_all()` already supports this — just lock the contract.                                                                                                                                                                                                                                                                               |
| **Test-only `tempfile::TempDir` dependency.** If `tempfile` isn't already a `[dev-dependencies]` entry, adding it pulls in a small subtree.                                                                                                                                                                                                                                                              | Verify during implementation. The `tempfile` crate is ~3 transitive deps (fastrand, rustix on Unix, windows-sys on Windows) — all dev-only. If reviewers push back on the addition, the test constructor can fall back to a manually-managed `std::env::temp_dir().join("vimeflow-test-{uuid}")` path with explicit cleanup in a `Drop` impl on a test wrapper.                                                                                                                    |

### Risk-free trade-offs (not in the table)

- **Method naming on `BackendState`.** I'm using `spawn_pty` (snake_case
  matching today's Tauri command). If the project converts to
  `spawn_pty_session` or similar in PR-B for IPC-method-name parity,
  rename in PR-B's spec — PR-A is the source of truth for the migration
  source-target.
- **Re-exporting `Arc` from `runtime/mod.rs`.** Not done — callers
  `use std::sync::Arc` directly. Doesn't change behavior.

## §5 Sequencing contract (for PR-B / PR-C / PR-D)

PR-A defines four contracts that the downstream PRs consume. Changes to
any of these mid-PR-A require updates to the consuming PR's spec
before that PR opens.

### 5.1 — Public `BackendState` API (consumed by PR-B)

PR-B's `runtime/ipc.rs` router dispatches JSON IPC requests to
`BackendState` methods. The method names, argument types, and return
types defined in §2 are the wire contract.

```rust
// PR-B will use a dispatch table of this shape:
async fn dispatch(state: &Arc<BackendState>, method: &str, params: Value) -> Result<Value, String> {
    match method {
        "spawn_pty"          => json_call!(state.spawn_pty, params),
        "write_pty"          => json_call!(state.write_pty, params),
        "resize_pty"         => json_call!(state.resize_pty, params),
        "kill_pty"           => json_call!(state.kill_pty, params),
        "list_sessions"      => json_call!(state.list_sessions, params),
        "set_active_session" => json_call!(state.set_active_session, params),
        "reorder_sessions"   => json_call!(state.reorder_sessions, params),
        "update_session_cwd" => json_call!(state.update_session_cwd, params),
        "detect_agent_in_session" => json_call!(state.detect_agent_in_session, params),
        "start_agent_watcher" => json_call!(state.start_agent_watcher, params),
        "stop_agent_watcher"  => json_call!(state.stop_agent_watcher, params),
        "list_dir"           => json_call!(state.list_dir, params),
        "read_file"          => json_call!(state.read_file, params),
        "write_file"         => json_call!(state.write_file, params),
        "git_status"         => json_call!(state.git_status, params),
        "git_branch"         => json_call!(state.git_branch, params),
        "get_git_diff"       => json_call!(state.get_git_diff, params),
        "start_git_watcher"  => json_call!(state.start_git_watcher, params),
        "stop_git_watcher"   => json_call!(state.stop_git_watcher, params),
        #[cfg(feature = "e2e-test")]
        "list_active_pty_sessions" => json_call!(state.list_active_pty_sessions, params),
        _ => Err(format!("unknown method: {method}")),
    }
}
```

PR-A guarantees:

- **Method names match command names verbatim** (one-to-one with
  today's `tauri::generate_handler![...]` entries).
- **Argument types implement `serde::Deserialize`** — they already do
  (ts-rs derives bring this for free) but PR-A must NOT change any
  `#[serde]` attribute on a request type.
- **Return types implement `serde::Serialize`** with the same shape as
  today.
- **The `e2e-test` Cargo feature stays on the library** so PR-B's bin
  inherits it via `required-features = ["e2e-test"]`.

### 5.2 — `EventSink` trait (consumed by PR-B + PR-D)

PR-B writes `StdoutEventSink` implementing `EventSink`. PR-A locks the
trait shape: `emit_json(event, payload) -> Result<(), String>` is the
only required method; the typed helpers are default-implemented and
PR-B doesn't override them.

PR-A guarantees:

- **`EventSink: Send + Sync + 'static`** — PR-B can wrap it in
  `Arc<dyn EventSink>` without further bounds.
- **`emit_json` accepts owned `Value`** so PR-B can build the IPC frame
  body directly from the passed payload without cloning.
- **Typed helpers preserve event-name strings** that match today's
  `app.emit("...", ...)` literals exactly. The strings are the wire
  protocol; PR-B writes them into `Content-Type: ...` headers and
  payload bodies verbatim.

### 5.3 — Event payload serde shapes (consumed by PR-C)

PR-C's `src/lib/backend.ts` typed listener API binds to TypeScript
types generated from the existing `#[derive(TS)]` types via `ts-rs`.
PR-A guarantees:

- **No `#[derive(TS)]` types change.** `npm run generate:bindings` is
  a no-op against PR-A's diff.
- **Event names on the wire stay byte-identical.**
- **Payload field names, types, and `#[serde(rename = "...")]`
  attributes stay byte-identical.**

### 5.4 — Tauri removal surface (consumed by PR-D)

PR-D deletes Tauri from the tree. PR-A guarantees the deletion is
**mechanical** by isolating Tauri references into named locations:

- **`src-tauri/src/runtime/tauri_bridge.rs`** — the only file in
  `src-tauri/src/runtime/` that mentions `tauri::*`. PR-D `rm`s it.
- **`#[tauri::command]` wrapper bodies** (in `terminal/commands.rs`,
  `agent/commands.rs`, `filesystem/{list,read,write}.rs`,
  `git/mod.rs`) — every one collapsed to a one-liner forwarding to
  `BackendState`. PR-D deletes these wrapper functions; `BackendState`
  is unchanged.
- **`src-tauri/src/lib.rs`** — the entry point. PR-D replaces or
  removes it.
- **`src-tauri/Cargo.toml`** — `tauri = "..."` dep removed by PR-D
  only after all the above land.

PR-A does NOT need to mark up the `#[tauri::command]` functions
specially; PR-D's `grep -rn "#\[tauri::command\]" src-tauri/src/` is
the deletion checklist.

## §6 References

- `docs/superpowers/plans/2026-05-13-electron-rust-backend-migration.md`
  — the original "one PR" maneuver plan; this spec is PR-A of the
  sliced version. The maneuver plan now serves as the migration roadmap
  / cross-spec index.
- `docs/superpowers/specs/2026-05-13-pr-b-rust-sidecar-ipc-design.md`
  (forthcoming) — consumes §5.1 + §5.2.
- `docs/superpowers/specs/2026-05-13-pr-c-frontend-backend-bridge-design.md`
  (forthcoming) — consumes §5.3.
- `docs/superpowers/specs/2026-05-13-pr-d-electron-shell-design.md`
  (forthcoming) — consumes §5.4.
- `rules/common/design-philosophy.md` — Ousterhout deep-module
  argument for the consolidated `BackendState` struct.
- `docs/reviews/patterns/async-race-conditions.md` — PTY listener
  ordering, agent watcher lifecycle. Required reading for the parity
  test author.
- `docs/reviews/patterns/pty-session-management.md` — tombstone-first
  cleanup invariant. PR-A's spawn rollback path preserves it as-is
  (no behavioral change).
- `src-tauri/src/lib.rs` (current) — source for the `setup` hook and
  the `RunEvent::ExitRequested` handler.
- `src-tauri/src/terminal/cache.rs` — source for the `SessionCache`
  API contract (`load_or_recover`, `clear_all`).

## §7 Next step after approval

After this spec is codex-reviewed (Step 8) and approved, invoke
`superpowers:writing-plans` for the PR-A implementation plan. The plan
breaks PR-A into ordered TDD tasks:

1. Add `tempfile` to `[dev-dependencies]` if absent.
2. Create `runtime/event_sink.rs` with `EventSink` trait + typed
   helpers + `FakeEventSink` (TDD: write trait + tests first; the
   typed-helper default impls fall out from the trait test).
3. Create `runtime/tauri_bridge.rs` with `TauriEventSink` adapter
   (TDD: integration test against the existing Tauri smoke tests).
4. Promote `GitStatusChangedPayload` to `pub`; verify `TestRunSnapshot`
   visibility (one-line each).
5. Create `runtime/state.rs` with the `BackendState` skeleton +
   `new` / `with_fake_sink` / `shutdown` (TDD: constructor + shutdown
   tests).
6. Migrate `terminal/commands.rs` command bodies into
   `BackendState::*` methods one-by-one (TDD: each command keeps its
   existing Tauri-wrapper test + adds a new `with_fake_sink` parity
   test).
7. Same migration for `agent/commands.rs`, `filesystem/{list,read,write}.rs`,
   `git/mod.rs`.
8. Migrate `agent/adapter/**`: drop `<R: Runtime>` generic, switch to
   constructor-store ownership.
9. Migrate watcher event emission (`agent/adapter/base/watcher_runtime.rs`,
   `git/watcher.rs`).
10. Rewrite `lib.rs`'s setup hook to build `BackendState` once and
    manage `Arc<BackendState>`.
11. Update affected unit tests sweep (replace `as AgentAdapter<MockRuntime>>::`
    with `as AgentAdapter>::`).
12. Run `cargo test`, `npm run test`, `npm run type-check`, manual
    `npm run tauri:dev` smoke. App must behave identically to today.

TDD per task: red test → green implementation → refactor → commit
behind the watermark trailers `/lifeline:upsource-review` consumes.

PR-B's spec is the next planner run.

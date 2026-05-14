# PR-B — Rust sidecar binary + IPC protocol (design spec)

**Status:** draft (2026-05-13)
**Scope:** PR-B of the 4-PR Tauri → Electron migration. Adds the `vimeflow-backend` sidecar binary and the LSP-style JSON-RPC layer it speaks. Tauri remains the production desktop host through end of PR-B; the sidecar runs as a parallel, exercise-only artifact you can drive from a shell or an integration test.

**Predecessors:** PR-A merged at `2448d7c`. `BackendState` + `EventSink` exist in `src-tauri/src/runtime/`; `TauriEventSink` is the only file in that tree that imports `tauri::*`.

**Successors:** PR-C wires the renderer (`src/lib/backend.ts` swaps `@tauri-apps/api` → `window.vimeflow`); PR-D introduces Electron main/preload and deletes Tauri.

---

## Context

PR-A extracted every Tauri-coupled Rust surface into a runtime-neutral `BackendState` + an `EventSink` trait. The host (Tauri's `app.emit(...)` + `tauri::generate_handler![...]`) still drives state via thin `#[tauri::command]` wrappers, but those wrappers are one-liners now — every command body lives on `BackendState`, every event goes through `Arc<dyn EventSink>`.

PR-A §5 locks four contracts the downstream PRs consume. PR-B claims §5.1 (the 19 production `BackendState` methods + the cfg-gated 20th, `list_active_pty_sessions`, are the IPC wire surface) and §5.2 (the `EventSink` trait shape — `emit_json(event, payload) -> Result<(), String>`). PR-C will claim §5.3 (event payload serde shapes — bind to TS via ts-rs). PR-D claims §5.4 (mechanical Tauri deletion).

PR-A Decision #4 also locked the framing choice: **LSP-style `Content-Length: N\r\n\r\n<json>` over stdio.** Binary PTY payloads are explicitly deferred (Decision #4, "profile first").

PR-A Decision #8 locked the bin target name: `src-tauri/src/bin/vimeflow-backend.rs`.

The migration roadmap (`docs/superpowers/plans/2026-05-13-electron-rust-backend-migration.md`, Task 4) is the rough outline; this spec is the precise contract PR-B implements.

---

## Goals

1. **Add the `vimeflow-backend` bin** under `src-tauri/src/bin/`. Cargo.toml diff is minimal: add a `[[bin]]` block + extend the existing `tokio` `features` list with `"rt-multi-thread"` and `"io-std"` (the current list is `["sync", "io-util", "time", "rt", "macros"]`). No new top-level dependency line — extend, don't duplicate.
2. **CLI arg `--app-data-dir <path>`** (required). The bin parses argv; refuses to start without an app-data-dir. Electron main will pass `app.getPath('userData')` in PR-D; today, integration tests pass a `tempfile::tempdir()` path. No env-var fallback in v1 — required-arg keeps the contract explicit.
3. **Implement an LSP-style JSON-RPC layer** in a single new file `src-tauri/src/runtime/ipc.rs`. Envelope sketch (full type definitions in §2):
   - Request: `{"kind":"request","id":"<string>","method":"<name>","params":<object>}`
   - Response: `{"kind":"response","id":"<string>","ok":<bool>,"result":<value>|"error":<string>}`
   - Event: `{"kind":"event","event":"<name>","payload":<value>}`
   - Each frame is LSP-wrapped: `Content-Length: <byte-len-of-body>\r\n\r\n<json-body>`.
   - Bad-frame contract (Decision #13): any frame whose body fails to deserialize as `InboundFrame::Request` (missing `kind`, wrong `kind`, missing `id`/`method`, malformed JSON) is logged to stderr and dropped — even if a partial parse could extract an id, we don't try. Frames that DO deserialize as a request but then fail at `params` decoding OR hit an unknown method get an id-bearing error response.
4. **Preserve §5.1 wire shape with camelCase params.** Method name == `BackendState` method name. `params` is a JSON object using **camelCase** keys to match the existing renderer call sites (e.g. `useAgentStatus.ts` calls `invoke('stop_agent_watcher', { sessionId: ptyId })`; `gitService.ts` calls with `{ cwd, file, staged, untracked }`). Tauri's invoke auto-converts camelCase → snake_case at the host boundary; PR-B's router does the same by giving each match arm a private decoder struct with `#[serde(rename_all = "camelCase")]`. For methods with a struct arg like `spawn_pty(request: SpawnPtyRequest)`, the wire is `{"request": {...}}` and the inner struct keeps its existing ts-rs serde renames untouched. §2 tabulates every method's exact decoder struct; PR-C MUST NOT alter these.
5. **Preserve §5.2 event shape verbatim.** Event names byte-identical to `app.emit("...")` literals. Payload shapes byte-identical to current ts-rs derivations.
6. **Stdin EOF = graceful shutdown.** When the parent closes its pipe, the sidecar (1) stops accepting new requests, (2) awaits already-accepted request handlers for up to 5 seconds so their response frames can be queued before shutdown, cancelling/aborting any remaining handlers after that drain window, (3) calls `state.shutdown()` ONLY on clean EOF (which `clear_all()`s the session cache; errors leave it intact for next-launch reconciliation), (4) drops `BackendState`, (5) asks the writer task to close its receiver and drain already-queued frames to stdout, and (6) exits 0 if both `run` and writer drain succeeded. Fatal protocol/runtime errors still cancel in-flight handlers via `CancellationToken` before the process exits non-zero. **PTY children are NOT explicitly killed** by PR-B — `portable_pty::Child::Drop` does not kill the child, so any active PTY processes are reparented to PID 1 on bin exit and become orphans. PR-D's Electron supervisor closes the PTY parent-side and uses `process.kill(-pid, 'SIGTERM')` (negative-pid → process group) to terminate the PTY tree. PR-B's integration test exit-cleanup assertion only verifies that the bin process itself exits 0; orphan-PTY cleanup is PR-D's territory. Matches the [[feedback_lazy_reconciliation_over_shutdown_hooks]] memory — SIGKILL/OOM/panic skip this path; `list_sessions` reconciles the cache on next launch.
7. **Stderr for logs, stdout protocol-owned.** Logger initialized in the bin to stderr only; no `println!` anywhere in `src-tauri/src/`. Smoke test (from repo root): `(cd src-tauri && cargo build --bin vimeflow-backend) && echo '<bad input>' | src-tauri/target/debug/vimeflow-backend --app-data-dir /tmp/vimeflow-smoke` must produce zero corruption on the stdout stream — any log line that reaches stdout is a bug.
8. **Tauri host still works.** `npm run tauri:dev` opens the existing app and exercises every flow exactly as it does today. PR-B doesn't touch `src/`, doesn't touch `package.json`, and the only edit to `src-tauri/src/lib.rs` is non-mandatory — the new module is registered in `src-tauri/src/runtime/mod.rs` via `pub mod ipc;` (which `lib.rs` already re-exports via `pub mod runtime;`).
9. **Test semantic parity.** For each `#[tauri::command]` wrapper today, PR-B adds one integration-style test that drives the bin via stdio and asserts the response payload matches what `BackendState::<method>()` returns in-process — _semantically_, not byte-for-byte. Nondeterministic fields like `pid` from `spawn_pty` are asserted by type/shape; deterministic fields (paths, names, error messages) are asserted by value. Event-sequence parity: a recorded `StdoutEventSink` trace from the IPC test must match the `FakeEventSink::recorded()` order from the in-process test. The Tauri-bound parity tests from PR-A stay green; PR-B adds a parallel set covering the IPC path.

---

## Non-goals

1. **No frontend changes.** `src/**` is PR-C territory. PR-B doesn't add `window.vimeflow`, doesn't touch `src/lib/backend.ts` (it doesn't exist yet), doesn't change a single `.ts` / `.tsx` file.
2. **No Electron.** PR-B doesn't add `electron/main.ts`, `electron/preload.ts`, `electron-builder`, or any npm package. PR-D introduces them.
3. **No Tauri removal.** `src-tauri/src/lib.rs` keeps its setup hook; `TauriEventSink` stays untouched; every `#[tauri::command]` wrapper stays. PR-D deletes them.
4. **No new npm scripts.** No `backend:build`, no `electron:dev`. The bin is driven directly via `cd src-tauri && cargo build --bin vimeflow-backend` and the integration tests pipe stdio themselves.
5. **No binary PTY hot path.** PR-A Decision #4 deferred it; profile first. PTY data still flows as JSON through `serde_json::Value` — same allocation cost as the existing Tauri path (also serializes via serde).
6. **No new methods on the wire.** No `shutdown`, no `ping`, no `health`, no `version`. Stdin EOF is the shutdown signal; pipe-open is the liveness signal. Adding methods would amend PR-A §5.1 — out of scope.
7. **No protocol versioning.** v1 is implicit. The future binary-PTY path (Decision #4 v2) is the natural place to introduce a `?protocol=v2` negotiation; PR-B doesn't preempt that design.
8. **No sidecar packaging.** The bin compiles to `src-tauri/target/debug/vimeflow-backend` (dev) or `src-tauri/target/release/vimeflow-backend` (release). PR-D adds the electron-builder `extraResources` config that ships it inside the packaged `.app` / `.AppImage`.
9. **No supervisor / restart logic.** If the sidecar crashes, the integration test sees a closed stdin and reports failure. Production crash recovery is PR-D's concern (Electron main respawns; pending requests reject).
10. **No `agent-detected` / `agent-disconnected` Rust-side emission.** PR-A spec §5 noted those remain frontend-poll-only; PR-B doesn't change that.

---

## Decisions

| #   | Decision                                                                                                               | Why (and what was rejected)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | LSP-style `Content-Length: N\r\n\r\n<json>` framing on stdio (length-prefix)                                           | **Inherited from PR-A Decision #4.** Restated here for self-containment. Survives stray stdout writes (the length header makes them obvious instead of corrupting a JSON parse); bounded per-frame corruption; every production stdio protocol uses this shape (LSP, DAP). Rejected: newline-delimited JSON (one bad embedded newline in an error string desyncs the stream); 4-byte length prefix (less greppable in trace logs).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2   | One file: `src-tauri/src/runtime/ipc.rs` holds frame codec + dispatch router + `StdoutEventSink` + run loop            | User picked this in Step 3 of the planner. Mirrors PR-A's deep-module pattern — `runtime::ipc` is one logical unit; splitting it across four files multiplies grep paths without adding boundaries. Module-internal organization via `mod frame { ... } mod router { ... }` inside the file if it grows past ~400 LOC. Rejected: 4-file split (frame.rs / router.rs / stdout_sink.rs / mod.rs); HashMap-of-fn-pointers dispatch; macro-generated dispatch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 3   | Multi-thread Tokio (`#[tokio::main(flavor = "multi_thread")]`)                                                         | User picked this in Step 2. Matches the existing PtyState pattern (each PTY runs its own task; multi-thread gives them real parallelism). Slow `git_status` does not block PTY-data events. Rejected: current-thread (back-pressure risk).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 4   | Stdin EOF is the only shutdown signal                                                                                  | User picked this in Step 2. Matches [[feedback_lazy_reconciliation_over_shutdown_hooks]] — never depend on shutdown for cache correctness; reconcile on next read. EOF path calls `state.shutdown()` (which `clear_all()`s the cache) as a best-effort cleanup, not a correctness requirement. Rejected: explicit `shutdown` RPC method (would amend PR-A §5.1; out of scope).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 5   | Outbound serialization via a bounded `tokio::sync::mpsc::Sender<Vec<u8>>` → single writer task → `tokio::io::stdout()` | Avoids the sync-vs-async Mutex tension and caps queued stdout memory. `EventSink::emit_json` is a sync trait method (PR-A §5.2 lock) — it formats the LSP frame into a `Vec<u8>` and calls `tx.try_send(frame)`, returning an error on full/closed queue so event producers can log and drop. Request handler tasks call async `tx.send(frame).await` so responses apply backpressure instead of being silently dropped. A single writer task owns stdout and, on clean shutdown, closes its receiver so long-lived PTY/event sender clones cannot keep the process alive; it then drains already-queued frames before exiting. Rejected: unbounded channel (review-found memory growth under stdout backpressure); fixed post-EOF writer timeout (can drop queued responses/events); `std::sync::Mutex<BufWriter<Stdout>>` (sync trait fits but blocks across `await` on response paths); `tokio::sync::Mutex` (can't acquire from a sync trait method without `blocking_lock`). |
| 6   | `params` is a JSON object with **camelCase** keys; per-arm decoder structs use `#[serde(rename_all = "camelCase")]`    | Matches the existing renderer call sites exactly (`useAgentStatus.ts` passes `{ sessionId: ptyId }`, `gitService.ts` passes `{ cwd, file, staged, untracked }`). Tauri's `invoke` does the camelCase → snake_case conversion at the host boundary; PR-B's router does the same by declaring per-method decoder structs with the rename attribute. For methods taking a single struct arg (`spawn_pty(request: SpawnPtyRequest)`), the wire is `{"request": {...}}` and the inner struct retains its existing ts-rs serde attributes — unchanged. §2 tabulates every method's exact decoder. Rejected: snake_case wire (would force PR-C to translate all 30+ existing call sites — unrelated diff churn); positional `params` array (would diverge from `tauri::invoke` shape entirely).                                                                                                                                                                                          |
| 7   | `--app-data-dir <path>` is a required CLI arg, not optional/defaulted                                                  | Explicit contract surfaces invalid invocations immediately (Electron-main typo gets a startup failure, not a silent fallback that writes the cache to the wrong dir). Tests pass a `tempfile::tempdir()` path; PR-D Electron-main passes `app.getPath('userData')`. Rejected: env-var fallback (`VIMEFLOW_APP_DATA_DIR`) — works for dev but lets E2E and production diverge silently; the planner skill's lifeline-tests would not catch it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 8   | The bin compiles without features by default; `--features e2e-test` adds the test-only dispatch arm                    | Resolves the ambiguity in PR-A Decision #8's `required-features = ["e2e-test"]` wording. Setting `required-features` on the `[[bin]]` would block production builds — wrong. The library's `e2e-test` feature is already cfg-gating `BackendState::list_active_pty_sessions`; the bin's dispatch table reuses the same cfg-gate. Production `cargo build --bin vimeflow-backend` works; CI passes `--features e2e-test` for the E2E build.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 9   | The dispatch router uses `match method` over the 19 production methods + the cfg-gated 20th                            | User picked this in Step 3. Explicit and greppable; serde errors stay co-located with the arm that triggered them; mirrors the `tauri::generate_handler![...]` block in `lib.rs` (also 19 + 1 today). Rejected: HashMap<&str, BoxedAsyncFn>; macro-generated arms.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 10  | The integration tests spawn a real `vimeflow-backend` subprocess and pipe stdio                                        | The codec + run loop has enough surface that in-process tests can drift from real wire behavior (buffering, partial reads, signal handling). Real subprocess tests catch all of that. Per-method parity tests are quick — one fixture per command. Rejected: in-process AsyncRead/AsyncWrite duplex tests as the only coverage (we still keep narrow unit tests for the frame codec).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 11  | No protocol version handshake in v1                                                                                    | YAGNI — there is no v2 to negotiate against yet. The natural place for `?protocol=v2` negotiation is the binary-PTY hot path (PR-A Decision #4's v2). Adding a handshake now would lock a shape we don't yet know we want. Rejected: a `hello` exchange on connect.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 12  | No `agent-detected` / `agent-disconnected` events on the wire                                                          | PR-A §5 confirmed those remain frontend-poll-only. PR-B emits the eight events PR-A already wires: `pty-data`, `pty-exit`, `pty-error`, `agent-status`, `agent-tool-call`, `agent-turn`, `test-run`, `git-status-changed`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 13  | Bad-frame behavior — error response only when the body deserializes as `InboundFrame::Request`                         | Four cases. (a) Bytes don't form a valid `Content-Length: N\r\n\r\n` header: codec resyncs up to RESYNC_BUDGET_BYTES (64 KiB); on exhaustion, returns `FatalBadHeader` and `run` exits 1. Malformed header noise is skipped while it remains within the budget. (b) Header OK but body fails `serde_json::from_slice::<InboundFrame>` (malformed JSON, wrong `kind`, missing `id` or `method`): log to stderr, skip — we don't extract an id from a non-parseable envelope. (c) Body deserializes as `InboundFrame::Request` (so `id` and `method` are both valid), but `params` decoding fails: return `{"kind":"response","id":"<id>","ok":false,"error":"params: <reason>"}`. (d) Same as (c) but `method` is unknown: same error shape, error message `"unknown method: <name>"`. Smoke test (Goal 7) hits case (a) — expects stderr lines + non-zero exit, never corrupted stdout.                                                                                           |
| 14  | Each request handler is tracked and drained on clean EOF                                                               | The IO reader task inserts one Tokio task per parsed request frame into a `JoinSet`; the spawned task owns its `Arc<BackendState>` clone and stdout sender clone. EOF on stdin stops accepting new requests, then awaits the `JoinSet` for up to 5 seconds so already-accepted requests can queue responses before the writer drains. If that window expires, the run loop cancels and aborts remaining handlers so the sidecar does not hang forever after the parent closes stdin. Fatal protocol/runtime errors still trigger `cancel_token.cancel()` so spawned tasks short-circuit at await points while the process exits non-zero.                                                                                                                                                                                                                                                                                                                                         |

---

## §1 Architecture — module decomposition + file-level scope

### Module shape

```
src-tauri/src/
├── bin/
│   └── vimeflow-backend.rs           ← NEW (PR-B). #[tokio::main(flavor = "multi_thread")].
│                                        Parses --app-data-dir, builds Arc<BackendState> with
│                                        Arc<StdoutEventSink>, calls runtime::ipc::run(...).
├── lib.rs                            ← UNCHANGED (Tauri host stays).
└── runtime/
    ├── mod.rs                        ← MODIFIED (+1 line): `pub mod ipc;`
    ├── event_sink.rs                 ← UNCHANGED.
    ├── state.rs                      ← UNCHANGED.
    ├── tauri_bridge.rs               ← UNCHANGED (Tauri's path).
    ├── test_event_sink.rs            ← UNCHANGED.
    └── ipc.rs                        ← NEW (PR-B). The whole IPC layer:
                                          - module-private `mod frame { Frame codec }`
                                          - module-private `mod router { dispatch + decoders }`
                                          - `pub struct StdoutEventSink`
                                          - `pub async fn run<R: AsyncRead + Unpin + Send>(state: Arc<BackendState>, reader: R, tx: Sender<Vec<u8>>, cancel: CancellationToken) -> Result<(), io::Error>`
                                          - `pub async fn writer_task<W: AsyncWrite + Unpin + Send>(rx: Receiver<Vec<u8>>, writer: W)`
```

### Process model

```text
Renderer / test driver
  │  (length-prefixed JSON frames)
  ▼ stdin
[vimeflow-backend (Tokio multi-thread)]
  │
  ├── IO reader task: parses request frames → spawn(handle_request) per frame, owns the CancellationToken
  ├── N handle_request tasks: serde_json::from_value → router match → state.method(args) → tx.send(frame_bytes).await
  ├── Writer task: while rx.recv().await { stdout.write_all + flush }; sole owner of tokio::io::stdout()
  ├── PTY / watcher tasks (owned by BackendState): emit events → StdoutEventSink::emit_json → tx.try_send(frame_bytes)
  │
  └── Bounded channel `tokio::sync::mpsc::Sender<Vec<u8>> → Receiver`: serializes queued outbound frames in arrival order
```

`BackendState`, the `tx` clones, and the `CancellationToken` clones flow through `Arc`. No `Mutex` on the writer path — the single writer task is the lock. The writer task exits when all `tx` clones drop, or when the bin's clean-shutdown path asks it to close its receiver and drain the queue. `BackendState`'s internal `Arc<…>` wrappers (PtyState, SessionCache, AgentWatcherState, TranscriptState, GitWatcherState) are unchanged from PR-A.

### New files

| File                                    | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Approx LOC |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| `src-tauri/src/bin/vimeflow-backend.rs` | `fn main()` shim. Parses `--app-data-dir <path>` via a hand-rolled argv loop (no `clap` dep). Initializes `env_logger` (stderr only). Builds the writer-channel: `let (tx, rx) = mpsc::channel(ipc::STDOUT_QUEUE_CAPACITY);`. Spawns the writer task with a shutdown token. Builds `BackendState::new(app_data_dir, Arc::new(StdoutEventSink::new(tx.clone())))`. Builds the `CancellationToken`. Calls `runtime::ipc::run(state, tokio::io::stdin(), tx, cancel).await`. When `run` returns, drops `BackendState`, signals writer shutdown, waits for queued frames to drain, and exits 0 only if both the run loop and writer succeeded. | ~70        |
| `src-tauri/src/runtime/ipc.rs`          | The whole IPC layer. Internal layout: `mod frame { read_frame, format_frame, FrameError }`, `mod router { dispatch, per-method-decoder-structs }`, `pub struct StdoutEventSink { tx: tokio::sync::mpsc::Sender<Vec<u8>> }`, `pub async fn run<R: AsyncRead>(state: Arc<BackendState>, reader: R, tx: Sender<Vec<u8>>, cancel: CancellationToken)` (the writer task is separate; see bin shim row). Internal tests via `#[cfg(test)] mod tests` exercise the codec and dispatch against `BackendState::with_fake_sink()`.                                                                                                                   | ~400       |
| `src-tauri/tests/ipc_subprocess.rs`     | Cargo **integration test** (`tests/` is the canonical location for tests that spawn the cargo-built bin via `env!("CARGO_BIN_EXE_vimeflow-backend")`). Pipes request frames in via stdin, asserts response frames out via stdout. One test fixture per §5.1 method. Cargo builds the bin before running the integration test — no separate build step needed.                                                                                                                                                                                                                                                                              | ~250       |

### Modified files

| File                           | Diff                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/Cargo.toml`         | Three diffs: (1) extend the existing `tokio` feature list from `["sync", "io-util", "time", "rt", "macros"]` to `["sync", "io-util", "io-std", "time", "rt", "rt-multi-thread", "macros"]`. (2) Add `tokio-util = { version = "0.7", features = ["rt"] }` (the `rt` feature is what gates `tokio_util::sync::CancellationToken` in 0.7; there is no `sync` feature) and `env_logger = "0.11"` to `[dependencies]`. (3) Add `[[bin]] name = "vimeflow-backend"\npath = "src/bin/vimeflow-backend.rs"` block. No `required-features` on the `[[bin]]` (see Decision #8 — would block production). |
| `src-tauri/src/runtime/mod.rs` | Add `pub mod ipc;` next to the other `pub mod` lines. No other changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### Files NOT touched

| File                                                                       | Why                                                                                                                                         |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/src/lib.rs`                                                     | Tauri host still works post-PR-B. `lib.rs`'s setup hook, `generate_handler![...]`, and `ExitRequested` handler stay as they are.            |
| `src-tauri/src/runtime/{event_sink,state,tauri_bridge,test_event_sink}.rs` | PR-A's contracts are the inputs to PR-B; we consume them, not modify them.                                                                  |
| `src-tauri/src/{terminal,filesystem,git,agent}/**`                         | The command bodies live on `BackendState` already. PR-B's router calls `BackendState` methods; the underlying domain modules are unchanged. |
| `src-tauri/src/main.rs`                                                    | Unrelated to the sidecar bin. PR-D rewrites this when removing Tauri.                                                                       |
| `src/**`                                                                   | PR-C territory.                                                                                                                             |
| `package.json`, `vite.config.ts`                                           | PR-C / PR-D territory.                                                                                                                      |
| `tests/e2e/**`                                                             | PR-D territory.                                                                                                                             |
| `src/bindings/**`                                                          | ts-rs derives unchanged in PR-B → bindings unchanged → no diff.                                                                             |

### Frame codec skeleton (full body in §2)

```rust
mod frame {
    use std::io;
    use tokio::io::{AsyncBufRead, AsyncRead, AsyncReadExt, BufReader};

    pub const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024; // 16 MiB hard cap; per-frame DoS guard.

    pub async fn read_frame<R: AsyncBufRead + Unpin>(
        reader: &mut R,
    ) -> Result<Option<Vec<u8>>, FrameError> { /* parse Content-Length: N\r\n\r\n then read N bytes */ }

    #[derive(Debug)]
    pub enum FrameError {
        Eof,                            // Clean EOF; caller exits the loop.
        FatalBadHeader(String),         // Resync budget exhausted or header hard-limit hit.
        BodyTooLarge { len: usize },    // Hard error; caller exits 1.
        Io(io::Error),                  // Underlying read/write failure.
    }
}
```

### Dispatch router skeleton (full body in §2)

```rust
mod router {
    use super::frame;
    use serde::Deserialize;
    use serde_json::Value;
    use std::sync::Arc;
    use crate::runtime::BackendState;

    // Each match arm has its own decoder; per-method structs live in this module.
    // Example for one struct-arg method and one primitive-arg method:

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SpawnPtyParams { request: crate::terminal::types::SpawnPtyRequest }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct StartAgentWatcherParams { session_id: String }

    pub async fn dispatch(
        state: Arc<BackendState>,
        method: &str,
        params: Value,
    ) -> Result<Value, String> {
        match method {
            "spawn_pty" => {
                let p: SpawnPtyParams = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                let res = state.spawn_pty(p.request).await?;
                Ok(serde_json::to_value(res).map_err(|e| format!("result encode: {e}"))?)
            }
            "start_agent_watcher" => {
                let p: StartAgentWatcherParams = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                state.start_agent_watcher(p.session_id).await?;
                Ok(Value::Null)
            }
            // ... 17 more production arms ...
            #[cfg(feature = "e2e-test")]
            "list_active_pty_sessions" => Ok(serde_json::to_value(state.list_active_pty_sessions()).unwrap()),
            _ => Err(format!("unknown method: {method}")),
        }
    }
}
```

### `StdoutEventSink` skeleton (full body in §2)

```rust
use crate::runtime::event_sink::EventSink;
use serde_json::Value;
use tokio::sync::mpsc::Sender;

pub struct StdoutEventSink {
    tx: Sender<Vec<u8>>,
}

impl StdoutEventSink {
    pub fn new(tx: Sender<Vec<u8>>) -> Self {
        Self { tx }
    }
}

impl EventSink for StdoutEventSink {
    fn emit_json(&self, event: &str, payload: Value) -> Result<(), String> {
        // Format the LSP frame in this thread; try to enqueue the byte-vec for
        // the writer task. Synchronous try_send fits the sync trait shape and
        // bounds memory when stdout is backpressured.
        let body = serde_json::to_vec(&serde_json::json!({
            "kind": "event",
            "event": event,
            "payload": payload,
        }))
        .map_err(|err| format!("event encode {event}: {err}"))?;
        let frame = format_frame(&body); // helper: prepends "Content-Length: N\r\n\r\n"
        self.tx
            .try_send(frame)
            .map_err(|err| match err {
                tokio::sync::mpsc::error::TrySendError::Full(_) => {
                    format!("stdout writer backlog full; dropped {event}")
                }
                tokio::sync::mpsc::error::TrySendError::Closed(_) => {
                    format!("stdout writer closed; cannot emit {event}")
                }
            })?;
        Ok(())
    }
}
```

### `run` entry-point + writer task signatures (full bodies in §2)

```rust
pub async fn run<R: AsyncRead + Unpin + Send>(
    state: Arc<BackendState>,
    reader: R,
    tx: Sender<Vec<u8>>,
    cancel: CancellationToken,
) -> Result<(), io::Error> {
    // 1. Loop: read_frame from reader; on Eof → break; on BadHeader → log + continue.
    // 2. Per frame: serde_json::from_slice into RequestFrame; track a task to dispatch+respond.
    //    The spawned task captures tx.clone(), state.clone(), cancel.clone().
    // 3. On EOF: await tracked handlers for a bounded drain window so accepted
    //    requests can queue responses; cancel/abort remaining handlers on timeout.
    // 4. Drop the final `tx` clone held by `run`; main then signals writer shutdown
    //    so the receiver closes and queued frames drain even if event senders live on.
    Ok(())
}

pub async fn writer_task_with_shutdown<W: AsyncWrite + Unpin + Send + 'static>(
    mut rx: Receiver<Vec<u8>>,
    mut writer: W,
    shutdown: CancellationToken,
    cancel: CancellationToken,
) -> io::Result<()> {
    // Selects on shutdown.cancelled(); closes rx, drains already-queued frames,
    // cancels the run loop on stdout write failure, and returns an error if
    // stdout cannot be flushed.
    Ok(())
}
```

### Net file count + LOC

- New: 3 files (~700 LOC: bin shim, ipc.rs, tests/ipc_subprocess.rs).
- Modified: 2 files (~7 LOC: Cargo.toml + runtime/mod.rs).
- Deleted: 0.

Total PR-B diff target: < 800 LOC additions, < 10 LOC modifications, 0 deletions. The Tauri host's diff is ~0 lines — Tauri keeps working unchanged.

---

## §2 Rust APIs

This section provides the canonical Rust types and function signatures for `src-tauri/src/runtime/ipc.rs` and the bin shim. PR-C and PR-D consume these as-is.

### §2.1 Frame codec

```rust
mod frame {
    use std::io;
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

    /// Maximum body bytes per frame. Protects against a stuck reader allocating
    /// unbounded memory on a malicious or buggy peer.
    pub const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;

    /// Soft cap for resync attempts when a header line is malformed. 64 KiB is
    /// generous; a runaway peer would have to flood far more than that to
    /// exhaust the cap. Hitting the cap is a non-recoverable corruption.
    pub const RESYNC_BUDGET_BYTES: u64 = 64 * 1024;

    /// Hard cap on a single header line. Protects against a peer sending a
    /// huge run of non-newline bytes that would otherwise force `read_line` to
    /// allocate `String` capacity beyond RESYNC_BUDGET_BYTES before the budget
    /// check triggers. With this cap, the worst-case allocation per line is
    /// MAX_HEADER_LINE_BYTES; the resync budget is measured in line counts.
    pub const MAX_HEADER_LINE_BYTES: u64 = 8 * 1024;

    /// Hard cap on the complete header section, including extension headers
    /// after Content-Length. This keeps LSP-compatible extension headers from
    /// consuming the malformed-header resync budget while still bounding total
    /// header work.
    pub const MAX_HEADER_SECTION_BYTES: u64 = 1024 * 1024;

    /// Returns Ok(Some(body)) on success, Ok(None) on clean EOF, Err otherwise.
    /// Internal resync is best-effort: when a header line is malformed, the
    /// reader consumes bytes until either (a) it finds another `Content-Length:`
    /// header (resume), or (b) it has discarded RESYNC_BUDGET_BYTES (give up
    /// with a hard `BadHeader` that the caller treats as a fatal corruption).
    pub async fn read_frame<R: AsyncBufReadExt + Unpin>(
        reader: &mut R,
    ) -> Result<Option<Vec<u8>>, FrameError> {
        let mut header_consumed: u64 = 0;
        let mut resync_consumed: u64 = 0;

        // Phase 1 — accumulate headers until a blank line terminates the block.
        //   Per LSP: the header block is one or more `Name: Value\r\n` lines
        //   followed by a single `\r\n`. `Content-Length` is mandatory; other
        //   headers are tolerated and ignored. We track the running `resync_consumed`
        //   so that if we hit a malformed line we can decide whether to recover
        //   (continue past) or give up. Each line is bounded to MAX_HEADER_LINE_BYTES
        //   so a peer flooding bytes-without-newline can't force unbounded allocation.
        let mut content_length: Option<usize> = None;
        loop {
            // Read one header line, but cap the in-progress allocation at
            // MAX_HEADER_LINE_BYTES so a peer can't force unbounded growth by
            // omitting the newline. We `fill_buf` to peek the available bytes,
            // scan for '\n', then `consume` only up to that point. If no '\n'
            // appears within MAX_HEADER_LINE_BYTES of accumulated bytes, fatal.
            let mut line: Vec<u8> = Vec::with_capacity(128);
            let n = loop {
                let chunk = reader.fill_buf().await.map_err(FrameError::Io)?;
                if chunk.is_empty() {
                    break line.len();  // EOF; outer block detects via n == 0.
                }
                let newline_at = chunk.iter().position(|&b| b == b'\n');
                let consume_to = newline_at.map(|i| i + 1).unwrap_or(chunk.len());
                if (line.len() + consume_to) as u64 > MAX_HEADER_LINE_BYTES {
                    return Err(FrameError::FatalBadHeader(format!(
                        "header line exceeded {MAX_HEADER_LINE_BYTES} bytes without newline"
                    )));
                }
                line.extend_from_slice(&chunk[..consume_to]);
                reader.consume(consume_to);
                if newline_at.is_some() {
                    break line.len();
                }
            };
            let line = String::from_utf8(line)
                .map_err(|err| FrameError::FatalBadHeader(format!("header utf8: {err}")))?;
            if n == 0 {
                // EOF.
                if header_consumed == 0 && content_length.is_none() {
                    return Ok(None); // Clean inter-frame EOF.
                }
                return Err(FrameError::Io(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "eof mid-header",
                )));
            }
            header_consumed = header_consumed.saturating_add(n as u64);
            if header_consumed > MAX_HEADER_SECTION_BYTES {
                return Err(FrameError::FatalBadHeader(format!(
                    "header section exceeded {MAX_HEADER_SECTION_BYTES} bytes"
                )));
            }
            let trimmed = line.trim_end_matches(['\r', '\n']);
            if trimmed.is_empty() {
                // Blank line: end of header block iff we have a Content-Length.
                if let Some(len) = content_length {
                    if len > MAX_FRAME_BYTES {
                        return Err(FrameError::BodyTooLarge { len });
                    }
                    // Phase 2 — read exactly `len` body bytes.
                    let mut body = vec![0u8; len];
                    reader.read_exact(&mut body).await.map_err(FrameError::Io)?;
                    return Ok(Some(body));
                }
                // Blank line outside any header block (stray CRLF in resync); count + continue.
                resync_consumed = resync_consumed.saturating_add(n as u64);
                if resync_consumed > RESYNC_BUDGET_BYTES {
                    return Err(FrameError::FatalBadHeader(
                        "resync budget exhausted (no Content-Length)".into(),
                    ));
                }
                continue;
            }
            // Header line: `Name: Value`.
            if let Some((name, value)) = trimmed.split_once(':') {
                let name_trim = name.trim();
                let value_trim = value.trim();
                if name_trim.eq_ignore_ascii_case("Content-Length") {
                    match value_trim.parse::<usize>() {
                        Ok(len) => content_length = Some(len),
                        Err(err) => {
                            resync_consumed = resync_consumed.saturating_add(n as u64);
                            if resync_consumed > RESYNC_BUDGET_BYTES {
                                return Err(FrameError::FatalBadHeader(format!(
                                    "non-numeric content-length: {err}"
                                )));
                            }
                            // Reset content_length to None so a later
                            // well-formed line can supersede it.
                            content_length = None;
                        }
                    }
                    continue;
                }
                // Unknown header — LSP allows it. Only pre-Content-Length
                // unknown headers count against the resync budget; all headers
                // remain bounded by MAX_HEADER_SECTION_BYTES.
                if content_length.is_none() {
                    resync_consumed = resync_consumed.saturating_add(n as u64);
                    if resync_consumed > RESYNC_BUDGET_BYTES {
                        return Err(FrameError::FatalBadHeader(format!(
                            "no Content-Length within {RESYNC_BUDGET_BYTES} bytes of headers"
                        )));
                    }
                }
                continue;
            }
            // Line is not `Name: Value` and not blank → resync noise.
            resync_consumed = resync_consumed.saturating_add(n as u64);
            if resync_consumed > RESYNC_BUDGET_BYTES {
                return Err(FrameError::FatalBadHeader(format!(
                    "no Content-Length within {RESYNC_BUDGET_BYTES} bytes of garbage"
                )));
            }
        }
    }

    /// Produces framed bytes upstream of the writer channel without doing IO.
    pub fn format_frame(body: &[u8]) -> Vec<u8> {
        let header = format!("Content-Length: {}\r\n\r\n", body.len());
        let mut out = Vec::with_capacity(header.len() + body.len());
        out.extend_from_slice(header.as_bytes());
        out.extend_from_slice(body);
        out
    }

    #[derive(Debug)]
    pub enum FrameError {
        /// Header parsing has exhausted RESYNC_BUDGET_BYTES of garbage without
        /// finding a valid `Content-Length:` header. Fatal — caller exits.
        FatalBadHeader(String),
        /// Body length exceeds MAX_FRAME_BYTES. Fatal — caller exits.
        BodyTooLarge { len: usize },
        /// Underlying IO failure (including unexpected mid-frame EOF).
        Io(io::Error),
    }

    impl From<io::Error> for FrameError {
        fn from(err: io::Error) -> Self { Self::Io(err) }
    }
}
```

### §2.2 Envelope types

```rust
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum InboundFrame {
    Request(RequestFrame),
    // future: Cancel(CancelFrame) etc.
}

#[derive(Deserialize)]
struct RequestFrame {
    id: String,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Serialize)]
struct ResponseFrame<'a> {
    kind: &'static str, // always "response"
    id: &'a str,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<&'a Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'a str>,
}

impl<'a> ResponseFrame<'a> {
    fn ok(id: &'a str, result: &'a Value) -> Self {
        Self { kind: "response", id, ok: true, result: Some(result), error: None }
    }
    fn err(id: &'a str, error: &'a str) -> Self {
        Self { kind: "response", id, ok: false, result: None, error: Some(error) }
    }
}

// Event frame is serialized inline by StdoutEventSink::emit_json (see §2.3 —
// using json!({"kind":"event", ...}) keeps the struct allocation off the hot path).
```

### §2.3 `StdoutEventSink`

```rust
use crate::runtime::event_sink::EventSink;
use serde_json::{json, Value};
use tokio::sync::mpsc::Sender;

pub struct StdoutEventSink {
    tx: Sender<Vec<u8>>,
}

impl StdoutEventSink {
    pub fn new(tx: Sender<Vec<u8>>) -> Self {
        Self { tx }
    }
}

impl EventSink for StdoutEventSink {
    fn emit_json(&self, event: &str, payload: Value) -> Result<(), String> {
        let body = serde_json::to_vec(&json!({
            "kind": "event",
            "event": event,
            "payload": payload,
        }))
        .map_err(|err| format!("event encode {event}: {err}"))?;
        self.tx
            .try_send(frame::format_frame(&body))
            .map_err(|err| match err {
                tokio::sync::mpsc::error::TrySendError::Full(_) => {
                    format!("stdout writer backlog full; dropped {event}")
                }
                tokio::sync::mpsc::error::TrySendError::Closed(_) => {
                    format!("stdout writer closed; cannot emit {event}")
                }
            })?;
        Ok(())
    }
}
```

### §2.4 Dispatch router

Match-arm dispatch over the 19 production methods + the cfg-gated 20th. Three representative arms (struct-arg, primitive-arg, multi-primitive); the rest follow the same pattern from the per-method table at the end of this section.

```rust
mod router {
    use serde::Deserialize;
    use serde_json::{json, Value};
    use std::sync::Arc;
    use crate::runtime::BackendState;

    pub async fn dispatch(
        state: Arc<BackendState>,
        method: &str,
        params: Value,
    ) -> Result<Value, String> {
        match method {
            // Struct-arg method. The request struct already has its own ts-rs serde
            // derives, so the inner shape stays exactly as PR-C's existing call sites use.
            "spawn_pty" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct P { request: crate::terminal::types::SpawnPtyRequest }
                let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                let res = state.spawn_pty(p.request).await?;
                serde_json::to_value(res).map_err(|e| format!("result encode: {e}"))
            }

            // Primitive-arg method. The decoder struct's `session_id: String` field maps
            // to wire key `"sessionId"` via the rename_all attribute.
            "start_agent_watcher" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct P { session_id: String }
                let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                state.start_agent_watcher(p.session_id).await?;
                Ok(Value::Null)
            }

            // Multi-primitive method. `untracked` is optional on the JS side; default to None.
            "get_git_diff" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct P {
                    cwd: String,
                    file: String,
                    staged: bool,
                    #[serde(default)] untracked: Option<bool>,
                }
                let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                let diff = state.get_git_diff(p.cwd, p.file, p.staged, p.untracked).await?;
                serde_json::to_value(diff).map_err(|e| format!("result encode: {e}"))
            }

            // ... 17 more production arms (table below) ...

            #[cfg(feature = "e2e-test")]
            "list_active_pty_sessions" => {
                serde_json::to_value(state.list_active_pty_sessions()).map_err(|e| format!("result encode: {e}"))
            }

            _ => Err(format!("unknown method: {method}")),
        }
    }
}
```

#### Per-method decoder table

The wire `params` key column is what the renderer sends (camelCase). The decoder struct column shows the Rust field names (snake_case) with `#[serde(rename_all = "camelCase")]` doing the conversion. "—" means no params.

| Method                             | Wire `params` keys                     | Decoder struct fields                                             | Returns                      |
| ---------------------------------- | -------------------------------------- | ----------------------------------------------------------------- | ---------------------------- |
| `spawn_pty`                        | `{ request: SpawnPtyRequest }`         | `request: SpawnPtyRequest`                                        | `PtySession`                 |
| `write_pty`                        | `{ request: WritePtyRequest }`         | `request: WritePtyRequest`                                        | `()`                         |
| `resize_pty`                       | `{ request: ResizePtyRequest }`        | `request: ResizePtyRequest`                                       | `()`                         |
| `kill_pty`                         | `{ request: KillPtyRequest }`          | `request: KillPtyRequest`                                         | `()`                         |
| `list_sessions`                    | `{}` (or absent)                       | (no fields; decode via `#[serde(default)]` on a unit-like struct) | `SessionList`                |
| `set_active_session`               | `{ request: SetActiveSessionRequest }` | `request: SetActiveSessionRequest`                                | `()`                         |
| `reorder_sessions`                 | `{ request: ReorderSessionsRequest }`  | `request: ReorderSessionsRequest`                                 | `()`                         |
| `update_session_cwd`               | `{ request: UpdateSessionCwdRequest }` | `request: UpdateSessionCwdRequest`                                | `()`                         |
| `detect_agent_in_session`          | `{ sessionId: string }`                | `session_id: String`                                              | `Option<AgentDetectedEvent>` |
| `start_agent_watcher`              | `{ sessionId: string }`                | `session_id: String`                                              | `()`                         |
| `stop_agent_watcher`               | `{ sessionId: string }`                | `session_id: String`                                              | `()`                         |
| `list_dir`                         | `{ request: ListDirRequest }`          | `request: ListDirRequest`                                         | `Vec<FileEntry>`             |
| `read_file`                        | `{ request: ReadFileRequest }`         | `request: ReadFileRequest`                                        | `String`                     |
| `write_file`                       | `{ request: WriteFileRequest }`        | `request: WriteFileRequest`                                       | `()`                         |
| `git_status`                       | `{ cwd: string }`                      | `cwd: String`                                                     | `Vec<ChangedFile>`           |
| `git_branch`                       | `{ cwd: string }`                      | `cwd: String`                                                     | `String`                     |
| `get_git_diff`                     | `{ cwd, file, staged, untracked? }`    | `cwd, file: String; staged: bool; untracked: Option<bool>`        | `FileDiff`                   |
| `start_git_watcher`                | `{ cwd: string }`                      | `cwd: String`                                                     | `()`                         |
| `stop_git_watcher`                 | `{ cwd: string }`                      | `cwd: String`                                                     | `()`                         |
| `list_active_pty_sessions` `[cfg]` | `{}` (or absent)                       | (no fields)                                                       | `Vec<String>`                |

Cross-reference: the wire `params` shapes above match what the renderer currently sends through `@tauri-apps/api/core.invoke` — verified at `src/features/{terminal,agent-status,diff,files}/**` for every method. PR-C swaps the `invoke` source from `@tauri-apps/api/core` to `window.vimeflow` without changing a single call-site argument shape.

### §2.5 `run` entry point

```rust
use std::sync::Arc;
use std::io;
use tokio::io::{AsyncRead, BufReader};
use tokio::sync::mpsc::Sender;
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

use crate::runtime::BackendState;

pub async fn run<R: AsyncRead + Unpin + Send>(
    state: Arc<BackendState>,
    reader: R,
    tx: Sender<Vec<u8>>,
    cancel: CancellationToken,
) -> Result<(), io::Error> {
    let mut buf_reader = BufReader::new(reader);
    let mut handlers = JoinSet::new();

    loop {
        match frame::read_frame(&mut buf_reader).await {
            Ok(Some(body)) => {
                spawn_handler(&mut handlers, state.clone(), tx.clone(), cancel.clone(), body);
            }
            Ok(None) => break, // Clean stdin EOF.
            Err(frame::FrameError::FatalBadHeader(msg)) => {
                log::error!("ipc fatal frame error: {msg}; exiting");
                return Err(io::Error::other(format!("fatal header: {msg}")));
            }
            Err(frame::FrameError::BodyTooLarge { len }) => {
                log::error!("ipc body too large: {len} bytes; exiting");
                return Err(io::Error::other("body too large"));
            }
            Err(frame::FrameError::Io(err)) => return Err(err),
        }
    }

    // EOF reached on stdin. Already-accepted handlers get a bounded drain window
    // to queue response frames before the clean shutdown path drops tx.
    if tokio::time::timeout(Duration::from_secs(5), drain_handlers(&mut handlers))
        .await
        .is_err()
    {
        cancel.cancel();
        handlers.abort_all();
        drain_handlers(&mut handlers).await;
    }

    // Drop the final tx clone held by `run`. The writer task's recv() returns None
    // when all senders drop. main() also signals writer shutdown so long-lived
    // event senders cannot keep the process open after queued frames drain.
    Ok(())
}

fn spawn_handler(
    handlers: &mut JoinSet<()>,
    state: Arc<BackendState>,
    tx: Sender<Vec<u8>>,
    cancel: CancellationToken,
    body: Vec<u8>,
) {
    handlers.spawn(async move {
        // Parse the tagged envelope. Invalid JSON or wrong `kind` → log + return
        // (no id to respond to). InboundFrame enforces `kind == "request"`.
        let mut req: RequestFrame = match serde_json::from_slice::<InboundFrame>(&body) {
            Ok(InboundFrame::Request(req)) => req,
            Err(err) => {
                log::warn!("ipc bad envelope: {err}");
                return;
            }
        };

        // Normalize absent / null params to {} so empty-param decoders work.
        // `RequestFrame { params: #[serde(default)] }` defaults missing params
        // to Value::Null; serde_json::from_value::<EmptyStruct>(Null) fails.
        // Empty object decodes cleanly into a zero-field struct.
        if matches!(req.params, Value::Null) {
            req.params = Value::Object(serde_json::Map::new());
        }

        // Dispatch with cancellation.
        let dispatch = router::dispatch(state, &req.method, req.params);
        let outcome = tokio::select! {
            biased;
            _ = cancel.cancelled() => return, // Drop the response on the floor.
            res = dispatch => res,
        };

        // Encode response and ship to the writer task.
        let payload = match &outcome {
            Ok(value) => ResponseFrame::ok(&req.id, value),
            Err(msg) => ResponseFrame::err(&req.id, msg.as_str()),
        };
        let body = match serde_json::to_vec(&payload) {
            Ok(b) => b,
            Err(err) => {
                log::error!("ipc response encode failed (id={}): {err}", req.id);
                return;
            }
        };
        let _ = tx.send(frame::format_frame(&body)).await;
    });
}
```

### §2.6 Bin shim

```rust
// src-tauri/src/bin/vimeflow-backend.rs
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use vimeflow_lib::runtime::{ipc, BackendState, EventSink};

#[tokio::main(flavor = "multi_thread")]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn"))
        .target(env_logger::Target::Stderr)
        .init();

    let app_data_dir = parse_app_data_dir().unwrap_or_else(|err| {
        eprintln!("vimeflow-backend: {err}");
        std::process::exit(2);
    });

    let (tx, rx) = mpsc::channel::<Vec<u8>>(ipc::STDOUT_QUEUE_CAPACITY);
    let writer_shutdown = CancellationToken::new();
    let cancel = CancellationToken::new();
    let writer_handle = tokio::spawn(ipc::writer_task_with_shutdown(
        rx,
        tokio::io::stdout(),
        writer_shutdown.clone(),
        cancel.clone(),
    ));

    let sink: Arc<dyn EventSink> = Arc::new(ipc::StdoutEventSink::new(tx.clone()));
    let state = Arc::new(BackendState::new(app_data_dir, sink));

    let run_result = ipc::run(state.clone(), tokio::io::stdin(), tx, cancel.clone()).await;

    // Clean EOF (Ok(())) is the ONLY path that wipes the session cache. Errors
    // (FatalBadHeader, BodyTooLarge, IO) leave the cache intact so a restart
    // recovers sessions via lazy reconciliation (PR-A's list_sessions path).
    // Wiping on protocol corruption would turn a transient stream error into
    // permanent data loss for the user.
    if run_result.is_ok() {
        state.shutdown();
    }
    drop(state);

    // Close the writer receiver so long-lived event sender clones cannot keep
    // the sidecar open, then await the writer so already-queued frames flush.
    writer_shutdown.cancel();
    let writer_result = writer_handle.await.expect("writer task join");

    if let Err(err) = run_result {
        eprintln!("vimeflow-backend: run loop exited with error: {err}");
        std::process::exit(1);
    }
    if let Err(err) = writer_result {
        eprintln!("vimeflow-backend: writer exited with error: {err}");
        std::process::exit(1);
    }
}

fn parse_app_data_dir() -> Result<std::path::PathBuf, String> {
    let mut args = std::env::args().skip(1);
    let mut app_data_dir: Option<std::path::PathBuf> = None;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--app-data-dir" => {
                let value = args.next().ok_or("--app-data-dir requires a path")?;
                app_data_dir = Some(value.into());
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    app_data_dir.ok_or_else(|| "--app-data-dir <path> is required".into())
}
```

---

## §3 Testing approach

PR-B's correctness contract is "renderer cannot tell the difference between Tauri-host and sidecar paths" — the parity assertion in Goal 9. The test strategy is two-tier: narrow unit tests in `ipc.rs`, and integration tests in `src-tauri/tests/ipc_subprocess.rs` that exercise the cargo-built bin via real stdio.

### Coverage targets

| Surface                                       | Unit tests (`ipc.rs::tests`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Integration tests (`tests/ipc_subprocess.rs`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `frame::format_frame`                         | Roundtrip: format → split header from body → assert lengths match. Empty body, large body (1 MiB), body containing all 256 byte values. Header is exactly `Content-Length: N\r\n\r\n`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | n/a (codec is unit-only).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `frame::read_frame`                           | Clean valid frame → `Ok(Some(body))`. Clean EOF before any bytes → `Ok(None)`. EOF mid-header → `Err(Io(UnexpectedEof))`. EOF mid-body → `Err(Io(UnexpectedEof))`. Body length > `MAX_FRAME_BYTES` → `Err(BodyTooLarge)`. Header without `Content-Length:` → resync until budget OR found. Bad numeric content-length → resync. Extra headers (`X-Foo: bar`) → ignored.                                                                                                                                                                                                                                                                                                                                                                            | n/a.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `router::dispatch` (parity vs `BackendState`) | For each of the 19 production methods (`cargo test --lib`, runs INSIDE `ipc.rs::tests` so it has access to `BackendState::with_fake_sink()` and crate-private request types): build a fake-sink state, drive `dispatch(state, method, params)`, assert the returned `Value` matches what `serde_json::to_value(state.method(...).await)` yields directly. This is the **byte-level parity assertion**, and it lives in unit-test scope specifically because integration tests (external crate) cannot see `with_fake_sink()` or the private request structs. The cfg-gated 20th method is covered by `cargo test --lib --features e2e-test`. Inject malformed params → expect `Err("params: ...")`. Unknown method → `Err("unknown method: ...")`. | n/a.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `StdoutEventSink::emit_json`                  | Build a `(tx, rx)` channel; create the sink with `tx`; call `emit_json("pty-data", json!({...}))`; assert `rx.try_recv()` yields a single `Vec<u8>` whose body parses to `{"kind":"event","event":"pty-data","payload":...}`. Tx closed → `emit_json` returns `Err(...)`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | n/a (the sink is unit-tested via channels; subprocess tests exercise it end-to-end).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `spawn_handler` / `run` (envelope check)      | Build a duplex pipe; write a request frame; assert the response frame body decodes to `ResponseFrame::ok(...)`. Repeat with wrong `kind` field → no response (logged). Wrong-shape params → `ResponseFrame::err(...)` with id preserved. Cancellation token triggered mid-await → no response sent.                                                                                                                                                                                                                                                                                                                                                                                                                                                | n/a (`run` is unit-tested with in-memory pipes via tokio's `duplex`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| End-to-end per method (wire shape)            | n/a.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | For each of the 19 production methods: spawn `target/debug/vimeflow-backend` (via `env!("CARGO_BIN_EXE_vimeflow-backend")`), pipe one request frame in, read one response frame out, assert the response **wire shape** — `kind == "response"`, `id` round-trips, `ok` is `true` for happy-path methods, `result` is non-null where the method returns a value. We do NOT compare against in-process `BackendState::method()` here (external crate can't see `with_fake_sink()`); the byte-level parity assertion lives in `router::dispatch` unit tests above. The 20th method is exercised under `cargo test --features e2e-test`. |
| End-to-end event emission                     | n/a.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Spawn the bin, send `spawn_pty` + `write_pty`, read event frames from stdout, assert at least one `pty-data` event appears within 2s. The exact byte content is nondeterministic; we assert event names + payload shape only.                                                                                                                                                                                                                                                                                                                                                                                                        |
| End-to-end stdout cleanliness                 | n/a.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Spawn the bin, pipe garbage to stdin, read stdout — assert zero bytes (no logs leaked). Read stderr — assert at least one log line. Bin process exits non-zero only when `BodyTooLarge` or `read_frame` errors out.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| End-to-end EOF shutdown                       | n/a.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Spawn the bin, send `spawn_pty`, wait for response, close stdin; assert bin process exits 0 within 1s; assert no orphan PTY left behind (read `pgrep -P <bin_pid>` is empty after exit).                                                                                                                                                                                                                                                                                                                                                                                                                                             |

### Mock strategy

- **In-process router tests** use `BackendState::with_fake_sink()` (already provided by PR-A under `#[cfg(any(test, feature = "e2e-test"))]`). The `FakeEventSink` records every `emit_json` call so tests can assert the event sequence.
- **In-process `run` tests** use `tokio::io::duplex()` to create a pair of `AsyncRead + AsyncWrite` ends. The test writes request frames to one end, reads response frames from the other.
- **Subprocess tests** locate the bin via `env!("CARGO_BIN_EXE_vimeflow-backend")` — Cargo guarantees the bin is built before integration tests run. A test helper `IpcClient` wraps `std::process::Command` + `Child::stdin/stdout` and provides `send_request(method, params) -> Response` / `read_event() -> Event` / `drop()` (which closes stdin and reaps the child with a 1s timeout).

### Coverage gate

Per the repo convention (`rules/CLAUDE.md` index, with co-located `.test.ts(x)` siblings on the TS side and `#[cfg(test)] mod tests` siblings on the Rust side), every new public function or trait impl in `ipc.rs` is tested by at least one unit test in the same module. Coverage targets:

- `frame::*` — branch coverage ≥ 90% (every error path tested).
- `router::dispatch` — branch coverage ≥ 80% (one happy path + one params-fail path per method).
- `StdoutEventSink` — 100% (success, closed channel, full channel).
- `run` / `spawn_handler` — branch coverage ≥ 70% (the main paths + cancellation + bad envelope).

### Pre-push gate

The existing pre-push gate (`vitest run` in husky) doesn't touch Rust. PR-B's `cargo test` runs as part of CI's `npm run` matrix; the integration tests are part of `cargo test` by default (Cargo's integration-test convention). CI must also run `cargo test --features e2e-test` to cover the cfg-gated 20th method's dispatch arm. No new pre-push hook is added.

---

## §4 Risks & mitigations

| Risk                                                                                            | Mitigation                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read_frame` resync budget is too small, splitting frames during real-world stdin noise         | RESYNC_BUDGET_BYTES = 64 KiB is generous — the renderer's largest single frame today (`get_git_diff` for a large file) is ~64 KiB tops. If we see budget-exhaustion in production, bump it. PR-B's tests cover the budget-exhaustion path explicitly so a regression-by-shrinkage trips the integration test.                                                                |
| Per-method decoder structs drift from `BackendState` signatures                                 | The router's match arms call `state.<method>(p.<field>)` directly; if the field type doesn't match, Rust won't compile. The per-method-decoder-table in §2.4 is a documentation aid, not a runtime check — drift is caught at build time.                                                                                                                                    |
| PTY threads outlive `BackendState::drop`, holding `tx` clones and preventing writer-task exit   | `main()` signals the writer task's shutdown token after `run` and `state.shutdown()` complete. The writer closes its receiver, rejects future sends from long-lived event producers, drains already-queued frames, and exits without depending on every sender clone being dropped.                                                                                          |
| Renderer's existing camelCase invoke shape differs from Tauri's auto-conversion for some method | The per-method-decoder-table in §2.4 is grounded in the actual call sites; cross-references in §2.4 list the source files. PR-B's subprocess parity tests are the runtime backstop — if a per-method decoder gets the camelCase shape wrong, the parity test asserting the in-process vs subprocess return values will fail.                                                 |
| Bounded stdout queue drops event frames if the writer is slow                                   | `StdoutEventSink::emit_json` returns an error when the queue is full; existing emit callers log those errors. Request responses use async `send().await`, so accepted requests backpressure instead of being silently dropped. This caps memory under stdout pipe backpressure while keeping the request/response contract intact.                                           |
| Sidecar crashes (panic, OOM) leave PTYs orphaned                                                | This is the same behavior as today: Tauri's `tauri::Builder` catches some panics, but `portable-pty`'s child kill semantics are platform-dependent. PR-D's Electron-main supervisor will detect sidecar exit and respawn (deferred — Goal 6 Non-goal #9). For PR-B, the integration test asserts no orphan after clean EOF, not after crash.                                 |
| `cargo test` for integration tests is slow because it spawns the bin per test                   | Acceptable for PR-B (20 methods × 1 test each ≈ 20s on a warm cache). If it becomes painful, batch multiple methods through one bin instance (the bin can serve many requests in sequence) — an optimization PR-C or PR-D can add when test count grows.                                                                                                                     |
| Loss of `tx`-send-order vs PTY-data emit-order if multiple tasks emit concurrently              | The writer task processes the channel in FIFO order (`Receiver::recv()`), so queued wall-clock-arrival order is preserved. Per-session ordering (PTY's own task emits its own events in order on its own thread/task) is preserved because each task's send calls are serial within that task. Cross-session interleaving is fine — the renderer keys events by `sessionId`. |
| Codex / future-Claude reviewer-of-this-spec is confused by §2.1's hand-written resync loop      | The §2.1 body is the implementation reference; if a reviewer suggests cutting it, point them at this risk row + Decision #13.                                                                                                                                                                                                                                                |

### Risk-free trade-offs (not in the table)

- Channel-based writer is strictly safer than `Mutex<BufWriter<Stdout>>` for the sync-vs-async tension (see Decision #5).
- The `BackendState::with_fake_sink()` test helper is reused unchanged from PR-A (no PR-B churn there).
- The integration tests don't depend on the renderer or Electron — they're pure Rust + cargo, runnable in CI matrices that don't have Node installed.

---

## §5 Sequencing contract (for PR-C / PR-D)

PR-B defines three contracts the downstream PRs consume. Changes to any of these mid-PR-B require updates to the consuming PR's spec before that PR opens.

### 5.1 — IPC wire envelope (consumed by PR-C)

PR-C's `src/lib/backend.ts` binds to the envelope shapes locked in §2.2:

- **Request:** `{"kind":"request","id":"<string>","method":"<name>","params":<object>}` — `params` is the camelCase object the renderer already constructs for `tauri::invoke(...)`.
- **Response (ok):** `{"kind":"response","id":"<string>","ok":true,"result":<value>}` — `result` is `null` for `()`-returning methods.
- **Response (err):** `{"kind":"response","id":"<string>","ok":false,"error":"<string>"}` — `error` is the `String` the BackendState method (or the router-decoder) returned.
- **Event:** `{"kind":"event","event":"<name>","payload":<value>}` — `payload` is the existing ts-rs derived serde shape; PR-B doesn't touch it.

PR-B guarantees:

- **`id` round-trips.** Whatever string the renderer puts in `id` is echoed back in the response. PR-C correlates requests to responses by `id`.
- **`kind` is the discriminator.** `"request"` / `"response"` / `"event"` are the only values PR-B produces. PR-C MUST gate on `kind` before reading method/event names.
- **Frame layer is LSP-style `Content-Length: N\r\n\r\n<body>`.** PR-C's preload (in PR-D) implements the framer; PR-B's stdout output is byte-identical to what PR-C will parse.
- **No partial frames.** PR-B's writer task always writes one complete header+body+flush per frame.

### 5.2 — Bin invocation contract (consumed by PR-D)

PR-D's `electron/main.ts` spawns the bin. PR-B guarantees:

- **Bin path (dev):** `src-tauri/target/debug/vimeflow-backend`.
- **Bin path (production):** PR-D's `electron-builder.extraResources` config copies the release-built bin alongside the packaged app; the exact resource-relative path is PR-D's call.
- **CLI:** `vimeflow-backend --app-data-dir <path>`. The path argument is required; passing other flags produces a stderr message and exit code 2.
- **Stdio:** stdin = request frames, stdout = response + event frames, stderr = `env_logger` output (level configurable via the `RUST_LOG` env var, default `warn`).
- **Exit codes:** `0` clean (stdin EOF); `1` runtime error (`FatalBadHeader`, `BodyTooLarge`, IO failure); `2` invalid argv. PR-D's supervisor MAY use these to differentiate respawn-worthy crashes (1) from configuration bugs (2).
- **Shutdown:** Electron main closes stdin → bin sees EOF → bin awaits already-accepted request handlers for up to 5 seconds → bin runs the `state.shutdown()` path (clean EOF only) → bin signals writer shutdown → writer closes the receiver and drains already-queued frames → bin exits 0 if drain succeeds. Clean EOF preserves queued responses for fast handlers but cancels/aborts handlers that exceed the drain window. Fatal protocol/runtime errors cancel through `CancellationToken`; methods that use `tokio::task::spawn_blocking` (some git operations, filesystem walks) may still run to their natural completion if already inside the blocking section. PR-D's supervisor SHOULD give the bin a generous shutdown window before sending SIGTERM, and only escalate to SIGKILL on supervisor timeout.

### 5.3 — Integration-test helper API (consumed by PR-D, optional)

PR-B ships an `IpcClient` test helper in `src-tauri/tests/ipc_subprocess.rs`. PR-D MAY reuse this helper in E2E test setup if it needs to drive the bin in isolation (e.g., regression tests for "the bin works even if Electron is dead"). PR-B does NOT promise the helper is public — PR-D extracts it into its own helper if needed.

Helper shape:

```rust
pub struct IpcClient {
    child: std::process::Child,
    next_id: u64,
}

impl IpcClient {
    pub fn spawn(app_data_dir: &Path) -> Self;
    pub fn send_request(&mut self, method: &str, params: serde_json::Value) -> ResponseFrame;
    pub fn read_event(&mut self, timeout: Duration) -> Option<EventFrame>;
    pub fn close_stdin(&mut self);  // Triggers EOF.
    pub fn wait_exit(&mut self, timeout: Duration) -> Option<ExitStatus>;
}
```

---

## §6 References

- `docs/superpowers/specs/2026-05-13-pr-a-runtime-neutral-rust-backend-design.md` — the input contract (§5.1 + §5.2). PR-B consumes the locked `BackendState` API and `EventSink` trait.
- `docs/superpowers/plans/2026-05-13-pr-a-runtime-neutral-rust-backend.md` — PR-A's executed plan. PR-B's implementation plan mirrors its TDD/per-task commit shape and the `/lifeline:upsource-review` watermark-trailer convention.
- `docs/superpowers/plans/2026-05-13-electron-rust-backend-migration.md` — the 4-PR migration roadmap. PR-B implements Task 4 ("Add Sidecar IPC Protocol") of that roadmap; the other tasks (1, 2, 5b, 5c, 6) are PR-A/PR-C/PR-D territory.
- `src-tauri/src/runtime/state.rs` — the dispatch target. The exact method signatures in §2.4's decoder table are derived from this file.
- `src-tauri/src/runtime/event_sink.rs` — the trait PR-B's `StdoutEventSink` implements. PR-B doesn't touch this file.
- `src-tauri/src/lib.rs` — Tauri host setup (kept unchanged). The `generate_handler!` list there is the source of the 19-method count.
- `src/features/{terminal,agent-status,diff,files}/**` — the call sites that ground the camelCase `params` contract. PR-C's `src/lib/backend.ts` replaces only the `invoke` source, not the call sites' argument shapes.
- `rules/common/design-philosophy.md` — Ousterhout's deep-module argument backing Decision #2 (single-file `runtime/ipc.rs`).
- `docs/reviews/patterns/async-race-conditions.md` — required reading for the test author. PR-B's PTY-data event ordering is preserved by the single-writer-task pattern.
- Memory entries:
  - [[feedback_lazy_reconciliation_over_shutdown_hooks]] — Decision #4 grounding (shutdown is best-effort, not load-bearing).
  - [[feedback_offset_cursor_for_replay]] — PTY replay-then-stream contract that the existing `BackendState::spawn_pty` already implements; PR-B preserves it via byte-identical event ordering.
  - [[feedback_filesystem_cache_for_pty]] — `SessionCache` lives in `app_data_dir`; PR-B's `--app-data-dir` is the contract for telling the bin where.

---

## §7 Next step after approval

After this spec is codex-reviewed (Step 8) and approved, invoke `superpowers:writing-plans` for the PR-B implementation plan. The plan breaks PR-B into ordered TDD tasks, mirroring PR-A's plan shape:

1. Baseline verification — `cargo test` + `cargo test --features e2e-test` both green.
2. Cargo.toml — extend tokio features, add tokio-util/env_logger, add `[[bin]]` block (no behavior change yet).
3. `runtime/ipc.rs` skeleton — empty module + `pub mod ipc;` in `runtime/mod.rs` (compiles, does nothing).
4. `mod frame` — `read_frame` + `format_frame` + tests (TDD: write codec tests first).
5. Envelope types — `InboundFrame` + `RequestFrame` + `ResponseFrame` + tests (TDD: round-trip via serde_json).
6. `StdoutEventSink` + tests (TDD: send into a (tx, rx) pair, assert recv).
7. `mod router` — one match arm at a time (TDD: each arm gets one happy-path + one error-path test against `BackendState::with_fake_sink`).
8. `run` + `spawn_handler` + `writer_task` + tests (TDD: tokio::io::duplex pipe).
9. `bin/vimeflow-backend.rs` — wire it all together.
10. `tests/ipc_subprocess.rs` — one parity test per method (TDD: per-method, red→green).
11. Manual smoke — `cd src-tauri && cargo build --bin vimeflow-backend && echo '{...}' | ...` produces expected response.
12. Final verification gate — `cargo test`, `cargo test --features e2e-test`, `npm run tauri:dev` (Tauri host still works), `npm run type-check` (no TS churn).

TDD per task: red test → green implementation → refactor → commit behind the watermark trailers `/lifeline:upsource-review` consumes (`Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`).

PR-C's planner run is next (the renderer side). PR-D's planner run is after PR-C merges.

<!-- codex-reviewed: 2026-05-14T02:23:41Z -->

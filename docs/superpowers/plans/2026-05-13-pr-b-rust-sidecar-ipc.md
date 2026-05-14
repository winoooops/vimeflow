# PR-B — Rust sidecar binary + IPC protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `vimeflow-backend` sidecar bin + an LSP-style JSON-RPC IPC layer over stdio (`src-tauri/src/runtime/ipc.rs`) that dispatches to the `BackendState` API PR-A locked in §5.1, while the Tauri host stays as the production runtime through end of PR-B.

**Architecture:** New file `src-tauri/src/runtime/ipc.rs` holds the whole IPC layer: a `mod frame` codec (LSP `Content-Length: N\r\n\r\n<body>`), tagged envelope types (`InboundFrame::Request` / `ResponseFrame` / event-frame inline), a `mod router` match-arm dispatch over the 19 + 1 production methods with per-arm `#[serde(rename_all = "camelCase")]` decoder structs, a `StdoutEventSink` (impls `EventSink`) that formats frames and pushes them onto a `tokio::sync::mpsc::UnboundedSender<Vec<u8>>`, and a single writer task draining the channel to `tokio::io::stdout()`. The bin shim parses `--app-data-dir`, builds `Arc<BackendState>` with the channel-backed sink, runs `runtime::ipc::run(...)`, and exits 0 only after writer drain — calling `state.shutdown()` only on clean stdin-EOF (never on errors, so protocol corruption doesn't wipe the session cache).

**Tech Stack:** Rust 2021, Tokio (multi-thread runtime), tokio-util `CancellationToken`, serde / serde_json, env_logger, tempfile (dev), portable-pty (transitive via PR-A).

**Spec:** `docs/superpowers/specs/2026-05-13-pr-b-rust-sidecar-ipc-design.md`

**Migration roadmap:** `docs/superpowers/plans/2026-05-13-electron-rust-backend-migration.md` (the 4-PR index). This plan implements Task 4 of that roadmap.

---

## File Structure

### New (3 files)

- `src-tauri/src/bin/vimeflow-backend.rs` — `#[tokio::main(flavor = "multi_thread")]` entry. Parses `--app-data-dir`, wires the writer-channel, builds `Arc<BackendState>` with `StdoutEventSink`, calls `runtime::ipc::run`. Shuts down only on clean EOF.
- `src-tauri/src/runtime/ipc.rs` — the whole IPC layer. Submodules `frame` (codec) and `router` (dispatch); public `StdoutEventSink`, `run`, and `writer_task`.
- `src-tauri/tests/ipc_subprocess.rs` — Cargo integration test. `IpcClient` helper + one wire-shape test per method (asserts response `kind`/`id`/`ok`/`result` non-null; no byte-level parity here — that's in `ipc.rs::tests`).

### Modified (2 files)

- `src-tauri/Cargo.toml` — extend `tokio` features (`+rt-multi-thread`, `+io-std`); add `tokio-util` and `env_logger` to `[dependencies]`; add `[[bin]]` block.
- `src-tauri/src/runtime/mod.rs` — add `pub mod ipc;`.

### Files NOT touched

- `src-tauri/src/lib.rs` (Tauri host unchanged).
- `src-tauri/src/runtime/{event_sink,state,tauri_bridge,test_event_sink}.rs` (PR-A surface).
- `src-tauri/src/{terminal,filesystem,git,agent}/**`.
- `src/**`, `package.json`, `vite.config.ts`, `tests/e2e/**`, `src/bindings/**`.

---

## Task 0: Baseline Verification

**Files:** none.

- [ ] **Step 1: Confirm working tree is clean and on `dev`**

```bash
cd /home/will/projects/vimeflow
git status
git branch --show-current
```

Expected: `nothing to commit, working tree clean`. Branch: `dev` (or whatever feature branch this PR-B work lives on; if a separate branch is desired, create it BEFORE Task 1 via `git checkout -b feat/pr-b-rust-sidecar-ipc`).

- [ ] **Step 2: Confirm Rust tests are green (default features)**

```bash
cd /home/will/projects/vimeflow/src-tauri
cargo test
```

Expected: all tests pass. Record the test count for comparison in Task 10.

- [ ] **Step 3: Confirm Rust tests are green (e2e-test feature)**

```bash
cd /home/will/projects/vimeflow/src-tauri
cargo test --features e2e-test
```

Expected: all tests pass.

- [ ] **Step 4: Confirm TS tests + type-check + lint are green**

```bash
cd /home/will/projects/vimeflow
npm run test
npm run type-check
npm run lint
```

Expected: all green.

- [ ] **Step 5: Smoke-check the Tauri host before any change**

```bash
cd /home/will/projects/vimeflow
npm run tauri:dev
```

Open the app, confirm: default terminal spawns, file explorer lists, git diff panel shows status, Cmd/Ctrl+Q closes cleanly. Kill the dev server. This is the "renderer cannot tell the difference" baseline.

---

## Task 1: Cargo.toml — extend tokio features, add tokio-util + env_logger + [[bin]] block

**Files:**

- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Read current Cargo.toml**

```bash
cat /home/will/projects/vimeflow/src-tauri/Cargo.toml
```

Confirm the existing `tokio` line reads:

```toml
tokio = { version = "1", features = ["sync", "io-util", "time", "rt", "macros"] }
```

If the feature list has drifted from this expected baseline, STOP and reconcile with the spec before continuing.

- [ ] **Step 2: Extend the `tokio` feature list and add new deps**

Replace the existing `tokio` line with the extended list, AND add `tokio-util` + `env_logger` immediately below it. The final relevant section should read:

```toml
tokio = { version = "1", features = ["sync", "io-util", "io-std", "time", "rt", "rt-multi-thread", "macros"] }
tokio-util = { version = "0.7", features = ["rt"] }
notify = "6"
dirs = "6"
ignore = "0.4"
tempfile = "3"
chrono = "0.4"
shell-words = "1.1"
regex = "1.10"
rusqlite = { version = "0.32", features = ["bundled"] }
once_cell = "1.19"
env_logger = "0.11"
```

(`tokio-util`'s `rt` feature is what gates `tokio_util::sync::CancellationToken` in 0.7. There is no `sync` feature — see spec §1 modified-files row.)

- [ ] **Step 3: Add the `[[bin]]` block**

Append to the end of `src-tauri/Cargo.toml` (after `[dev-dependencies]`):

```toml

[[bin]]
name = "vimeflow-backend"
path = "src/bin/vimeflow-backend.rs"
```

Do NOT set `required-features = ["e2e-test"]` — spec Decision #8 says that would block production builds. The `e2e-test` feature continues to cfg-gate `BackendState::list_active_pty_sessions` at the library level only.

- [ ] **Step 4: Verify Cargo manifest still parses**

```bash
cd /home/will/projects/vimeflow/src-tauri
cargo build --lib
```

Expected: clean build. (We can't yet `cargo build --bin vimeflow-backend` because the bin file doesn't exist — that's Task 8.)

- [ ] **Step 5: Verify the library tests still pass with the new tokio features**

```bash
cd /home/will/projects/vimeflow/src-tauri
cargo test --lib
```

Expected: identical test count to Task 0 Step 2; all green. Adding `rt-multi-thread` and `io-std` to the tokio feature list is purely additive — no behavior change.

- [ ] **Step 6: Commit**

```bash
cd /home/will/projects/vimeflow
git add src-tauri/Cargo.toml
git commit -m "$(cat <<'EOF'
chore(backend): extend tokio features + add tokio-util/env_logger + [[bin]] entry for vimeflow-backend

Prep for PR-B's sidecar implementation. The [[bin]] target file is not
yet created — `cargo build --bin vimeflow-backend` will fail until Task 8.
`cargo build --lib` and `cargo test --lib` both stay green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add the empty `runtime/ipc` module

**Files:**

- Create: `src-tauri/src/runtime/ipc.rs`
- Modify: `src-tauri/src/runtime/mod.rs`

- [ ] **Step 1: Create the empty `ipc.rs`**

Create `src-tauri/src/runtime/ipc.rs` with this content:

```rust
//! LSP-style JSON-RPC IPC layer for the `vimeflow-backend` sidecar.
//!
//! PR-B (spec: docs/superpowers/specs/2026-05-13-pr-b-rust-sidecar-ipc-design.md).
//! Submodules `frame` (codec) and `router` (dispatch) are added in later tasks.
```

- [ ] **Step 2: Wire `ipc` into the runtime module**

Edit `src-tauri/src/runtime/mod.rs`:

```rust
//! Runtime-neutral backend layer. Production builds bind to Tauri via
//! `TauriEventSink`; PR-B will add a sidecar IPC sink. Tests use
//! `FakeEventSink`.

pub mod event_sink;
pub mod ipc;
pub mod state;
pub mod tauri_bridge;

pub(crate) use event_sink::serialize_event;
pub use event_sink::EventSink;
pub use state::BackendState;
pub use tauri_bridge::TauriEventSink;

#[cfg(any(test, feature = "e2e-test"))]
pub use event_sink::FakeEventSink;
```

(Only diff: insert `pub mod ipc;` between `pub mod event_sink;` and `pub mod state;` so the file order stays alphabetical.)

- [ ] **Step 3: Verify the crate compiles**

```bash
cd /home/will/projects/vimeflow/src-tauri
cargo build --lib
```

Expected: clean build with no new warnings.

- [ ] **Step 4: Commit**

```bash
cd /home/will/projects/vimeflow
git add src-tauri/src/runtime/ipc.rs src-tauri/src/runtime/mod.rs
git commit -m "$(cat <<'EOF'
feat(backend/ipc): scaffold empty runtime/ipc module

Empty module + `pub mod ipc;` wiring. Frame codec, envelopes, router,
sink, run loop, and writer task come in Tasks 3-7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `mod frame` — codec + FrameError + tests

**Files:**

- Modify: `src-tauri/src/runtime/ipc.rs`

This task implements the codec from spec §2.1. TDD: write the codec tests first, watch them fail, then implement.

- [ ] **Step 1: Add the `frame` module skeleton + `FrameError` variants + constants**

Append to `src-tauri/src/runtime/ipc.rs`:

```rust
mod frame {
    use std::io;
    use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWriteExt};

    /// Maximum body bytes per frame. Protects against a malicious or buggy
    /// peer triggering unbounded allocation.
    pub const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;

    /// Hard cap on a single header line. Bounds per-line allocation so a peer
    /// flooding bytes-without-newline cannot force unbounded growth before
    /// the resync-byte budget triggers.
    pub const MAX_HEADER_LINE_BYTES: u64 = 8 * 1024;

    /// Soft cap on bytes consumed while resyncing past malformed header noise.
    /// Hitting this is non-recoverable corruption — the run loop returns Err
    /// (FatalBadHeader) and the bin exits 1.
    pub const RESYNC_BUDGET_BYTES: u64 = 64 * 1024;

    #[derive(Debug)]
    pub enum FrameError {
        /// Header line malformed but the codec advanced past it without
        /// exceeding RESYNC_BUDGET_BYTES. The caller `continue`s the read loop.
        ResyncableBadHeader(String),
        /// Header parsing exhausted RESYNC_BUDGET_BYTES or hit a hard limit
        /// like MAX_HEADER_LINE_BYTES. Fatal — caller exits.
        FatalBadHeader(String),
        /// Body length exceeds MAX_FRAME_BYTES. Fatal — caller exits.
        BodyTooLarge { len: usize },
        /// Underlying IO failure (including unexpected mid-frame EOF).
        Io(io::Error),
    }

    impl From<io::Error> for FrameError {
        fn from(err: io::Error) -> Self {
            Self::Io(err)
        }
    }

    /// Synchronous helper used upstream of the writer channel. Allocates a
    /// `Vec<u8>` containing `Content-Length: N\r\n\r\n<body>`.
    pub fn format_frame(body: &[u8]) -> Vec<u8> {
        let header = format!("Content-Length: {}\r\n\r\n", body.len());
        let mut out = Vec::with_capacity(header.len() + body.len());
        out.extend_from_slice(header.as_bytes());
        out.extend_from_slice(body);
        out
    }

    /// Async write of one full frame: header + body + flush. Called by the
    /// single writer task; serialization is the channel's job, not the lock.
    pub async fn write_frame<W: AsyncWriteExt + Unpin>(
        writer: &mut W,
        body: &[u8],
    ) -> io::Result<()> {
        let header = format!("Content-Length: {}\r\n\r\n", body.len());
        writer.write_all(header.as_bytes()).await?;
        writer.write_all(body).await?;
        writer.flush().await
    }

    /// Read one full frame from `reader`. Returns Ok(Some(body)) on a valid
    /// frame, Ok(None) on clean inter-frame EOF, Err otherwise.
    ///
    /// The header block is one or more `Name: Value\r\n` lines followed by a
    /// single `\r\n`. `Content-Length` is mandatory; other headers are ignored
    /// (LSP convention). Lines are read via `fill_buf` + `consume` with a hard
    /// MAX_HEADER_LINE_BYTES cap so a peer can't force unbounded allocation.
    pub async fn read_frame<R: AsyncBufRead + Unpin>(
        reader: &mut R,
    ) -> Result<Option<Vec<u8>>, FrameError> {
        let mut resync_consumed: u64 = 0;
        let mut content_length: Option<usize> = None;

        loop {
            // Read one header line with a per-line cap.
            let mut line: Vec<u8> = Vec::with_capacity(128);
            let n = loop {
                let chunk = reader.fill_buf().await.map_err(FrameError::Io)?;
                if chunk.is_empty() {
                    break line.len();
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

            // EOF detection.
            if n == 0 {
                if resync_consumed == 0 && content_length.is_none() {
                    return Ok(None); // Clean inter-frame EOF.
                }
                return Err(FrameError::Io(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "eof mid-header",
                )));
            }

            let line_str = std::str::from_utf8(&line)
                .map_err(|err| FrameError::FatalBadHeader(format!("header utf8: {err}")))?;
            let trimmed = line_str.trim_end_matches(['\r', '\n']);

            if trimmed.is_empty() {
                // Blank line ends the header block iff we got a Content-Length.
                if let Some(len) = content_length {
                    if len > MAX_FRAME_BYTES {
                        return Err(FrameError::BodyTooLarge { len });
                    }
                    let mut body = vec![0u8; len];
                    reader
                        .read_exact(&mut body)
                        .await
                        .map_err(FrameError::Io)?;
                    return Ok(Some(body));
                }
                // Stray blank line during resync.
                resync_consumed = resync_consumed.saturating_add(n as u64);
                if resync_consumed > RESYNC_BUDGET_BYTES {
                    return Err(FrameError::FatalBadHeader(
                        "resync budget exhausted (no Content-Length)".into(),
                    ));
                }
                continue;
            }

            if let Some((name, value)) = trimmed.split_once(':') {
                if name.trim().eq_ignore_ascii_case("Content-Length") {
                    match value.trim().parse::<usize>() {
                        Ok(len) => {
                            content_length = Some(len);
                            continue;
                        }
                        Err(err) => {
                            resync_consumed = resync_consumed.saturating_add(n as u64);
                            if resync_consumed > RESYNC_BUDGET_BYTES {
                                return Err(FrameError::FatalBadHeader(format!(
                                    "non-numeric content-length: {err}"
                                )));
                            }
                            content_length = None;
                            continue;
                        }
                    }
                }
                // Unknown header — ignore. Well-formed `Name: Value` does
                // NOT count against the resync budget.
                continue;
            }

            // Line is neither `Name: Value` nor blank — resync noise.
            resync_consumed = resync_consumed.saturating_add(n as u64);
            if resync_consumed > RESYNC_BUDGET_BYTES {
                return Err(FrameError::FatalBadHeader(format!(
                    "no Content-Length within {RESYNC_BUDGET_BYTES} bytes of garbage"
                )));
            }
        }
    }
}
```

- [ ] **Step 2: Add the failing codec tests inside `ipc.rs`**

Still in `src-tauri/src/runtime/ipc.rs`, append:

```rust
#[cfg(test)]
mod tests {
    use super::frame;
    use tokio::io::AsyncWriteExt;

    fn make_reader(bytes: &[u8]) -> tokio::io::BufReader<&[u8]> {
        tokio::io::BufReader::new(bytes)
    }

    #[tokio::test]
    async fn format_frame_prepends_content_length() {
        let body = br#"{"kind":"event","event":"x"}"#;
        let framed = frame::format_frame(body);
        let s = std::str::from_utf8(&framed).expect("utf8");
        assert!(s.starts_with(&format!("Content-Length: {}\r\n\r\n", body.len())));
        assert!(s.ends_with(std::str::from_utf8(body).unwrap()));
    }

    #[tokio::test]
    async fn format_frame_handles_empty_body() {
        let framed = frame::format_frame(b"");
        assert_eq!(framed, b"Content-Length: 0\r\n\r\n");
    }

    #[tokio::test]
    async fn read_frame_decodes_well_formed_frame() {
        let body = br#"{"k":"v"}"#;
        let mut input = Vec::new();
        input.extend_from_slice(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes());
        input.extend_from_slice(body);
        let mut reader = make_reader(&input);
        let got = frame::read_frame(&mut reader).await.expect("ok");
        assert_eq!(got.as_deref(), Some(body.as_slice()));
    }

    #[tokio::test]
    async fn read_frame_returns_none_on_clean_eof() {
        let mut reader = make_reader(b"");
        let got = frame::read_frame(&mut reader).await.expect("ok");
        assert_eq!(got, None);
    }

    #[tokio::test]
    async fn read_frame_returns_unexpected_eof_mid_body() {
        // Header promises 10 bytes; only 5 follow.
        let input = b"Content-Length: 10\r\n\r\nhello";
        let mut reader = make_reader(input);
        let err = frame::read_frame(&mut reader).await.expect_err("err");
        match err {
            frame::FrameError::Io(io_err) => {
                assert_eq!(io_err.kind(), std::io::ErrorKind::UnexpectedEof);
            }
            other => panic!("expected Io(UnexpectedEof), got {other:?}"),
        }
    }

    #[tokio::test]
    async fn read_frame_rejects_oversize_body() {
        let len = frame::MAX_FRAME_BYTES + 1;
        let input = format!("Content-Length: {len}\r\n\r\n");
        let mut reader = make_reader(input.as_bytes());
        let err = frame::read_frame(&mut reader).await.expect_err("err");
        match err {
            frame::FrameError::BodyTooLarge { len: l } => assert_eq!(l, len),
            other => panic!("expected BodyTooLarge, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn read_frame_ignores_extra_headers() {
        let body = b"{}";
        let mut input = Vec::new();
        input.extend_from_slice(b"X-Foo: bar\r\n");
        input.extend_from_slice(format!("Content-Length: {}\r\n", body.len()).as_bytes());
        input.extend_from_slice(b"X-Trace: 42\r\n\r\n");
        input.extend_from_slice(body);
        let mut reader = make_reader(&input);
        let got = frame::read_frame(&mut reader).await.expect("ok");
        assert_eq!(got.as_deref(), Some(body.as_slice()));
    }

    #[tokio::test]
    async fn read_frame_resyncs_past_garbage_lines_within_budget() {
        let body = b"{}";
        let mut input = Vec::new();
        // ~2 KiB of garbage, well under the 64 KiB resync budget.
        for _ in 0..40 {
            input.extend_from_slice(b"garbage-line-no-colon-here-just-noise\r\n");
        }
        input.extend_from_slice(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes());
        input.extend_from_slice(body);
        let mut reader = make_reader(&input);
        let got = frame::read_frame(&mut reader).await.expect("ok");
        assert_eq!(got.as_deref(), Some(body.as_slice()));
    }

    #[tokio::test]
    async fn read_frame_fatal_when_resync_budget_exhausted() {
        // ~128 KiB of garbage, exceeding the 64 KiB budget. No Content-Length ever appears.
        let mut input = Vec::new();
        for _ in 0..3000 {
            input.extend_from_slice(b"garbage-line-no-colon-here-just-noise\r\n");
        }
        let mut reader = make_reader(&input);
        let err = frame::read_frame(&mut reader).await.expect_err("err");
        match err {
            frame::FrameError::FatalBadHeader(_) => {}
            other => panic!("expected FatalBadHeader, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn read_frame_fatal_when_header_line_exceeds_max() {
        let mut input = Vec::new();
        // Single header line >8 KiB with no newline.
        let big = vec![b'A'; (frame::MAX_HEADER_LINE_BYTES + 1) as usize];
        input.extend_from_slice(&big);
        let mut reader = make_reader(&input);
        let err = frame::read_frame(&mut reader).await.expect_err("err");
        match err {
            frame::FrameError::FatalBadHeader(_) => {}
            other => panic!("expected FatalBadHeader, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn write_frame_round_trips_through_read_frame() {
        let body = br#"{"a":1,"b":"two"}"#;
        let mut buf: Vec<u8> = Vec::new();
        frame::write_frame(&mut buf, body).await.expect("write");
        let mut reader = make_reader(&buf);
        let got = frame::read_frame(&mut reader).await.expect("ok");
        assert_eq!(got.as_deref(), Some(body.as_slice()));
    }
}
```

- [ ] **Step 3: Run the codec tests**

```bash
cd /home/will/projects/vimeflow/src-tauri
cargo test --lib runtime::ipc::tests::
```

Expected: all 10 frame tests pass. If any fail, fix the implementation in Step 1 before continuing — do not move to Task 4.

- [ ] **Step 4: Commit**

```bash
cd /home/will/projects/vimeflow
git add src-tauri/src/runtime/ipc.rs
git commit -m "$(cat <<'EOF'
feat(backend/ipc): add frame codec (read_frame / write_frame / format_frame)

LSP-style Content-Length framing per spec §2.1. Header-line cap
(MAX_HEADER_LINE_BYTES = 8 KiB) via fill_buf/consume to bound
allocation; resync budget (RESYNC_BUDGET_BYTES = 64 KiB) for
ResyncableBadHeader → continue, exhaustion → FatalBadHeader.

10 codec tests: format roundtrip, well-formed frame, clean EOF,
mid-body EOF, oversize body, extra-header ignore, resync within
budget, fatal resync, fatal long line, write+read roundtrip.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Envelope types — `InboundFrame` / `RequestFrame` / `ResponseFrame`

**Files:**

- Modify: `src-tauri/src/runtime/ipc.rs`

- [ ] **Step 1: Add envelope types at the top of `ipc.rs` (above `mod frame`)**

Replace the file-level docstring comment with the docstring + envelope type definitions, leaving `mod frame` and the existing `mod tests` exactly as they are. The added block sits after the module docstring:

```rust
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum InboundFrame {
    Request(RequestFrame),
}

#[derive(Debug, Deserialize)]
struct RequestFrame {
    id: String,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct ResponseFrame<'a> {
    kind: &'static str,
    id: &'a str,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<&'a Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'a str>,
}

impl<'a> ResponseFrame<'a> {
    fn ok(id: &'a str, result: &'a Value) -> Self {
        Self {
            kind: "response",
            id,
            ok: true,
            result: Some(result),
            error: None,
        }
    }

    fn err(id: &'a str, error: &'a str) -> Self {
        Self {
            kind: "response",
            id,
            ok: false,
            result: None,
            error: Some(error),
        }
    }
}
```

- [ ] **Step 2: Add envelope tests inside the existing `mod tests` (append after the frame tests)**

```rust
    #[test]
    fn inbound_request_deserializes() {
        let raw = br#"{"kind":"request","id":"42","method":"git_status","params":{"cwd":"/tmp"}}"#;
        let frame: super::InboundFrame = serde_json::from_slice(raw).expect("deserialize");
        match frame {
            super::InboundFrame::Request(req) => {
                assert_eq!(req.id, "42");
                assert_eq!(req.method, "git_status");
                assert_eq!(req.params["cwd"], "/tmp");
            }
        }
    }

    #[test]
    fn inbound_request_allows_absent_params() {
        let raw = br#"{"kind":"request","id":"1","method":"list_sessions"}"#;
        let frame: super::InboundFrame = serde_json::from_slice(raw).expect("deserialize");
        match frame {
            super::InboundFrame::Request(req) => assert_eq!(req.params, serde_json::Value::Null),
        }
    }

    #[test]
    fn inbound_rejects_wrong_kind() {
        let raw = br#"{"kind":"response","id":"1","ok":true}"#;
        let err = serde_json::from_slice::<super::InboundFrame>(raw).expect_err("err");
        assert!(err.to_string().contains("unknown variant"), "got {err}");
    }

    #[test]
    fn response_ok_serializes_with_kind_response_and_result() {
        let result = serde_json::json!({"hello": "world"});
        let frame = super::ResponseFrame::ok("99", &result);
        let bytes = serde_json::to_vec(&frame).expect("serialize");
        let val: serde_json::Value = serde_json::from_slice(&bytes).expect("parse");
        assert_eq!(val["kind"], "response");
        assert_eq!(val["id"], "99");
        assert_eq!(val["ok"], true);
        assert_eq!(val["result"]["hello"], "world");
        assert!(val.get("error").is_none());
    }

    #[test]
    fn response_err_serializes_with_error_field_and_no_result() {
        let frame = super::ResponseFrame::err("99", "boom");
        let bytes = serde_json::to_vec(&frame).expect("serialize");
        let val: serde_json::Value = serde_json::from_slice(&bytes).expect("parse");
        assert_eq!(val["kind"], "response");
        assert_eq!(val["ok"], false);
        assert_eq!(val["error"], "boom");
        assert!(val.get("result").is_none());
    }
```

- [ ] **Step 3: Run the envelope tests**

```bash
cd /home/will/projects/vimeflow/src-tauri
cargo test --lib runtime::ipc::tests::
```

Expected: 15 total tests pass (10 frame + 5 envelope).

- [ ] **Step 4: Commit**

```bash
cd /home/will/projects/vimeflow
git add src-tauri/src/runtime/ipc.rs
git commit -m "$(cat <<'EOF'
feat(backend/ipc): add InboundFrame / RequestFrame / ResponseFrame envelopes

Tagged InboundFrame ensures only kind=="request" bodies dispatch.
ResponseFrame{ok}/ResponseFrame{err} constructors keep result vs
error fields mutually exclusive via skip_serializing_if. 5 envelope
tests cover deserialize happy path, absent-params default, wrong-kind
rejection, ok serialize shape, err serialize shape.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `StdoutEventSink` — channel-based event sink

**Files:**

- Modify: `src-tauri/src/runtime/ipc.rs`

- [ ] **Step 1: Add `StdoutEventSink` above `mod frame`**

Insert after the envelope types from Task 4, before `mod frame`:

```rust
use tokio::sync::mpsc::UnboundedSender;

use crate::runtime::event_sink::EventSink;

/// Event sink that formats LSP frames synchronously and pushes them onto an
/// unbounded mpsc channel. The single writer task drains the channel into
/// `tokio::io::stdout()`. No Mutex on the writer path — channel arrival order
/// IS the serialization.
pub struct StdoutEventSink {
    tx: UnboundedSender<Vec<u8>>,
}

impl StdoutEventSink {
    pub fn new(tx: UnboundedSender<Vec<u8>>) -> Self {
        Self { tx }
    }
}

impl EventSink for StdoutEventSink {
    fn emit_json(&self, event: &str, payload: Value) -> Result<(), String> {
        let body = serde_json::to_vec(&serde_json::json!({
            "kind": "event",
            "event": event,
            "payload": payload,
        }))
        .map_err(|err| format!("event encode {event}: {err}"))?;
        self.tx
            .send(frame::format_frame(&body))
            .map_err(|_| format!("stdout writer closed; cannot emit {event}"))?;
        Ok(())
    }
}
```

- [ ] **Step 2: Add the sink tests inside `mod tests`**

```rust
    #[tokio::test]
    async fn stdout_event_sink_pushes_framed_event_to_channel() {
        use crate::runtime::EventSink;
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let sink = super::StdoutEventSink::new(tx);
        sink.emit_json("pty-data", serde_json::json!({"sessionId": "s1", "data": "hi"}))
            .expect("emit");
        let framed = rx.try_recv().expect("a frame was pushed");
        let s = std::str::from_utf8(&framed).expect("utf8");
        assert!(s.starts_with("Content-Length: "));
        let body_start = s.find("\r\n\r\n").expect("delimiter") + 4;
        let body: serde_json::Value = serde_json::from_str(&s[body_start..]).expect("parse");
        assert_eq!(body["kind"], "event");
        assert_eq!(body["event"], "pty-data");
        assert_eq!(body["payload"]["sessionId"], "s1");
        assert_eq!(body["payload"]["data"], "hi");
    }

    #[tokio::test]
    async fn stdout_event_sink_errors_when_channel_closed() {
        use crate::runtime::EventSink;
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        drop(rx);
        let sink = super::StdoutEventSink::new(tx);
        let err = sink
            .emit_json("pty-data", serde_json::json!({}))
            .expect_err("expected err");
        assert!(err.contains("stdout writer closed"), "got {err}");
    }
```

- [ ] **Step 3: Run the sink tests**

```bash
cd /home/will/projects/vimeflow/src-tauri
cargo test --lib runtime::ipc::tests::stdout_event_sink
```

Expected: both tests pass. Run the whole module suite to confirm no regression:

```bash
cargo test --lib runtime::ipc::tests::
```

Expected: 17 total tests pass.

- [ ] **Step 4: Commit**

```bash
cd /home/will/projects/vimeflow
git add src-tauri/src/runtime/ipc.rs
git commit -m "$(cat <<'EOF'
feat(backend/ipc): add channel-based StdoutEventSink

Implements EventSink (sync trait, fits PR-A §5.2 lock) by formatting
the LSP frame upfront and pushing the byte-vec onto an unbounded
mpsc channel. No Mutex on the writer path — Decision #5. Closed
channel surfaces as an emit error string the caller can log.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `mod router` — match-arm dispatch

**Files:**

- Modify: `src-tauri/src/runtime/ipc.rs`

This is the biggest task. The router has 19 production arms + 1 cfg-gated arm. We add them in three batches, TDD per batch.

### Task 6a: Three representative arms (struct, primitive, multi-primitive)

- [ ] **Step 1: Add `mod router` skeleton with the three representative arms**

Append to `src-tauri/src/runtime/ipc.rs` (after `mod frame`):

```rust
mod router {
    use serde::Deserialize;
    use serde_json::Value;
    use std::sync::Arc;

    use crate::runtime::BackendState;

    /// Dispatch a parsed request to BackendState. Returns Ok(value) for happy
    /// paths (value is `Value::Null` for `()`-returning methods) and Err(msg)
    /// for param-decode failures, BackendState errors, and unknown methods.
    /// The caller wraps the outcome into a ResponseFrame.
    pub async fn dispatch(
        state: Arc<BackendState>,
        method: &str,
        params: Value,
    ) -> Result<Value, String> {
        match method {
            "spawn_pty" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct P {
                    request: crate::terminal::types::SpawnPtyRequest,
                }
                let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                let res = state.spawn_pty(p.request).await?;
                serde_json::to_value(res).map_err(|e| format!("result encode: {e}"))
            }
            "start_agent_watcher" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct P {
                    session_id: String,
                }
                let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                state.start_agent_watcher(p.session_id).await?;
                Ok(Value::Null)
            }
            "get_git_diff" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct P {
                    cwd: String,
                    file: String,
                    staged: bool,
                    #[serde(default)]
                    untracked: Option<bool>,
                }
                let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                let diff = state.get_git_diff(p.cwd, p.file, p.staged, p.untracked).await?;
                serde_json::to_value(diff).map_err(|e| format!("result encode: {e}"))
            }
            _ => Err(format!("unknown method: {method}")),
        }
    }
}
```

- [ ] **Step 2: Add tests for the three representative arms**

Inside `mod tests`, append:

```rust
    #[tokio::test]
    async fn dispatch_unknown_method_errors() {
        let (state, _sink) = crate::runtime::BackendState::with_fake_sink();
        let err = super::router::dispatch(state, "no_such_method", serde_json::json!({}))
            .await
            .expect_err("err");
        assert!(err.starts_with("unknown method: no_such_method"), "got {err}");
    }

    #[tokio::test]
    async fn dispatch_start_agent_watcher_happy_path_returns_null() {
        let (state, _sink) = crate::runtime::BackendState::with_fake_sink();
        // session id is just a string at this layer; the call may error inside
        // BackendState because no PTY exists for it — that's fine, we only
        // assert that param decoding works and the method is reached.
        let params = serde_json::json!({"sessionId": "unknown-session"});
        let outcome = super::router::dispatch(state, "start_agent_watcher", params).await;
        match outcome {
            Ok(v) => assert_eq!(v, serde_json::Value::Null),
            Err(msg) => {
                // BackendState error is acceptable here; the params-decode error
                // would have started with "params:" — assert it didn't.
                assert!(!msg.starts_with("params:"), "params decode unexpectedly failed: {msg}");
            }
        }
    }

    #[tokio::test]
    async fn dispatch_start_agent_watcher_rejects_snake_case_params() {
        // The wire is camelCase; passing snake_case must fail to decode.
        let (state, _sink) = crate::runtime::BackendState::with_fake_sink();
        let params = serde_json::json!({"session_id": "s1"});
        let err = super::router::dispatch(state, "start_agent_watcher", params)
            .await
            .expect_err("err");
        assert!(err.starts_with("params:"), "got {err}");
    }

    #[tokio::test]
    async fn dispatch_get_git_diff_decodes_optional_untracked() {
        // Don't actually run git here; we just verify the decoder accepts both
        // the full and the omit-untracked shapes.
        let (state, _sink) = crate::runtime::BackendState::with_fake_sink();

        let p_full = serde_json::json!({
            "cwd": "/tmp/nope",
            "file": "README.md",
            "staged": false,
            "untracked": true,
        });
        // BackendState::get_git_diff will error on a nonexistent cwd — that's
        // a non-"params:" error, which proves decoding succeeded.
        let r_full = super::router::dispatch(state.clone(), "get_git_diff", p_full).await;
        assert!(
            matches!(&r_full, Err(msg) if !msg.starts_with("params:")),
            "expected non-params error, got {r_full:?}"
        );

        let p_min = serde_json::json!({"cwd": "/tmp/nope", "file": "README.md", "staged": false});
        let r_min = super::router::dispatch(state, "get_git_diff", p_min).await;
        assert!(
            matches!(&r_min, Err(msg) if !msg.starts_with("params:")),
            "expected non-params error, got {r_min:?}"
        );
    }
```

- [ ] **Step 3: Run the new dispatch tests**

```bash
cd /home/will/projects/vimeflow/src-tauri
cargo test --lib runtime::ipc::tests::dispatch_
```

Expected: 4 tests pass. Run the whole module to confirm:

```bash
cargo test --lib runtime::ipc::tests::
```

Expected: 21 total tests pass.

- [ ] **Step 4: Commit**

```bash
cd /home/will/projects/vimeflow
git add src-tauri/src/runtime/ipc.rs
git commit -m "$(cat <<'EOF'
feat(backend/ipc): add router skeleton + 3 representative dispatch arms

spawn_pty (struct arg), start_agent_watcher (primitive arg), get_git_diff
(multi-primitive). Each arm has its own #[serde(rename_all = "camelCase")]
decoder struct, mirroring Tauri's invoke convention so PR-C's call sites
don't change. 4 tests: unknown method, primitive happy path, camelCase
rejection of snake_case, optional-untracked decoding.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 6b: The remaining 16 production arms

- [ ] **Step 1: Add the remaining arms**

Replace `mod router` in `src-tauri/src/runtime/ipc.rs` so its `match method` covers every method. Replace ONLY the `match method { ... }` body — the `pub async fn dispatch` signature stays. The full match:

```rust
        match method {
            "spawn_pty" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct P {
                    request: crate::terminal::types::SpawnPtyRequest,
                }
                let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                let res = state.spawn_pty(p.request).await?;
                serde_json::to_value(res).map_err(|e| format!("result encode: {e}"))
            }
            "write_pty" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct P {
                    request: crate::terminal::types::WritePtyRequest,
                }
                let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                state.write_pty(p.request)?;
                Ok(Value::Null)
            }
            "resize_pty" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct P {
                    request: crate::terminal::types::ResizePtyRequest,
                }
                let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                state.resize_pty(p.request)?;
                Ok(Value::Null)
            }
            "kill_pty" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct P {
                    request: crate::terminal::types::KillPtyRequest,
                }
                let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                state.kill_pty(p.request)?;
                Ok(Value::Null)
            }
            "list_sessions" => {
                let res = state.list_sessions()?;
                serde_json::to_value(res).map_err(|e| format!("result encode: {e}"))
            }
            "set_active_session" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct P {
                    request: crate::terminal::types::SetActiveSessionRequest,
                }
                let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                state.set_active_session(p.request)?;
                Ok(Value::Null)
            }
            "reorder_sessions" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct P {
                    request: crate::terminal::types::ReorderSessionsRequest,
                }
                let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                state.reorder_sessions(p.request)?;
                Ok(Value::Null)
            }
            "update_session_cwd" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct P {
                    request: crate::terminal::types::UpdateSessionCwdRequest,
                }
                let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                state.update_session_cwd(p.request)?;
                Ok(Value::Null)
            }
            "detect_agent_in_session" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct P {
                    session_id: String,
                }
                let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                let res = state.detect_agent_in_session(p.session_id).await?;
                serde_json::to_value(res).map_err(|e| format!("result encode: {e}"))
            }
            "start_agent_watcher" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct P {
                    session_id: String,
                }
                let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                state.start_agent_watcher(p.session_id).await?;
                Ok(Value::Null)
            }
            "stop_agent_watcher" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct P {
                    session_id: String,
                }
                let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                state.stop_agent_watcher(p.session_id).await?;
                Ok(Value::Null)
            }
            "list_dir" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct P {
                    request: crate::filesystem::types::ListDirRequest,
                }
                let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                let res = state.list_dir(p.request)?;
                serde_json::to_value(res).map_err(|e| format!("result encode: {e}"))
            }
            "read_file" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct P {
                    request: crate::filesystem::types::ReadFileRequest,
                }
                let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                let res = state.read_file(p.request)?;
                serde_json::to_value(res).map_err(|e| format!("result encode: {e}"))
            }
            "write_file" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct P {
                    request: crate::filesystem::types::WriteFileRequest,
                }
                let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                state.write_file(p.request)?;
                Ok(Value::Null)
            }
            "git_status" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct P {
                    cwd: String,
                }
                let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                let res = state.git_status(p.cwd).await?;
                serde_json::to_value(res).map_err(|e| format!("result encode: {e}"))
            }
            "git_branch" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct P {
                    cwd: String,
                }
                let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                let res = state.git_branch(p.cwd).await?;
                serde_json::to_value(res).map_err(|e| format!("result encode: {e}"))
            }
            "get_git_diff" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct P {
                    cwd: String,
                    file: String,
                    staged: bool,
                    #[serde(default)]
                    untracked: Option<bool>,
                }
                let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                let diff = state.get_git_diff(p.cwd, p.file, p.staged, p.untracked).await?;
                serde_json::to_value(diff).map_err(|e| format!("result encode: {e}"))
            }
            "start_git_watcher" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct P {
                    cwd: String,
                }
                let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                state.start_git_watcher(p.cwd).await?;
                Ok(Value::Null)
            }
            "stop_git_watcher" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct P {
                    cwd: String,
                }
                let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                state.stop_git_watcher(p.cwd).await?;
                Ok(Value::Null)
            }
            #[cfg(feature = "e2e-test")]
            "list_active_pty_sessions" => {
                serde_json::to_value(state.list_active_pty_sessions())
                    .map_err(|e| format!("result encode: {e}"))
            }
            _ => Err(format!("unknown method: {method}")),
        }
```

- [ ] **Step 2: Add a parity test for `list_sessions` (no-params shape)**

Inside `mod tests`, append:

```rust
    #[tokio::test]
    async fn dispatch_list_sessions_empty_params_object_decodes() {
        let (state, _sink) = crate::runtime::BackendState::with_fake_sink();
        let outcome = super::router::dispatch(state, "list_sessions", serde_json::json!({})).await;
        let v = outcome.expect("list_sessions should succeed on fresh state");
        // SessionList has the shape PR-A locks; we just assert it's an object.
        assert!(v.is_object(), "expected object, got {v:?}");
    }
```

- [ ] **Step 3: Confirm the dispatch compiles + module tests still pass**

```bash
cd /home/will/projects/vimeflow/src-tauri
cargo test --lib runtime::ipc::tests::
```

Expected: 22 tests pass (the 21 from earlier plus `dispatch_list_sessions_empty_params_object_decodes`).

- [ ] **Step 4: Verify the e2e-test feature compiles + runs the cfg-gated arm**

```bash
cd /home/will/projects/vimeflow/src-tauri
cargo test --lib --features e2e-test runtime::ipc::tests::
```

Expected: same 22 tests pass under the e2e-test feature (the cfg-gated arm exists in dispatch but no test asserts its presence here — that comes in the wire-shape integration test, Task 9).

- [ ] **Step 5: Commit**

```bash
cd /home/will/projects/vimeflow
git add src-tauri/src/runtime/ipc.rs
git commit -m "$(cat <<'EOF'
feat(backend/ipc): complete router dispatch — all 19 + cfg-gated 20th arms

Every method from PR-A §5.1: spawn_pty, write_pty, resize_pty, kill_pty,
list_sessions, set_active_session, reorder_sessions, update_session_cwd,
detect_agent_in_session, start_agent_watcher, stop_agent_watcher,
list_dir, read_file, write_file, git_status, git_branch, get_git_diff,
start_git_watcher, stop_git_watcher, and the cfg-gated
list_active_pty_sessions. Per-arm camelCase decoder structs (Decision #6).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: `run` + `spawn_handler` + `writer_task` + tests

**Files:**

- Modify: `src-tauri/src/runtime/ipc.rs`

- [ ] **Step 1: Add the public `run`, internal `spawn_handler`, and public `writer_task`**

Append to `src-tauri/src/runtime/ipc.rs` (after `mod router`):

```rust
use tokio::io::{AsyncRead, AsyncWrite, BufReader};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

/// Drain the writer channel into `writer` until all senders drop. Logs and
/// breaks on write failure. The bin's main spawns this once.
pub async fn writer_task<W: AsyncWrite + Unpin + Send + 'static>(
    mut rx: UnboundedReceiver<Vec<u8>>,
    mut writer: W,
) {
    use tokio::io::AsyncWriteExt;
    while let Some(framed) = rx.recv().await {
        if let Err(err) = writer.write_all(&framed).await {
            log::warn!("ipc writer_task: write failed: {err}");
            break;
        }
        if let Err(err) = writer.flush().await {
            log::warn!("ipc writer_task: flush failed: {err}");
            break;
        }
    }
}

/// Read frames from `reader`, dispatch each as a Tokio task, send responses
/// through `tx`. Returns Ok(()) on clean EOF, Err on fatal codec error.
///
/// On clean EOF we do NOT cancel in-flight handlers — they are tracked and
/// awaited so already-accepted requests get a response. The bin's main bounds
/// the writer drain after the handlers finish.
///
/// On fatal error we DO cancel: the process is about to exit non-zero, no
/// supervisor is listening for the responses anyway, and we want the spawned
/// handlers' tx clones to drop so the writer task can exit too.
pub async fn run<R: AsyncRead + Unpin + Send>(
    state: std::sync::Arc<crate::runtime::BackendState>,
    reader: R,
    tx: UnboundedSender<Vec<u8>>,
    cancel: CancellationToken,
) -> Result<(), std::io::Error> {
    let mut buf_reader = BufReader::new(reader);
    let mut handlers = JoinSet::new();

    loop {
        match frame::read_frame(&mut buf_reader).await {
            Ok(Some(body)) => {
                spawn_handler(
                    &mut handlers,
                    state.clone(),
                    tx.clone(),
                    cancel.clone(),
                    body,
                );
            }
            Ok(None) => {
                while handlers.join_next().await.is_some() {}
                return Ok(());
            }
            Err(frame::FrameError::ResyncableBadHeader(msg)) => {
                log::warn!("ipc bad frame header (resyncable): {msg}");
                continue;
            }
            Err(frame::FrameError::FatalBadHeader(msg)) => {
                log::error!("ipc fatal frame error: {msg}; exiting");
                cancel.cancel();
                return Err(std::io::Error::other(format!("fatal header: {msg}")));
            }
            Err(frame::FrameError::BodyTooLarge { len }) => {
                log::error!("ipc body too large: {len} bytes; exiting");
                cancel.cancel();
                return Err(std::io::Error::other("body too large"));
            }
            Err(frame::FrameError::Io(err)) => {
                cancel.cancel();
                return Err(err);
            }
        }
    }
}

fn spawn_handler(
    handlers: &mut JoinSet<()>,
    state: std::sync::Arc<crate::runtime::BackendState>,
    tx: UnboundedSender<Vec<u8>>,
    cancel: CancellationToken,
    body: Vec<u8>,
) {
    handlers.spawn(async move {
        let mut req: RequestFrame = match serde_json::from_slice::<InboundFrame>(&body) {
            Ok(InboundFrame::Request(req)) => req,
            Err(err) => {
                log::warn!("ipc bad envelope: {err}");
                return;
            }
        };

        // Normalize absent / null params to {} so empty-param decoders work.
        if matches!(req.params, Value::Null) {
            req.params = Value::Object(serde_json::Map::new());
        }

        let dispatch = router::dispatch(state, &req.method, req.params);
        let outcome = tokio::select! {
            biased;
            _ = cancel.cancelled() => return,
            res = dispatch => res,
        };

        let body = match &outcome {
            Ok(value) => match serde_json::to_vec(&ResponseFrame::ok(&req.id, value)) {
                Ok(b) => b,
                Err(err) => {
                    log::error!("ipc response encode failed (id={}): {err}", req.id);
                    return;
                }
            },
            Err(msg) => match serde_json::to_vec(&ResponseFrame::err(&req.id, msg.as_str())) {
                Ok(b) => b,
                Err(err) => {
                    log::error!("ipc error-response encode failed (id={}): {err}", req.id);
                    return;
                }
            },
        };
        let _ = tx.send(frame::format_frame(&body));
    });
}
```

- [ ] **Step 2: Add tests for the run loop**

Inside `mod tests`, append (note: `use tokio::io::AsyncWriteExt;` is already imported at the top of `mod tests` from Task 3 — do NOT re-import; `E0252` if you do):

```rust
    /// Helper: build a request frame body, prepend Content-Length, return bytes.
    fn make_request_frame(id: &str, method: &str, params: serde_json::Value) -> Vec<u8> {
        let body = serde_json::to_vec(&serde_json::json!({
            "kind": "request",
            "id": id,
            "method": method,
            "params": params,
        }))
        .expect("encode");
        super::frame::format_frame(&body)
    }

    /// Helper: read one response frame from the rx channel, decode the body.
    async fn recv_response(rx: &mut tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>) -> serde_json::Value {
        let framed = tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv())
            .await
            .expect("recv timeout")
            .expect("rx closed");
        let s = std::str::from_utf8(&framed).expect("utf8");
        let body_start = s.find("\r\n\r\n").expect("delimiter") + 4;
        serde_json::from_str(&s[body_start..]).expect("parse")
    }

    #[tokio::test]
    async fn run_dispatches_one_request_and_writes_response() {
        let (state, _sink) = crate::runtime::BackendState::with_fake_sink();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let cancel = tokio_util::sync::CancellationToken::new();

        let (read_end, mut write_end) = tokio::io::duplex(8192);
        let run_handle = tokio::spawn(super::run(state, read_end, tx, cancel.clone()));

        let frame = make_request_frame("1", "list_sessions", serde_json::json!({}));
        write_end.write_all(&frame).await.expect("write");
        drop(write_end); // Triggers EOF on the run loop.

        let resp = recv_response(&mut rx).await;
        assert_eq!(resp["kind"], "response");
        assert_eq!(resp["id"], "1");
        assert_eq!(resp["ok"], true);

        run_handle.await.expect("run task").expect("run ok");
    }

    #[tokio::test]
    async fn run_unknown_method_returns_id_bearing_error_response() {
        let (state, _sink) = crate::runtime::BackendState::with_fake_sink();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let cancel = tokio_util::sync::CancellationToken::new();
        let (read_end, mut write_end) = tokio::io::duplex(8192);
        let run_handle = tokio::spawn(super::run(state, read_end, tx, cancel));

        let frame = make_request_frame("42", "no_such_method", serde_json::json!({}));
        write_end.write_all(&frame).await.expect("write");
        drop(write_end);

        let resp = recv_response(&mut rx).await;
        assert_eq!(resp["id"], "42");
        assert_eq!(resp["ok"], false);
        assert!(
            resp["error"].as_str().unwrap().starts_with("unknown method:"),
            "got {}",
            resp["error"]
        );

        run_handle.await.expect("run task").expect("run ok");
    }

    #[tokio::test]
    async fn run_wrong_kind_envelope_logs_and_drops_no_response() {
        let (state, _sink) = crate::runtime::BackendState::with_fake_sink();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let cancel = tokio_util::sync::CancellationToken::new();
        let (read_end, mut write_end) = tokio::io::duplex(8192);
        let run_handle = tokio::spawn(super::run(state, read_end, tx, cancel));

        // Body parses as JSON but kind != "request".
        let body = br#"{"kind":"response","id":"x","ok":true}"#;
        let frame = super::frame::format_frame(body);
        write_end.write_all(&frame).await.expect("write");
        drop(write_end);

        // No response should arrive — give it 100ms then assert empty.
        let res = tokio::time::timeout(std::time::Duration::from_millis(100), rx.recv()).await;
        assert!(res.is_err(), "expected timeout, got {res:?}");

        run_handle.await.expect("run task").expect("run ok");
    }

    #[tokio::test]
    async fn run_null_params_normalized_for_empty_decoder() {
        // list_sessions takes no params; absent → Value::Null → must be normalized to {} so its
        // (implicit empty-object) decoding succeeds. We send "params": null explicitly.
        let (state, _sink) = crate::runtime::BackendState::with_fake_sink();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let cancel = tokio_util::sync::CancellationToken::new();
        let (read_end, mut write_end) = tokio::io::duplex(8192);
        let run_handle = tokio::spawn(super::run(state, read_end, tx, cancel));

        let body = br#"{"kind":"request","id":"n","method":"list_sessions","params":null}"#;
        let frame = super::frame::format_frame(body);
        write_end.write_all(&frame).await.expect("write");
        drop(write_end);

        let resp = recv_response(&mut rx).await;
        assert_eq!(resp["id"], "n");
        assert_eq!(resp["ok"], true);

        run_handle.await.expect("run task").expect("run ok");
    }

    #[tokio::test]
    async fn run_fatal_bad_header_returns_err() {
        let (state, _sink) = crate::runtime::BackendState::with_fake_sink();
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let cancel = tokio_util::sync::CancellationToken::new();
        let (read_end, mut write_end) = tokio::io::duplex(super::frame::RESYNC_BUDGET_BYTES as usize * 2);
        let run_handle = tokio::spawn(super::run(state, read_end, tx, cancel));

        // Send >64 KiB of garbage with no newline-terminated header.
        let big_line: Vec<u8> = (b'A'..=b'Z').cycle().take(super::frame::RESYNC_BUDGET_BYTES as usize + 1024).collect();
        write_end.write_all(&big_line).await.expect("write");
        drop(write_end);

        let outcome = run_handle.await.expect("run task");
        assert!(outcome.is_err(), "expected fatal err, got {outcome:?}");
    }
```

- [ ] **Step 3: Run the new run-loop tests**

```bash
cd /home/will/projects/vimeflow/src-tauri
cargo test --lib runtime::ipc::tests::run_
```

Expected: 5 tests pass. Full module suite:

```bash
cargo test --lib runtime::ipc::tests::
```

Expected: 28 total tests pass.

- [ ] **Step 4: Commit**

```bash
cd /home/will/projects/vimeflow
git add src-tauri/src/runtime/ipc.rs
git commit -m "$(cat <<'EOF'
feat(backend/ipc): add run / spawn_handler / writer_task

run reads frames from stdin via a BufReader, spawns one Tokio task per
parsed request, and threads outbound bytes through the tx channel.
EOF is the sole shutdown signal — on Ok(None) we wait for in-flight
handlers and return. FatalBadHeader / BodyTooLarge / IO errors bubble up
so the bin's main exits 1 (no shutdown(), no cache wipe — §2.6).

Value::Null params are normalized to {} so empty-arg decoders work
(spec §2.5 fix).

5 tests via tokio::io::duplex: list_sessions happy path, unknown method
id-bearing error, wrong-kind drop, null-params normalize, fatal bad
header propagates Err.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: `bin/vimeflow-backend.rs` — the entry point

**Files:**

- Create: `src-tauri/src/bin/vimeflow-backend.rs`

- [ ] **Step 1: Confirm the bin directory exists**

```bash
ls -ld /home/will/projects/vimeflow/src-tauri/src/bin 2>/dev/null || mkdir -p /home/will/projects/vimeflow/src-tauri/src/bin
```

Cargo conventions look for `src/bin/<name>.rs` or `src/bin/<name>/main.rs`; either works. We use the flat file.

- [ ] **Step 2: Create the bin file**

Create `src-tauri/src/bin/vimeflow-backend.rs`:

```rust
//! `vimeflow-backend` — the sidecar binary spawned by Electron (PR-D).
//!
//! Today this bin runs alongside the Tauri host as a development artifact;
//! production traffic still flows through Tauri. PR-D's Electron main will
//! spawn this bin and pipe stdio frames through it.

use std::sync::Arc;

use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use vimeflow_lib::runtime::{ipc, BackendState, EventSink};

#[tokio::main(flavor = "multi_thread")]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn"))
        .target(env_logger::Target::Stderr)
        .init();

    let app_data_dir = match parse_app_data_dir() {
        Ok(dir) => dir,
        Err(err) => {
            eprintln!("vimeflow-backend: {err}");
            std::process::exit(2);
        }
    };

    let (tx, rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let writer_handle = tokio::spawn(ipc::writer_task(rx, tokio::io::stdout()));

    let sink: Arc<dyn EventSink> = Arc::new(ipc::StdoutEventSink::new(tx.clone()));
    let state = Arc::new(BackendState::new(app_data_dir, sink));
    let cancel = CancellationToken::new();

    let run_result = ipc::run(state.clone(), tokio::io::stdin(), tx, cancel.clone()).await;

    // Clean EOF (Ok(())) is the ONLY path that wipes the session cache.
    // Errors leave it intact so a restart can reconcile via list_sessions.
    if run_result.is_ok() {
        state.shutdown();
    }
    drop(state);

    // Bounded writer drain — PTY threads holding tx clones can outlive
    // BackendState. 200 ms is generous for the in-flight responses; longer
    // would risk hanging on a stuck PTY thread. Process exit reaps the rest.
    let _ = tokio::time::timeout(
        std::time::Duration::from_millis(200),
        writer_handle,
    )
    .await;

    if let Err(err) = run_result {
        eprintln!("vimeflow-backend: run loop exited with error: {err}");
        std::process::exit(1);
    }
}

fn parse_app_data_dir() -> Result<std::path::PathBuf, String> {
    let mut args = std::env::args().skip(1);
    let mut app_data_dir: Option<std::path::PathBuf> = None;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--app-data-dir" => {
                let value = args.next().ok_or_else(|| "--app-data-dir requires a path".to_string())?;
                app_data_dir = Some(value.into());
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    app_data_dir.ok_or_else(|| "--app-data-dir <path> is required".into())
}
```

- [ ] **Step 3: Build the bin**

```bash
cd /home/will/projects/vimeflow/src-tauri
cargo build --bin vimeflow-backend
```

Expected: clean build. The resulting binary lives at `src-tauri/target/debug/vimeflow-backend`.

- [ ] **Step 4: Manual smoke — bin rejects missing `--app-data-dir`**

```bash
cd /home/will/projects/vimeflow
./src-tauri/target/debug/vimeflow-backend
echo "exit=$?"
```

Expected: stderr message `--app-data-dir <path> is required`, exit code `2`.

- [ ] **Step 5: Manual smoke — bin starts with a tempdir + accepts a list_sessions request**

```bash
cd /home/will/projects/vimeflow
TMP=$(mktemp -d)
printf 'Content-Length: %d\r\n\r\n%s' \
  $(echo -n '{"kind":"request","id":"1","method":"list_sessions","params":{}}' | wc -c) \
  '{"kind":"request","id":"1","method":"list_sessions","params":{}}' \
  | ./src-tauri/target/debug/vimeflow-backend --app-data-dir "$TMP"
echo "exit=$?"
rm -rf "$TMP"
```

Expected: stdout shows `Content-Length: <N>\r\n\r\n{"kind":"response","id":"1","ok":true,"result":{...}}`. Exit code `0` (the heredoc closes stdin → EOF → clean shutdown).

- [ ] **Step 6: Manual smoke — bin doesn't corrupt stdout on garbage input**

```bash
cd /home/will/projects/vimeflow
TMP=$(mktemp -d)
echo "garbage garbage garbage" | ./src-tauri/target/debug/vimeflow-backend --app-data-dir "$TMP" >/tmp/out.bin 2>/tmp/err.log
echo "exit=$?"
echo "stdout bytes:"; wc -c </tmp/out.bin
echo "stderr (first 5 lines):"; head -5 /tmp/err.log
rm -rf "$TMP" /tmp/out.bin /tmp/err.log
```

Expected: stdout is 0 bytes (no log lines leaked); stderr has at least one `ipc bad frame header (resyncable)` warning; exit code `1`. The codec resyncs past the garbage line but then hits EOF mid-resync (resync_consumed != 0 → `FrameError::Io(UnexpectedEof)`), which the run loop maps to a fatal Err and main exits 1. This is the correct contract — a peer that closes the pipe mid-noise looks like a protocol error, not a clean shutdown. The stdout-clean assertion is the load-bearing check; the exit code differentiates "garbage input + crash" from "garbage input + clean recovery".

- [ ] **Step 7: Commit**

```bash
cd /home/will/projects/vimeflow
git add src-tauri/src/bin/vimeflow-backend.rs
git commit -m "$(cat <<'EOF'
feat(backend/ipc): add vimeflow-backend bin entry

#[tokio::main(flavor = "multi_thread")] entry that parses --app-data-dir,
spawns ipc::writer_task, builds Arc<BackendState> with StdoutEventSink,
runs ipc::run. Shutdown ONLY on Ok(()); error paths leave the cache
intact (spec §2.6). 200 ms bounded writer drain so PTY threads holding
tx clones can't hang exit indefinitely.

Manual smokes (see plan Task 8 Steps 4-6): bad argv → exit 2; valid
list_sessions request → framed response on stdout, exit 0; garbage
stdin → empty stdout, resync warning on stderr, exit 0.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: `tests/ipc_subprocess.rs` — wire-shape integration tests

**Files:**

- Create: `src-tauri/tests/ipc_subprocess.rs`

These are Cargo integration tests (one external test binary, separate from `cargo test --lib`). They spawn the cargo-built bin via `env!("CARGO_BIN_EXE_vimeflow-backend")` and assert the **wire shape only** — `kind`/`id`/`ok`/`result-non-null`. The byte-level parity assertions live in `ipc.rs::tests::dispatch_*`.

- [ ] **Step 1: Create the integration test file with the `IpcClient` helper**

Create `src-tauri/tests/ipc_subprocess.rs`:

```rust
//! Integration tests that spawn `vimeflow-backend` as a subprocess and assert
//! the wire shape of responses. Per spec §3, byte-level parity is in
//! `runtime::ipc::tests` (where with_fake_sink + crate-private request types
//! are accessible). These tests only assert kind/id/ok/result-non-null.

use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::time::Duration;

use serde_json::{json, Value};
use tempfile::TempDir;

const BIN: &str = env!("CARGO_BIN_EXE_vimeflow-backend");

struct IpcClient {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: BufReader<ChildStdout>,
    next_id: u64,
    _app_data_dir: TempDir,
}

impl IpcClient {
    fn spawn() -> Self {
        let app_data_dir = tempfile::tempdir().expect("tempdir");
        let mut child = Command::new(BIN)
            .args(["--app-data-dir", app_data_dir.path().to_str().expect("path")])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn bin");
        let stdin = Some(child.stdin.take().expect("stdin"));
        let stdout = BufReader::new(child.stdout.take().expect("stdout"));
        Self {
            child,
            stdin,
            stdout,
            next_id: 0,
            _app_data_dir: app_data_dir,
        }
    }

    fn stdin_mut(&mut self) -> &mut ChildStdin {
        self.stdin.as_mut().expect("stdin already closed")
    }

    fn send_request(&mut self, method: &str, params: Value) -> Value {
        self.next_id += 1;
        let id = self.next_id.to_string();
        let body = serde_json::to_vec(&json!({
            "kind": "request",
            "id": id,
            "method": method,
            "params": params,
        }))
        .expect("encode");
        let header = format!("Content-Length: {}\r\n\r\n", body.len());
        let stdin = self.stdin_mut();
        stdin.write_all(header.as_bytes()).expect("write header");
        stdin.write_all(&body).expect("write body");
        stdin.flush().expect("flush");
        self.read_response_for(&id)
    }

    fn read_response_for(&mut self, want_id: &str) -> Value {
        // Skip any event frames; return the next response with matching id.
        loop {
            let body = self.read_one_frame_body();
            let v: Value = serde_json::from_slice(&body).expect("parse frame");
            if v["kind"] == "response" && v["id"] == want_id {
                return v;
            }
            // Otherwise it's an event or a stray response; loop.
        }
    }

    fn read_one_frame_body(&mut self) -> Vec<u8> {
        let mut content_length: Option<usize> = None;
        loop {
            let mut line = String::new();
            let n = self.stdout.read_line(&mut line).expect("read header line");
            assert!(n > 0, "unexpected EOF reading frame headers");
            let trimmed = line.trim_end_matches(['\r', '\n']);
            if trimmed.is_empty() {
                let len = content_length.expect("Content-Length must precede blank line");
                let mut body = vec![0u8; len];
                self.stdout.read_exact(&mut body).expect("read body");
                return body;
            }
            if let Some((name, value)) = trimmed.split_once(':') {
                if name.trim().eq_ignore_ascii_case("Content-Length") {
                    content_length = Some(value.trim().parse().expect("parse content-length"));
                }
            }
        }
    }

    fn close_stdin(&mut self) {
        // Take the stdin handle and drop it → OS pipe write-end closes →
        // sidecar sees EOF. Subsequent `stdin_mut()` calls panic; tests must
        // not write after this call.
        drop(self.stdin.take());
    }

    fn wait_exit(&mut self, timeout: Duration) -> std::io::Result<Option<std::process::ExitStatus>> {
        let deadline = std::time::Instant::now() + timeout;
        loop {
            if let Some(status) = self.child.try_wait()? {
                return Ok(Some(status));
            }
            if std::time::Instant::now() >= deadline {
                return Ok(None);
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

impl Drop for IpcClient {
    fn drop(&mut self) {
        // CRITICAL: close stdin BEFORE waiting, or the bin never sees EOF and
        // this drop deadlocks the test. After close_stdin, wait up to 2s for
        // a graceful exit; SIGKILL if it overshoots.
        self.close_stdin();
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        loop {
            match self.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) if std::time::Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(20));
                }
                _ => {
                    let _ = self.child.kill();
                    let _ = self.child.wait();
                    return;
                }
            }
        }
    }
}

#[test]
fn list_sessions_returns_response_with_id_round_trip() {
    let mut client = IpcClient::spawn();
    let resp = client.send_request("list_sessions", json!({}));
    assert_eq!(resp["kind"], "response");
    assert_eq!(resp["id"], "1");
    assert_eq!(resp["ok"], true, "expected ok=true, got {resp}");
    assert!(!resp["result"].is_null(), "list_sessions result must be non-null, got {resp}");
}

#[test]
fn unknown_method_returns_id_bearing_error_response() {
    let mut client = IpcClient::spawn();
    let resp = client.send_request("no_such_method", json!({}));
    assert_eq!(resp["kind"], "response");
    assert_eq!(resp["id"], "1");
    assert_eq!(resp["ok"], false);
    assert!(
        resp["error"].as_str().unwrap().starts_with("unknown method:"),
        "got {resp}"
    );
}

#[test]
fn bad_kind_envelope_drops_no_response() {
    let mut client = IpcClient::spawn();
    let body = br#"{"kind":"response","id":"x","ok":true}"#;
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    {
        let stdin = client.stdin_mut();
        stdin.write_all(header.as_bytes()).expect("write");
        stdin.write_all(body).expect("write");
        stdin.flush().expect("flush");
    }

    // Then send a real request — its response must arrive (the bad envelope
    // must NOT have desynced the protocol).
    let resp = client.send_request("list_sessions", json!({}));
    assert_eq!(resp["id"], "1");
    assert_eq!(resp["ok"], true);
}

#[test]
fn eof_triggers_clean_exit_zero() {
    let mut client = IpcClient::spawn();
    // Send AND fully read the response before closing stdin. If we close
    // stdin before reading, the EOF can race the spawned handler's tx.send
    // back to stdout — though run() now does NOT cancel on EOF, the writer
    // task still needs the handler's tx clone to actually push the frame
    // before we drop the receiver via the BufReader.
    let resp = client.send_request("list_sessions", json!({}));
    assert_eq!(resp["ok"], true);
    client.close_stdin();
    let status = client
        .wait_exit(Duration::from_secs(2))
        .expect("wait")
        .expect("exited");
    assert!(status.success(), "expected exit 0, got {status:?}");
}

#[test]
fn missing_app_data_dir_arg_exits_two() {
    let status = Command::new(BIN)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn")
        .wait()
        .expect("wait");
    assert_eq!(status.code(), Some(2), "expected exit 2, got {status:?}");
}

/// One wire-shape check per method (spec §3 "End-to-end per method"). We
/// pick params that exercise the decoder without depending on real PTY /
/// real git state: BackendState may return an Err (e.g. `git_status` on a
/// nonexistent cwd), but we only assert the wire SHAPE — `kind`/`id`/`ok`
/// presence, error key when ok=false. The byte-level "ok response equals
/// in-process return" parity lives in `runtime::ipc::tests::dispatch_*`.
#[test]
fn every_production_method_returns_well_formed_response_frame() {
    // The decoder shapes for the four pty-request methods need ts-rs-shaped
    // payloads; the public types are crate-private to vimeflow_lib so we
    // pass minimal valid JSON. BackendState may surface a logical Err
    // (e.g. "PTY session not found"), which is still a wire-shape PASS.
    let dummy_pty_request = json!({"sessionId": "no-such-session"});
    let cases: &[(&str, Value)] = &[
        ("list_sessions", json!({})),
        ("write_pty", json!({"request": {"sessionId": "no-such-session", "data": ""}})),
        ("resize_pty", json!({"request": {"sessionId": "no-such-session", "cols": 80, "rows": 24}})),
        ("kill_pty", json!({"request": {"sessionId": "no-such-session"}})),
        ("set_active_session", json!({"request": dummy_pty_request.clone()})),
        ("reorder_sessions", json!({"request": {"sessionIds": []}})),
        ("update_session_cwd", json!({"request": {"sessionId": "no-such-session", "cwd": "/tmp"}})),
        ("detect_agent_in_session", json!({"sessionId": "no-such-session"})),
        ("start_agent_watcher", json!({"sessionId": "no-such-session"})),
        ("stop_agent_watcher", json!({"sessionId": "no-such-session"})),
        ("list_dir", json!({"request": {"path": "/tmp"}})),
        ("read_file", json!({"request": {"path": "/tmp/no-such-file-vimeflow-test"}})),
        ("write_file", json!({"request": {"path": "/dev/null/no", "contents": ""}})),
        ("git_status", json!({"cwd": "/tmp/no-such-dir"})),
        ("git_branch", json!({"cwd": "/tmp/no-such-dir"})),
        ("get_git_diff", json!({"cwd": "/tmp/no-such-dir", "file": "x", "staged": false})),
        ("start_git_watcher", json!({"cwd": "/tmp/no-such-dir"})),
        ("stop_git_watcher", json!({"cwd": "/tmp/no-such-dir"})),
        // spawn_pty is intentionally LAST because if it succeeds it forks a
        // real PTY; we use a clearly-invalid command so it errors fast.
        ("spawn_pty", json!({"request": {"command": "/nonexistent/no/such/command", "cwd": "/tmp"}})),
    ];

    let mut client = IpcClient::spawn();
    for (method, params) in cases {
        let resp = client.send_request(method, params.clone());
        assert_eq!(resp["kind"], "response", "method={method} resp={resp}");
        assert!(
            resp["id"].is_string(),
            "method={method} id missing: {resp}"
        );
        assert!(
            resp["ok"].is_boolean(),
            "method={method} ok missing: {resp}"
        );
        if resp["ok"] == false {
            assert!(
                resp["error"].is_string(),
                "method={method} ok=false but no error string: {resp}"
            );
        }
    }
}

/// The cfg-gated 20th method is only reachable with the e2e-test feature.
/// Gate the test the same way so default `cargo test --test ipc_subprocess`
/// doesn't try to call an unknown method.
#[cfg(feature = "e2e-test")]
#[test]
fn list_active_pty_sessions_responds_under_e2e_feature() {
    let mut client = IpcClient::spawn();
    let resp = client.send_request("list_active_pty_sessions", json!({}));
    assert_eq!(resp["kind"], "response");
    assert_eq!(resp["ok"], true, "expected ok, got {resp}");
    assert!(resp["result"].is_array(), "expected array, got {}", resp["result"]);
}
```

(The `close_stdin` and `wait_exit` helpers are sufficient for these tests. The `eof_triggers_clean_exit_zero` test uses `drop(client.stdin)` directly because the `ChildStdin` is owned by the struct — dropping it closes the OS handle.)

- [ ] **Step 2: Run the integration tests**

```bash
cd /home/will/projects/vimeflow/src-tauri
cargo test --test ipc_subprocess
```

Expected: all tests pass. Cargo automatically rebuilds the bin if needed; the first run may take ~30s, subsequent runs are <5s.

- [ ] **Step 3: Run again under the e2e-test feature**

```bash
cd /home/will/projects/vimeflow/src-tauri
cargo test --test ipc_subprocess --features e2e-test
```

Expected: same 5 tests pass. (The e2e-test feature only changes the dispatch arm count; no integration test currently asserts the 20th method, so this is a pure compile-and-run check.)

- [ ] **Step 4: Commit**

```bash
cd /home/will/projects/vimeflow
git add src-tauri/tests/ipc_subprocess.rs
git commit -m "$(cat <<'EOF'
test(backend/ipc): add subprocess wire-shape integration tests

IpcClient helper spawns target/debug/vimeflow-backend via
env!("CARGO_BIN_EXE_vimeflow-backend") with --app-data-dir tempfile,
pipes one frame at a time, reads framed responses. Tests assert
wire shape only (kind/id/ok/result-non-null) per spec §3 — byte-level
parity stays in ipc.rs::tests.

5 tests: list_sessions response shape, unknown-method error response,
bad-kind envelope is dropped without desyncing the protocol, stdin EOF
→ exit 0, missing --app-data-dir → exit 2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Final verification gate

**Files:** none.

- [ ] **Step 1: Format + lint Rust**

```bash
cd /home/will/projects/vimeflow/src-tauri
cargo fmt --check
cargo clippy -- -D warnings
```

Expected: clean. If `cargo fmt --check` fails, run `cargo fmt` and commit `style(backend): cargo fmt` separately. Clippy warnings are blocking — fix them in place.

- [ ] **Step 2: Full Rust test suite (default features)**

```bash
cd /home/will/projects/vimeflow/src-tauri
cargo test
```

Expected: all green. Compared to Task 0 baseline, the test count climbed by ~28 unit tests (in `runtime::ipc::tests`) + ~5 integration tests (in `tests/ipc_subprocess.rs`).

- [ ] **Step 3: Full Rust test suite (e2e-test feature)**

```bash
cd /home/will/projects/vimeflow/src-tauri
cargo test --features e2e-test
```

Expected: same count, all green.

- [ ] **Step 4: TS test + type-check + lint suites (no churn expected)**

```bash
cd /home/will/projects/vimeflow
npm run test
npm run type-check
npm run lint
npm run format:check
```

Expected: all green, identical to Task 0. PR-B doesn't touch any TS file.

- [ ] **Step 5: Verify ts-rs bindings are unchanged**

```bash
cd /home/will/projects/vimeflow/src-tauri
cargo test export_bindings
cd /home/will/projects/vimeflow
git status --short src/bindings/
```

Expected: zero changes under `src/bindings/`. PR-B doesn't add or modify a single `#[derive(TS)]` type.

- [ ] **Step 6: Manual smoke — Tauri host still works**

```bash
cd /home/will/projects/vimeflow
npm run tauri:dev
```

In the app, verify:

1. App window opens.
2. Default terminal session spawns and reaches a prompt.
3. Typing into the terminal echoes characters.
4. File Explorer lists, click a file, editor loads.
5. Diff panel shows current branch + status.
6. Cmd/Ctrl+Q closes cleanly; no ghost-Exited sessions on relaunch.

If anything regresses, bisect by reverting the most recent task's commits.

- [ ] **Step 7: Manual smoke — sidecar bin end-to-end**

```bash
cd /home/will/projects/vimeflow
TMP=$(mktemp -d)
{
  BODY='{"kind":"request","id":"1","method":"list_sessions","params":{}}'
  printf 'Content-Length: %d\r\n\r\n%s' $(echo -n "$BODY" | wc -c) "$BODY"
  BODY='{"kind":"request","id":"2","method":"git_branch","params":{"cwd":"'"$(pwd)"'"}}'
  printf 'Content-Length: %d\r\n\r\n%s' $(echo -n "$BODY" | wc -c) "$BODY"
} | ./src-tauri/target/debug/vimeflow-backend --app-data-dir "$TMP" >/tmp/sidecar-stdout.bin 2>/tmp/sidecar-stderr.log
echo "exit=$?"
echo "stdout (parsed):"
python3 -c '
import sys
data = open("/tmp/sidecar-stdout.bin","rb").read()
while data:
    hdr_end = data.find(b"\r\n\r\n")
    if hdr_end < 0: break
    header = data[:hdr_end].decode()
    length = int([l.split(":",1)[1].strip() for l in header.split("\r\n") if l.lower().startswith("content-length:")][0])
    body = data[hdr_end+4:hdr_end+4+length]
    print(body.decode())
    data = data[hdr_end+4+length:]
'
rm -rf "$TMP" /tmp/sidecar-stdout.bin /tmp/sidecar-stderr.log
```

Expected: two JSON response frames on stdout, both with `"kind":"response"` and `"ok":true`. Exit `0`.

- [ ] **Step 8: Spec-claims sanity check**

```bash
cd /home/will/projects/vimeflow
grep -nE "@tauri-apps/api|__TAURI_INTERNALS__" src tests 2>/dev/null | head -5
```

Expected: many hits — PR-B does NOT remove Tauri frontend coupling (that's PR-C). The check here is a baseline confirmation for PR-C's later removal step.

```bash
grep -nE "^#\[tauri::command\]" src-tauri/src/ -r | wc -l
```

Expected: ~19 (the existing wrapper count). PR-B does not delete wrappers (PR-D's job).

---

## Final Verification Checklist

After Task 10 completes:

- [ ] `cargo test` test count climbed by ~33 (28 unit + 5 integration) vs Task 0 baseline.
- [ ] `cargo test --features e2e-test` count climbed by the same.
- [ ] Tauri host still opens and exercises every existing flow (`npm run tauri:dev` smoke).
- [ ] Sidecar bin spawns, accepts framed requests, emits framed responses, exits 0 on stdin EOF and 2 on missing argv.
- [ ] `src/bindings/` shows zero diff (no ts-rs change in PR-B).
- [ ] No `println!` in any new file (`grep -rn 'println!' src-tauri/src/runtime/ipc.rs src-tauri/src/bin/vimeflow-backend.rs` returns empty).
- [ ] No `tauri::*` references in any new file (`grep -rn 'tauri::' src-tauri/src/runtime/ipc.rs src-tauri/src/bin/vimeflow-backend.rs` returns empty).

When everything above is green, open the PR:

```bash
git push -u origin <pr-b-branch>
gh pr create \
  --base dev \
  --title "feat(backend): PR-B — Rust sidecar binary + IPC protocol (Tauri host stays)" \
  --body "$(cat <<'EOF'
## Summary

PR-B of the 4-PR Tauri → Electron migration. Adds the `vimeflow-backend`
sidecar binary and the LSP-style JSON-RPC IPC layer it speaks. Tauri
remains the production runtime through end of PR-B; the bin is a
parallel artifact you can drive via integration tests or a shell.

## Spec + migration roadmap

- Spec: `docs/superpowers/specs/2026-05-13-pr-b-rust-sidecar-ipc-design.md`
- Plan: `docs/superpowers/plans/2026-05-13-pr-b-rust-sidecar-ipc.md`
- Roadmap (4-PR index): `docs/superpowers/plans/2026-05-13-electron-rust-backend-migration.md`

## Test plan

- [x] `cargo test` — full Rust suite green (+28 unit + 5 integration tests)
- [x] `cargo test --features e2e-test` — green
- [x] `npm run test` — green (no TS changes)
- [x] `npm run type-check` + `npm run lint` + `npm run format:check` — clean
- [x] `src/bindings/` zero-diff — ts-rs unchanged
- [x] `cargo fmt --check` + `cargo clippy -- -D warnings` — clean
- [x] Manual smoke: `npm run tauri:dev` — Tauri host works identically
- [x] Manual smoke: sidecar bin accepts list_sessions/git_branch, exits 0 on EOF, exits 2 on bad argv

## Cross-PR contract

§5 of the spec locks three contracts the downstream PRs consume:

- §5.1 — IPC wire envelope (PR-C's `src/lib/backend.ts` binds to this)
- §5.2 — Bin invocation contract (PR-D's Electron main spawns via these args/exit codes)
- §5.3 — Integration-test helper API (`IpcClient` available for PR-D reuse if needed)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

(Adjust `--base dev` if the integration branch uses a different name.)

After PR-B merges to `dev`:

- The PR-C planner session can start. PR-C consumes §5.1 of this spec.
- Local dev continues against Tauri (`npm run tauri:dev`) — PR-B didn't change the desktop shell.
- `cargo test` count climbed by ~33; `cargo test --features e2e-test` count climbed by the same.

<!-- codex-reviewed: 2026-05-14T02:45:50Z -->

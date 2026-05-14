//! LSP-style JSON-RPC IPC layer for the `vimeflow-backend` sidecar.
//!
//! PR-B (spec: docs/superpowers/specs/2026-05-13-pr-b-rust-sidecar-ipc-design.md).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncWrite, BufReader};
use tokio::sync::mpsc::{Receiver, Sender};
use tokio::task::{JoinError, JoinSet};
use tokio_util::sync::CancellationToken;

use crate::runtime::event_sink::EventSink;

const HANDLER_DRAIN_TIMEOUT: Duration = Duration::from_secs(5);
const WRITER_DRAIN_WRITE_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_CONCURRENT_HANDLERS: usize = 64;

pub const STDOUT_QUEUE_CAPACITY: usize = 1024;

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

/// Event sink that formats LSP frames synchronously and pushes them onto a
/// bounded channel. A single writer task owns stdout and drains the channel.
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
        let body = serde_json::to_vec(&serde_json::json!({
            "kind": "event",
            "event": event,
            "payload": payload,
        }))
        .map_err(|err| format!("event encode {event}: {err}"))?;

        send_event_frame(&self.tx, frame::format_frame(&body), event)
    }
}

fn send_event_frame(tx: &Sender<Vec<u8>>, framed: Vec<u8>, event: &str) -> Result<(), String> {
    match tx.try_send(framed) {
        Ok(()) => Ok(()),
        Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => {
            Err(format!("stdout writer closed; cannot emit {event}"))
        }
        Err(tokio::sync::mpsc::error::TrySendError::Full(framed)) => {
            log::warn!("stdout writer backlog full; backpressuring event producer for {event}");
            blocking_send_event_frame(tx.clone(), framed, event)
        }
    }
}

fn blocking_send_event_frame(
    tx: Sender<Vec<u8>>,
    framed: Vec<u8>,
    event: &str,
) -> Result<(), String> {
    let send_result = match tokio::runtime::Handle::try_current() {
        Ok(handle)
            if matches!(
                handle.runtime_flavor(),
                tokio::runtime::RuntimeFlavor::MultiThread
            ) =>
        {
            // Synchronous emitters can run inside async tasks. Hand the blocking
            // wait back to Tokio so a saturated stdout queue does not pin a worker.
            tokio::task::block_in_place(|| tx.blocking_send(framed))
        }
        Ok(_) => {
            return Err(format!(
                "stdout writer backlog full in current-thread runtime; cannot emit {event}"
            ));
        }
        Err(_) => tx.blocking_send(framed),
    };

    send_result.map_err(|_| format!("stdout writer closed; cannot emit {event}"))
}

mod frame {
    use std::io;

    use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt};

    /// Maximum body bytes per frame. Protects against a malicious or buggy peer
    /// triggering unbounded allocation.
    pub const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;

    /// Hard cap on a single header line.
    pub const MAX_HEADER_LINE_BYTES: u64 = 8 * 1024;

    /// Hard cap on the complete header section, including extension headers
    /// after Content-Length. The resync budget below is narrower: it only
    /// limits malformed or pre-Content-Length bytes.
    pub const MAX_HEADER_SECTION_BYTES: u64 = 1024 * 1024;

    /// Soft cap on bytes consumed while resyncing past malformed header noise.
    pub const RESYNC_BUDGET_BYTES: u64 = 64 * 1024;

    #[derive(Debug)]
    pub enum FrameError {
        /// Header parsing exhausted RESYNC_BUDGET_BYTES or hit a hard limit.
        FatalBadHeader(String),
        /// Body length exceeds MAX_FRAME_BYTES.
        BodyTooLarge { len: usize },
        /// Underlying IO failure, including unexpected mid-frame EOF.
        Io(io::Error),
    }

    impl From<io::Error> for FrameError {
        fn from(err: io::Error) -> Self {
            Self::Io(err)
        }
    }

    pub fn format_frame(body: &[u8]) -> Vec<u8> {
        let header = format!("Content-Length: {}\r\n\r\n", body.len());
        let mut out = Vec::with_capacity(header.len() + body.len());
        out.extend_from_slice(header.as_bytes());
        out.extend_from_slice(body);
        out
    }

    pub async fn read_frame<R: AsyncBufRead + Unpin>(
        reader: &mut R,
    ) -> Result<Option<Vec<u8>>, FrameError> {
        let mut header_consumed: u64 = 0;
        let mut resync_consumed: u64 = 0;
        let mut content_length: Option<usize> = None;

        loop {
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

            if n == 0 {
                if header_consumed == 0 && content_length.is_none() {
                    return Ok(None);
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

            let line_str = std::str::from_utf8(&line)
                .map_err(|err| FrameError::FatalBadHeader(format!("header utf8: {err}")))?;
            let trimmed = line_str.trim_end_matches(['\r', '\n']);

            if trimmed.is_empty() {
                if let Some(len) = content_length {
                    if len > MAX_FRAME_BYTES {
                        return Err(FrameError::BodyTooLarge { len });
                    }

                    let mut body = vec![0u8; len];
                    reader.read_exact(&mut body).await.map_err(FrameError::Io)?;
                    return Ok(Some(body));
                }

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

            resync_consumed = resync_consumed.saturating_add(n as u64);
            if resync_consumed > RESYNC_BUDGET_BYTES {
                return Err(FrameError::FatalBadHeader(format!(
                    "no Content-Length within {RESYNC_BUDGET_BYTES} bytes of garbage"
                )));
            }
        }
    }
}

mod router {
    use std::sync::Arc;

    use serde::Deserialize;
    use serde_json::Value;

    use crate::runtime::BackendState;

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
                let diff = state
                    .get_git_diff(p.cwd, p.file, p.staged, p.untracked)
                    .await?;
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
            "list_active_pty_sessions" => serde_json::to_value(state.list_active_pty_sessions())
                .map_err(|e| format!("result encode: {e}")),
            #[cfg(test)]
            "__test_sleep_then_null" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct P {
                    delay_ms: u64,
                }

                let p: P = serde_json::from_value(params).map_err(|e| format!("params: {e}"))?;
                tokio::time::sleep(std::time::Duration::from_millis(p.delay_ms)).await;
                Ok(Value::Null)
            }
            _ => Err(format!("unknown method: {method}")),
        }
    }
}

/// Drain the writer channel into `writer` until all senders drop.
pub async fn writer_task<W: AsyncWrite + Unpin + Send + 'static>(
    rx: Receiver<Vec<u8>>,
    writer: W,
) -> std::io::Result<()> {
    writer_task_with_shutdown(
        rx,
        writer,
        CancellationToken::new(),
        CancellationToken::new(),
    )
    .await
}

/// Drain the writer channel until all senders drop, or until `shutdown` asks
/// the receiver to close. Shutdown drains already-queued frames before exit.
pub async fn writer_task_with_shutdown<W: AsyncWrite + Unpin + Send + 'static>(
    rx: Receiver<Vec<u8>>,
    writer: W,
    shutdown: CancellationToken,
    cancel: CancellationToken,
) -> std::io::Result<()> {
    writer_task_with_shutdown_timeout(rx, writer, shutdown, cancel, WRITER_DRAIN_WRITE_TIMEOUT)
        .await
}

async fn writer_task_with_shutdown_timeout<W: AsyncWrite + Unpin + Send + 'static>(
    mut rx: Receiver<Vec<u8>>,
    mut writer: W,
    shutdown: CancellationToken,
    cancel: CancellationToken,
    drain_write_timeout: Duration,
) -> std::io::Result<()> {
    loop {
        let framed = tokio::select! {
            biased;
            _ = shutdown.cancelled() => {
                rx.close();
                break;
            }
            framed = rx.recv() => framed,
        };

        let Some(framed) = framed else {
            return Ok(());
        };

        if let Err(err) = write_framed(&mut writer, &framed).await {
            cancel.cancel();
            return Err(err);
        }
    }

    while let Some(framed) = rx.recv().await {
        let write_result = tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::BrokenPipe,
                    "ipc writer cancelled during shutdown drain",
                ));
            }
            result = tokio::time::timeout(drain_write_timeout, write_framed(&mut writer, &framed)) => match result {
                Ok(write_result) => write_result,
                Err(_) => {
                    cancel.cancel();
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "ipc writer shutdown drain timed out",
                    ));
                }
            },
        };

        if let Err(err) = write_result {
            cancel.cancel();
            return Err(err);
        }
    }

    Ok(())
}

async fn write_framed<W: AsyncWrite + Unpin>(writer: &mut W, framed: &[u8]) -> std::io::Result<()> {
    use tokio::io::AsyncWriteExt;

    if let Err(err) = writer.write_all(framed).await {
        log::warn!("ipc writer_task: write failed: {err}");
        return Err(err);
    }
    if let Err(err) = writer.flush().await {
        log::warn!("ipc writer_task: flush failed: {err}");
        return Err(err);
    }

    Ok(())
}

/// Read frames from `reader`, dispatch each as a Tokio task, and send responses
/// through `tx`. Clean EOF returns `Ok(())`; fatal codec errors return `Err`.
pub async fn run<R: AsyncRead + Unpin + Send>(
    state: std::sync::Arc<crate::runtime::BackendState>,
    reader: R,
    tx: Sender<Vec<u8>>,
    cancel: CancellationToken,
) -> Result<(), std::io::Error> {
    run_with_handler_drain_timeout(state, reader, tx, cancel, HANDLER_DRAIN_TIMEOUT).await
}

async fn run_with_handler_drain_timeout<R: AsyncRead + Unpin + Send>(
    state: std::sync::Arc<crate::runtime::BackendState>,
    reader: R,
    tx: Sender<Vec<u8>>,
    cancel: CancellationToken,
    handler_drain_timeout: Duration,
) -> Result<(), std::io::Error> {
    let mut buf_reader = BufReader::new(reader);
    let mut handlers = JoinSet::new();

    loop {
        let frame = tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::BrokenPipe,
                    "ipc cancelled",
                ));
            }
            frame = frame::read_frame(&mut buf_reader) => frame,
        };

        match frame {
            Ok(Some(body)) => {
                drain_finished_handlers(&mut handlers);
                if handlers.len() >= MAX_CONCURRENT_HANDLERS {
                    send_overload_response(&tx, &cancel, &body).await;
                    continue;
                }

                spawn_handler(
                    &mut handlers,
                    state.clone(),
                    tx.clone(),
                    cancel.clone(),
                    body,
                );
            }
            Ok(None) => {
                wait_for_handlers(&mut handlers, handler_drain_timeout, &cancel).await;
                return Ok(());
            }
            Err(frame::FrameError::FatalBadHeader(msg)) => {
                log::error!("ipc fatal frame error: {msg}; exiting");
                cancel.cancel();
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("fatal header: {msg}"),
                ));
            }
            Err(frame::FrameError::BodyTooLarge { len }) => {
                log::error!("ipc body too large: {len} bytes; exiting");
                cancel.cancel();
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "body too large",
                ));
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
    tx: Sender<Vec<u8>>,
    cancel: CancellationToken,
    body: Vec<u8>,
) {
    handlers.spawn(async move {
        let envelope: Value = match serde_json::from_slice(&body) {
            Ok(value) => value,
            Err(err) => {
                log::warn!("ipc bad envelope: {err}");
                return;
            }
        };
        let recoverable_request_id = recover_bad_request_id(&envelope);
        let mut req: RequestFrame = match serde_json::from_value::<InboundFrame>(envelope) {
            Ok(InboundFrame::Request(req)) => req,
            Err(err) => {
                log::warn!("ipc bad envelope: {err}");
                if let Some(id) = recoverable_request_id {
                    let body = match serde_json::to_vec(&ResponseFrame::err(&id, "bad envelope")) {
                        Ok(body) => body,
                        Err(err) => {
                            log::error!("ipc bad-envelope response encode failed (id={id}): {err}");
                            return;
                        }
                    };

                    send_response_frame(&tx, &id, body, &cancel).await;
                }
                return;
            }
        };

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
                Ok(body) => body,
                Err(err) => {
                    log::error!("ipc response encode failed (id={}): {err}", req.id);
                    return;
                }
            },
            Err(msg) => match serde_json::to_vec(&ResponseFrame::err(&req.id, msg.as_str())) {
                Ok(body) => body,
                Err(err) => {
                    log::error!("ipc error-response encode failed (id={}): {err}", req.id);
                    return;
                }
            },
        };

        send_response_frame(&tx, &req.id, body, &cancel).await;
    });
}

async fn send_overload_response(tx: &Sender<Vec<u8>>, cancel: &CancellationToken, body: &[u8]) {
    let Some(id) = recover_bad_request_id_from_body(body) else {
        log::warn!("ipc overloaded; dropping request without recoverable id");
        return;
    };

    let response = match serde_json::to_vec(&ResponseFrame::err(&id, "server overloaded")) {
        Ok(response) => response,
        Err(err) => {
            log::error!("ipc overload response encode failed (id={id}): {err}");
            return;
        }
    };

    send_response_frame(tx, &id, response, cancel).await;
}

fn recover_bad_request_id_from_body(body: &[u8]) -> Option<String> {
    let value = match serde_json::from_slice(body) {
        Ok(value) => value,
        Err(err) => {
            log::warn!("ipc overloaded; bad envelope: {err}");
            return None;
        }
    };

    recover_bad_request_id(&value)
}

fn recover_bad_request_id(value: &Value) -> Option<String> {
    if value.get("kind").and_then(Value::as_str) != Some("request") {
        return None;
    }

    value.get("id").and_then(Value::as_str).map(str::to_owned)
}

async fn send_response_frame(
    tx: &Sender<Vec<u8>>,
    id: &str,
    body: Vec<u8>,
    cancel: &CancellationToken,
) {
    let framed = frame::format_frame(&body);
    let result = tokio::select! {
        biased;
        _ = cancel.cancelled() => return,
        result = tx.send(framed) => result,
    };

    if let Err(err) = result {
        log::warn!("ipc response send failed (id={id}): {err}");
    }
}

fn drain_finished_handlers(handlers: &mut JoinSet<()>) {
    while let Some(result) = handlers.try_join_next() {
        log_handler_result(result);
    }
}

async fn wait_for_handlers(
    handlers: &mut JoinSet<()>,
    drain_timeout: Duration,
    cancel: &CancellationToken,
) {
    let result = tokio::time::timeout(drain_timeout, drain_handlers(handlers)).await;
    if result.is_ok() {
        return;
    }

    let remaining = handlers.len();
    log::warn!(
        "ipc clean EOF: timed out waiting for {remaining} request handlers; aborting remaining handlers"
    );
    cancel.cancel();
    handlers.abort_all();
    drain_handlers(handlers).await;
}

async fn drain_handlers(handlers: &mut JoinSet<()>) {
    while let Some(result) = handlers.join_next().await {
        log_handler_result(result);
    }
}

fn log_handler_result(result: Result<(), JoinError>) {
    if let Err(err) = result {
        if err.is_cancelled() {
            log::debug!("ipc request handler cancelled");
        } else {
            log::warn!("ipc request handler failed: {err}");
        }
    }
}

#[cfg(test)]
mod tests {
    use std::pin::Pin;
    use std::task::{Context, Poll};

    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    use super::frame;

    struct FailingWriter;

    impl tokio::io::AsyncWrite for FailingWriter {
        fn poll_write(
            self: Pin<&mut Self>,
            _cx: &mut Context<'_>,
            _buf: &[u8],
        ) -> Poll<std::io::Result<usize>> {
            Poll::Ready(Err(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "test writer failed",
            )))
        }

        fn poll_flush(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
            Poll::Ready(Ok(()))
        }

        fn poll_shutdown(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
            Poll::Ready(Ok(()))
        }
    }

    struct PendingWriter;

    impl tokio::io::AsyncWrite for PendingWriter {
        fn poll_write(
            self: Pin<&mut Self>,
            _cx: &mut Context<'_>,
            _buf: &[u8],
        ) -> Poll<std::io::Result<usize>> {
            Poll::Pending
        }

        fn poll_flush(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
            Poll::Ready(Ok(()))
        }

        fn poll_shutdown(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
            Poll::Ready(Ok(()))
        }
    }

    fn make_reader(bytes: &[u8]) -> tokio::io::BufReader<&[u8]> {
        tokio::io::BufReader::new(bytes)
    }

    fn make_request_frame(id: &str, method: &str, params: serde_json::Value) -> Vec<u8> {
        let body = serde_json::to_vec(&serde_json::json!({
            "kind": "request",
            "id": id,
            "method": method,
            "params": params,
        }))
        .expect("encode request");
        super::frame::format_frame(&body)
    }

    async fn recv_response(rx: &mut tokio::sync::mpsc::Receiver<Vec<u8>>) -> serde_json::Value {
        let framed = tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv())
            .await
            .expect("recv timeout")
            .expect("rx closed");
        let s = std::str::from_utf8(&framed).expect("utf8");
        let body_start = s.find("\r\n\r\n").expect("delimiter") + 4;
        serde_json::from_str(&s[body_start..]).expect("parse response")
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
            frame::FrameError::BodyTooLarge { len: got } => assert_eq!(got, len),
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
    async fn read_frame_counts_unknown_headers_against_resync_budget() {
        let mut input = Vec::new();
        for _ in 0..5000 {
            input.extend_from_slice(b"X-Noise: value\r\n");
        }
        let mut reader = make_reader(&input);
        let err = frame::read_frame(&mut reader).await.expect_err("err");
        match err {
            frame::FrameError::FatalBadHeader(msg) => {
                assert!(msg.contains("Content-Length"), "got {msg}");
            }
            other => panic!("expected FatalBadHeader, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn read_frame_does_not_count_extension_headers_after_content_length_against_resync_budget(
    ) {
        let body = b"{}";
        let mut input = Vec::new();
        input.extend_from_slice(format!("Content-Length: {}\r\n", body.len()).as_bytes());
        for _ in 0..5000 {
            input.extend_from_slice(b"X-Noise: value\r\n");
        }
        input.extend_from_slice(b"\r\n");
        input.extend_from_slice(body);

        let mut reader = make_reader(&input);
        let got = frame::read_frame(&mut reader).await.expect("ok");
        assert_eq!(got.as_deref(), Some(body.as_slice()));
    }

    #[tokio::test]
    async fn read_frame_rejects_unbounded_extension_headers_after_content_length() {
        let mut input = Vec::new();
        input.extend_from_slice(b"Content-Length: 2\r\n");
        for _ in 0..(frame::MAX_HEADER_SECTION_BYTES / 16 + 1) {
            input.extend_from_slice(b"X-Noise: value\r\n");
        }
        input.extend_from_slice(b"\r\n{}");

        let mut reader = make_reader(&input);
        match frame::read_frame(&mut reader).await {
            Err(frame::FrameError::FatalBadHeader(msg)) => {
                assert!(
                    msg.contains("header section exceeded"),
                    "unexpected error: {msg}"
                );
            }
            other => panic!("expected fatal header error, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn read_frame_resyncs_past_garbage_lines_within_budget() {
        let body = b"{}";
        let mut input = Vec::new();
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
    async fn format_frame_round_trips_through_read_frame() {
        let body = br#"{"a":1,"b":"two"}"#;
        let framed = frame::format_frame(body);
        let mut reader = make_reader(&framed);
        let got = frame::read_frame(&mut reader).await.expect("ok");
        assert_eq!(got.as_deref(), Some(body.as_slice()));
    }

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

    #[tokio::test]
    async fn stdout_event_sink_pushes_framed_event_to_channel() {
        use crate::runtime::EventSink;

        let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(16);
        let sink = super::StdoutEventSink::new(tx);
        sink.emit_json(
            "pty-data",
            serde_json::json!({"sessionId": "s1", "data": "hi"}),
        )
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

        let (tx, rx) = tokio::sync::mpsc::channel::<Vec<u8>>(16);
        drop(rx);
        let sink = super::StdoutEventSink::new(tx);
        let err = sink
            .emit_json("pty-data", serde_json::json!({}))
            .expect_err("expected err");
        assert!(err.contains("stdout writer closed"), "got {err}");
    }

    #[tokio::test]
    async fn stdout_event_sink_backpressures_when_channel_full() {
        use crate::runtime::EventSink;

        let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(1);
        tx.try_send(Vec::new()).expect("fill channel");
        let sink = super::StdoutEventSink::new(tx);
        let (done_tx, done_rx) = std::sync::mpsc::channel();

        std::thread::spawn(move || {
            let result = sink.emit_json("pty-data", serde_json::json!({"data": "hi"}));
            done_tx.send(result).expect("send result");
        });

        assert!(
            matches!(
                done_rx.recv_timeout(std::time::Duration::from_millis(50)),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout)
            ),
            "event producer should block while the queue is full"
        );

        let first = rx.recv().await.expect("first queued frame");
        assert!(first.is_empty(), "expected the queue filler frame");

        let result = done_rx
            .recv_timeout(std::time::Duration::from_secs(1))
            .expect("emit should complete after capacity is available");
        assert!(result.is_ok(), "emit failed: {result:?}");

        let framed = rx.recv().await.expect("backpressured event frame");
        let s = std::str::from_utf8(&framed).expect("utf8");
        let body_start = s.find("\r\n\r\n").expect("delimiter") + 4;
        let body: serde_json::Value = serde_json::from_str(&s[body_start..]).expect("parse");
        assert_eq!(body["kind"], "event");
        assert_eq!(body["event"], "pty-data");
        assert_eq!(body["payload"]["data"], "hi");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn stdout_event_sink_backpressures_inside_tokio_task_without_panicking() {
        use crate::runtime::EventSink;

        let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(1);
        tx.try_send(Vec::new()).expect("fill channel");
        let sink = super::StdoutEventSink::new(tx);

        let handle = tokio::spawn(async move {
            let payload = serde_json::json!({"data": "hi"});
            sink.emit_json("pty-data", payload)
        });

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert!(
            !handle.is_finished(),
            "event producer should backpressure while the queue is full"
        );

        let first = rx.recv().await.expect("first queued frame");
        assert!(first.is_empty(), "expected the queue filler frame");

        let result = tokio::time::timeout(std::time::Duration::from_secs(1), handle)
            .await
            .expect("emit should complete after capacity is available")
            .expect("emit task should not panic");
        assert!(result.is_ok(), "emit failed: {result:?}");

        let framed = rx.recv().await.expect("backpressured event frame");
        let s = std::str::from_utf8(&framed).expect("utf8");
        let body_start = s.find("\r\n\r\n").expect("delimiter") + 4;
        let body: serde_json::Value = serde_json::from_str(&s[body_start..]).expect("parse");
        assert_eq!(body["kind"], "event");
        assert_eq!(body["event"], "pty-data");
        assert_eq!(body["payload"]["data"], "hi");
    }

    #[tokio::test]
    async fn stdout_event_sink_errors_when_current_thread_runtime_queue_is_full() {
        use crate::runtime::EventSink;

        let (tx, _rx) = tokio::sync::mpsc::channel::<Vec<u8>>(1);
        tx.try_send(Vec::new()).expect("fill channel");
        let sink = super::StdoutEventSink::new(tx);

        let err = sink
            .emit_json("pty-data", serde_json::json!({"data": "hi"}))
            .expect_err("current-thread runtime cannot synchronously backpressure");

        assert!(
            err.contains("current-thread runtime"),
            "unexpected error: {err}"
        );
    }

    #[tokio::test]
    async fn writer_task_shutdown_drains_queued_frames_with_live_sender() {
        let (tx, rx) = tokio::sync::mpsc::channel::<Vec<u8>>(16);
        let shutdown = tokio_util::sync::CancellationToken::new();
        let (mut read_end, write_end) = tokio::io::duplex(8192);

        tx.try_send(super::frame::format_frame(br#"{"one":1}"#))
            .expect("first send");
        tx.try_send(super::frame::format_frame(br#"{"two":2}"#))
            .expect("second send");

        let writer_handle = tokio::spawn(super::writer_task_with_shutdown(
            rx,
            write_end,
            shutdown.clone(),
            tokio_util::sync::CancellationToken::new(),
        ));
        shutdown.cancel();

        tokio::time::timeout(std::time::Duration::from_secs(1), writer_handle)
            .await
            .expect("writer timeout")
            .expect("writer task")
            .expect("writer ok");

        let mut output = Vec::new();
        read_end
            .read_to_end(&mut output)
            .await
            .expect("read output");
        let output = std::str::from_utf8(&output).expect("utf8");
        assert!(output.contains(r#"{"one":1}"#), "got {output}");
        assert!(output.contains(r#"{"two":2}"#), "got {output}");

        drop(tx);
    }

    #[tokio::test]
    async fn writer_task_shutdown_drain_times_out_when_writer_backpressures() {
        let (tx, rx) = tokio::sync::mpsc::channel::<Vec<u8>>(16);
        let shutdown = tokio_util::sync::CancellationToken::new();
        let cancel = tokio_util::sync::CancellationToken::new();

        tx.try_send(super::frame::format_frame(br#"{"one":1}"#))
            .expect("queue frame");

        let writer_handle = tokio::spawn(super::writer_task_with_shutdown_timeout(
            rx,
            PendingWriter,
            shutdown.clone(),
            cancel.clone(),
            std::time::Duration::from_millis(30),
        ));
        shutdown.cancel();

        let writer_result = tokio::time::timeout(std::time::Duration::from_secs(1), writer_handle)
            .await
            .expect("writer timeout")
            .expect("writer task");
        let err = writer_result.expect_err("writer drain should time out");
        assert_eq!(err.kind(), std::io::ErrorKind::TimedOut);
        assert!(cancel.is_cancelled(), "drain timeout should cancel IPC");
    }

    #[tokio::test]
    async fn writer_failure_cancels_run_loop() {
        let (state, _sink) = crate::runtime::BackendState::with_fake_sink();
        let (tx, rx) = tokio::sync::mpsc::channel::<Vec<u8>>(16);
        let writer_shutdown = tokio_util::sync::CancellationToken::new();
        let cancel = tokio_util::sync::CancellationToken::new();

        let writer_handle = tokio::spawn(super::writer_task_with_shutdown(
            rx,
            FailingWriter,
            writer_shutdown,
            cancel.clone(),
        ));

        let (read_end, write_end) = tokio::io::duplex(8192);
        let run_handle = tokio::spawn(super::run(state, read_end, tx.clone(), cancel.clone()));

        tx.send(super::frame::format_frame(
            br#"{"kind":"event","event":"boom","payload":{}}"#,
        ))
        .await
        .expect("queue frame");

        let writer_result = tokio::time::timeout(std::time::Duration::from_secs(1), writer_handle)
            .await
            .expect("writer timeout")
            .expect("writer task");
        assert!(writer_result.is_err(), "expected writer failure");

        let run_result = tokio::time::timeout(std::time::Duration::from_secs(1), run_handle)
            .await
            .expect("run timeout")
            .expect("run task");
        assert!(run_result.is_err(), "expected run cancellation");
        assert!(cancel.is_cancelled(), "writer failure should cancel run");

        drop(write_end);
    }

    #[tokio::test]
    async fn dispatch_unknown_method_errors() {
        let (state, _sink) = crate::runtime::BackendState::with_fake_sink();
        let err = super::router::dispatch(state, "no_such_method", serde_json::json!({}))
            .await
            .expect_err("err");
        assert!(
            err.starts_with("unknown method: no_such_method"),
            "got {err}"
        );
    }

    #[tokio::test]
    async fn dispatch_start_agent_watcher_reaches_backend_with_camel_case_params() {
        let (state, _sink) = crate::runtime::BackendState::with_fake_sink();
        let params = serde_json::json!({"sessionId": "unknown-session"});
        let outcome = super::router::dispatch(state, "start_agent_watcher", params).await;
        match outcome {
            Ok(v) => assert_eq!(v, serde_json::Value::Null),
            Err(msg) => assert!(
                !msg.starts_with("params:"),
                "params decode unexpectedly failed: {msg}"
            ),
        }
    }

    #[tokio::test]
    async fn dispatch_start_agent_watcher_rejects_snake_case_params() {
        let (state, _sink) = crate::runtime::BackendState::with_fake_sink();
        let params = serde_json::json!({"session_id": "s1"});
        let err = super::router::dispatch(state, "start_agent_watcher", params)
            .await
            .expect_err("err");
        assert!(err.starts_with("params:"), "got {err}");
    }

    #[tokio::test]
    async fn dispatch_get_git_diff_decodes_optional_untracked() {
        let (state, _sink) = crate::runtime::BackendState::with_fake_sink();

        let p_full = serde_json::json!({
            "cwd": "/tmp/nope",
            "file": "README.md",
            "staged": false,
            "untracked": true,
        });
        let r_full = super::router::dispatch(state.clone(), "get_git_diff", p_full).await;
        assert!(
            matches!(&r_full, Err(msg) if !msg.starts_with("params:")),
            "expected non-params error, got {r_full:?}"
        );

        let p_min = serde_json::json!({
            "cwd": "/tmp/nope",
            "file": "README.md",
            "staged": false,
        });
        let r_min = super::router::dispatch(state, "get_git_diff", p_min).await;
        assert!(
            matches!(&r_min, Err(msg) if !msg.starts_with("params:")),
            "expected non-params error, got {r_min:?}"
        );
    }

    #[tokio::test]
    async fn dispatch_list_sessions_empty_params_object_decodes() {
        let (state, _sink) = crate::runtime::BackendState::with_fake_sink();
        let outcome = super::router::dispatch(state, "list_sessions", serde_json::json!({})).await;
        let v = outcome.expect("list_sessions should succeed on fresh state");
        assert!(v.is_object(), "expected object, got {v:?}");
    }

    #[cfg(feature = "e2e-test")]
    #[tokio::test]
    async fn dispatch_list_active_pty_sessions_returns_array_under_e2e_feature() {
        let (state, _sink) = crate::runtime::BackendState::with_fake_sink();
        let outcome =
            super::router::dispatch(state, "list_active_pty_sessions", serde_json::json!({}))
                .await
                .expect("dispatch");
        assert!(outcome.is_array(), "expected array, got {outcome:?}");
    }

    #[tokio::test]
    async fn run_dispatches_one_request_and_writes_response() {
        let (state, _sink) = crate::runtime::BackendState::with_fake_sink();
        let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(16);
        let cancel = tokio_util::sync::CancellationToken::new();

        let (read_end, mut write_end) = tokio::io::duplex(8192);
        let run_handle = tokio::spawn(super::run(state, read_end, tx, cancel.clone()));

        let frame = make_request_frame("1", "list_sessions", serde_json::json!({}));
        write_end.write_all(&frame).await.expect("write");
        drop(write_end);

        let resp = recv_response(&mut rx).await;
        assert_eq!(resp["kind"], "response");
        assert_eq!(resp["id"], "1");
        assert_eq!(resp["ok"], true);

        run_handle.await.expect("run task").expect("run ok");
    }

    #[tokio::test]
    async fn run_waits_for_in_flight_handlers_before_clean_eof() {
        let (state, _sink) = crate::runtime::BackendState::with_fake_sink();
        let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(16);
        let cancel = tokio_util::sync::CancellationToken::new();

        let (read_end, mut write_end) = tokio::io::duplex(8192);
        let mut run_handle = tokio::spawn(super::run(state, read_end, tx, cancel));

        let frame = make_request_frame(
            "slow",
            "__test_sleep_then_null",
            serde_json::json!({"delayMs": 100}),
        );
        write_end.write_all(&frame).await.expect("write");
        drop(write_end);

        let early =
            tokio::time::timeout(std::time::Duration::from_millis(20), &mut run_handle).await;
        assert!(
            early.is_err(),
            "run returned before the in-flight handler drained"
        );

        let resp = recv_response(&mut rx).await;
        assert_eq!(resp["kind"], "response");
        assert_eq!(resp["id"], "slow");
        assert_eq!(resp["ok"], true);

        run_handle.await.expect("run task").expect("run ok");
    }

    #[tokio::test]
    async fn run_times_out_in_flight_handlers_on_clean_eof() {
        let (state, _sink) = crate::runtime::BackendState::with_fake_sink();
        let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(16);
        let cancel = tokio_util::sync::CancellationToken::new();

        let (read_end, mut write_end) = tokio::io::duplex(8192);
        let mut run_handle = tokio::spawn(super::run_with_handler_drain_timeout(
            state,
            read_end,
            tx,
            cancel.clone(),
            std::time::Duration::from_millis(30),
        ));

        let frame = make_request_frame(
            "too-slow",
            "__test_sleep_then_null",
            serde_json::json!({"delayMs": 250}),
        );
        write_end.write_all(&frame).await.expect("write");
        drop(write_end);

        tokio::time::timeout(std::time::Duration::from_secs(1), &mut run_handle)
            .await
            .expect("run timeout")
            .expect("run task")
            .expect("run ok");

        assert!(cancel.is_cancelled(), "clean EOF timeout should cancel");
        let response = tokio::time::timeout(std::time::Duration::from_millis(100), rx.recv()).await;
        assert!(
            !matches!(response, Ok(Some(_))),
            "timed-out handler should not send a response: {response:?}"
        );
    }

    #[tokio::test]
    async fn run_rejects_requests_above_concurrent_handler_cap() {
        let (state, _sink) = crate::runtime::BackendState::with_fake_sink();
        let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(128);
        let cancel = tokio_util::sync::CancellationToken::new();

        let (read_end, mut write_end) = tokio::io::duplex(64 * 1024);
        let run_handle = tokio::spawn(super::run_with_handler_drain_timeout(
            state,
            read_end,
            tx,
            cancel.clone(),
            std::time::Duration::from_millis(30),
        ));

        for i in 0..super::MAX_CONCURRENT_HANDLERS {
            let frame = make_request_frame(
                &format!("slow-{i}"),
                "__test_sleep_then_null",
                serde_json::json!({"delayMs": 500}),
            );
            write_end.write_all(&frame).await.expect("write slow frame");
        }

        let overflow = make_request_frame(
            "overflow",
            "__test_sleep_then_null",
            serde_json::json!({"delayMs": 1}),
        );
        write_end
            .write_all(&overflow)
            .await
            .expect("write overflow");
        drop(write_end);

        let resp = recv_response(&mut rx).await;
        assert_eq!(resp["kind"], "response");
        assert_eq!(resp["id"], "overflow");
        assert_eq!(resp["ok"], false);
        assert_eq!(resp["error"], "server overloaded");

        tokio::time::timeout(std::time::Duration::from_secs(1), run_handle)
            .await
            .expect("run timeout")
            .expect("run task")
            .expect("run ok");
        assert!(
            cancel.is_cancelled(),
            "drain timeout should cancel slow handlers"
        );
    }

    #[tokio::test]
    async fn run_unknown_method_returns_id_bearing_error_response() {
        let (state, _sink) = crate::runtime::BackendState::with_fake_sink();
        let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(16);
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
            resp["error"]
                .as_str()
                .unwrap()
                .starts_with("unknown method:"),
            "got {}",
            resp["error"]
        );

        run_handle.await.expect("run task").expect("run ok");
    }

    #[tokio::test]
    async fn run_wrong_kind_envelope_logs_and_drops_no_response() {
        let (state, _sink) = crate::runtime::BackendState::with_fake_sink();
        let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(16);
        let cancel = tokio_util::sync::CancellationToken::new();
        let (read_end, mut write_end) = tokio::io::duplex(8192);
        let run_handle = tokio::spawn(super::run(state, read_end, tx, cancel));

        let body = br#"{"kind":"response","id":"x","ok":true}"#;
        let frame = super::frame::format_frame(body);
        write_end.write_all(&frame).await.expect("write");
        drop(write_end);

        let res = tokio::time::timeout(std::time::Duration::from_millis(100), rx.recv()).await;
        assert!(
            !matches!(res, Ok(Some(_))),
            "expected no response frame, got {res:?}"
        );

        run_handle.await.expect("run task").expect("run ok");
    }

    #[tokio::test]
    async fn run_bad_request_envelope_returns_id_bearing_error_response() {
        let (state, _sink) = crate::runtime::BackendState::with_fake_sink();
        let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(16);
        let cancel = tokio_util::sync::CancellationToken::new();
        let (read_end, mut write_end) = tokio::io::duplex(8192);
        let run_handle = tokio::spawn(super::run(state, read_end, tx, cancel));

        let body = br#"{"kind":"request","id":"bad","params":{}}"#;
        let frame = super::frame::format_frame(body);
        write_end.write_all(&frame).await.expect("write");
        drop(write_end);

        let resp = recv_response(&mut rx).await;
        assert_eq!(resp["kind"], "response");
        assert_eq!(resp["id"], "bad");
        assert_eq!(resp["ok"], false);
        assert_eq!(resp["error"], "bad envelope");

        run_handle.await.expect("run task").expect("run ok");
    }

    #[tokio::test]
    async fn run_null_params_normalized_for_empty_decoder() {
        let (state, _sink) = crate::runtime::BackendState::with_fake_sink();
        let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(16);
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
        let (tx, _rx) = tokio::sync::mpsc::channel::<Vec<u8>>(16);
        let cancel = tokio_util::sync::CancellationToken::new();
        let (read_end, mut write_end) =
            tokio::io::duplex(super::frame::RESYNC_BUDGET_BYTES as usize * 2);
        let run_handle = tokio::spawn(super::run(state, read_end, tx, cancel));

        let big_line: Vec<u8> = (b'A'..=b'Z')
            .cycle()
            .take(super::frame::RESYNC_BUDGET_BYTES as usize + 1024)
            .collect();
        write_end.write_all(&big_line).await.expect("write");
        drop(write_end);

        let outcome = run_handle.await.expect("run task");
        assert!(outcome.is_err(), "expected fatal err, got {outcome:?}");
    }
}

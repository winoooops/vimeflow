//! LSP-style JSON-RPC IPC layer for the `vimeflow-backend` sidecar.
//!
//! PR-B (spec: docs/superpowers/specs/2026-05-13-pr-b-rust-sidecar-ipc-design.md).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncRead, AsyncWrite, BufReader};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio_util::sync::CancellationToken;

use crate::runtime::event_sink::EventSink;

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

/// Event sink that formats LSP frames synchronously and pushes them onto an
/// unbounded channel. A single writer task owns stdout and drains the channel.
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

mod frame {
    use std::io;

    use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt};

    /// Maximum body bytes per frame. Protects against a malicious or buggy peer
    /// triggering unbounded allocation.
    pub const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;

    /// Hard cap on a single header line.
    pub const MAX_HEADER_LINE_BYTES: u64 = 8 * 1024;

    /// Soft cap on bytes consumed while resyncing past malformed header noise.
    pub const RESYNC_BUDGET_BYTES: u64 = 64 * 1024;

    #[derive(Debug)]
    pub enum FrameError {
        /// Header line malformed but the codec advanced past it without
        /// exceeding RESYNC_BUDGET_BYTES. Kept as part of the run-loop contract;
        /// the current codec resyncs internally so this variant is not emitted.
        #[allow(dead_code)]
        ResyncableBadHeader(String),
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

    #[allow(dead_code)]
    pub async fn write_frame<W: AsyncWrite + Unpin>(writer: &mut W, body: &[u8]) -> io::Result<()> {
        let header = format!("Content-Length: {}\r\n\r\n", body.len());
        writer.write_all(header.as_bytes()).await?;
        writer.write_all(body).await?;
        writer.flush().await
    }

    pub async fn read_frame<R: AsyncBufRead + Unpin>(
        reader: &mut R,
    ) -> Result<Option<Vec<u8>>, FrameError> {
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
                if resync_consumed == 0 && content_length.is_none() {
                    return Ok(None);
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
            _ => Err(format!("unknown method: {method}")),
        }
    }
}

/// Drain the writer channel into `writer` until all senders drop.
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

/// Read frames from `reader`, dispatch each as a Tokio task, and send responses
/// through `tx`. Clean EOF returns `Ok(())`; fatal codec errors return `Err`.
pub async fn run<R: AsyncRead + Unpin + Send>(
    state: std::sync::Arc<crate::runtime::BackendState>,
    reader: R,
    tx: UnboundedSender<Vec<u8>>,
    cancel: CancellationToken,
) -> Result<(), std::io::Error> {
    let mut buf_reader = BufReader::new(reader);

    loop {
        match frame::read_frame(&mut buf_reader).await {
            Ok(Some(body)) => {
                spawn_handler(state.clone(), tx.clone(), cancel.clone(), body);
            }
            Ok(None) => return Ok(()),
            Err(frame::FrameError::ResyncableBadHeader(msg)) => {
                log::warn!("ipc bad frame header (resyncable): {msg}");
                continue;
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
    state: std::sync::Arc<crate::runtime::BackendState>,
    tx: UnboundedSender<Vec<u8>>,
    cancel: CancellationToken,
    body: Vec<u8>,
) {
    tokio::spawn(async move {
        let mut req: RequestFrame = match serde_json::from_slice::<InboundFrame>(&body) {
            Ok(InboundFrame::Request(req)) => req,
            Err(err) => {
                log::warn!("ipc bad envelope: {err}");
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

        let _ = tx.send(frame::format_frame(&body));
    });
}

#[cfg(test)]
mod tests {
    use tokio::io::AsyncWriteExt;

    use super::frame;

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

    async fn recv_response(
        rx: &mut tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>,
    ) -> serde_json::Value {
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
    async fn write_frame_round_trips_through_read_frame() {
        let body = br#"{"a":1,"b":"two"}"#;
        let mut buf: Vec<u8> = Vec::new();
        frame::write_frame(&mut buf, body).await.expect("write");
        let mut reader = make_reader(&buf);
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

        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
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

        let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        drop(rx);
        let sink = super::StdoutEventSink::new(tx);
        let err = sink
            .emit_json("pty-data", serde_json::json!({}))
            .expect_err("expected err");
        assert!(err.contains("stdout writer closed"), "got {err}");
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
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
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
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
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
    async fn run_null_params_normalized_for_empty_decoder() {
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

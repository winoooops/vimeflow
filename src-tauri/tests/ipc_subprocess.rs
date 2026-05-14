//! Integration tests that spawn `vimeflow-backend` as a subprocess and assert
//! IPC wire shape over real stdio.

use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::time::Duration;

use serde_json::{json, Value};
use tempfile::TempDir;

const BIN: &str = env!("CARGO_BIN_EXE_vimeflow-backend");

struct IpcClient {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: Option<BufReader<ChildStdout>>,
    next_id: u64,
    _app_data_dir: TempDir,
}

impl IpcClient {
    fn spawn() -> Self {
        let app_data_dir = tempfile::tempdir().expect("tempdir");
        let mut child = Command::new(BIN)
            .args([
                "--app-data-dir",
                app_data_dir.path().to_str().expect("path"),
            ])
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
            stdout: Some(stdout),
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
        loop {
            let body = self.read_one_frame_body();
            let v: Value = serde_json::from_slice(&body).expect("parse frame");
            if v["kind"] == "response" && v["id"] == want_id {
                return v;
            }
        }
    }

    fn read_one_frame_body(&mut self) -> Vec<u8> {
        let mut stdout = self.stdout.take().expect("stdout already taken");
        let (tx, rx) = std::sync::mpsc::channel();

        std::thread::spawn(move || {
            let result = Self::read_one_frame_body_from(&mut stdout);
            let _ = tx.send((result, stdout));
        });

        match rx.recv_timeout(Duration::from_secs(2)) {
            Ok((Ok(body), stdout)) => {
                self.stdout = Some(stdout);
                body
            }
            Ok((Err(err), stdout)) => {
                self.stdout = Some(stdout);
                panic!("{err}");
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                panic!("timed out reading frame from sidecar stdout");
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                panic!("stdout read thread disconnected");
            }
        }
    }

    fn read_one_frame_body_from(stdout: &mut BufReader<ChildStdout>) -> Result<Vec<u8>, String> {
        let mut content_length: Option<usize> = None;

        loop {
            let mut line = String::new();
            let n = stdout
                .read_line(&mut line)
                .map_err(|err| format!("read header line: {err}"))?;
            if n == 0 {
                return Err("unexpected EOF reading frame headers".into());
            }
            let trimmed = line.trim_end_matches(['\r', '\n']);

            if trimmed.is_empty() {
                let len =
                    content_length.ok_or("Content-Length must precede blank line".to_string())?;
                let mut body = vec![0u8; len];
                stdout
                    .read_exact(&mut body)
                    .map_err(|err| format!("read body: {err}"))?;
                return Ok(body);
            }

            if let Some((name, value)) = trimmed.split_once(':') {
                if name.trim().eq_ignore_ascii_case("Content-Length") {
                    content_length = Some(
                        value
                            .trim()
                            .parse()
                            .map_err(|err| format!("parse content-length: {err}"))?,
                    );
                }
            }
        }
    }

    fn close_stdin(&mut self) {
        drop(self.stdin.take());
    }

    fn wait_exit(
        &mut self,
        timeout: Duration,
    ) -> std::io::Result<Option<std::process::ExitStatus>> {
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
    assert!(
        !resp["result"].is_null(),
        "list_sessions result must be non-null, got {resp}"
    );
}

#[test]
fn unknown_method_returns_id_bearing_error_response() {
    let mut client = IpcClient::spawn();
    let resp = client.send_request("no_such_method", json!({}));

    assert_eq!(resp["kind"], "response");
    assert_eq!(resp["id"], "1");
    assert_eq!(resp["ok"], false);
    assert!(
        resp["error"]
            .as_str()
            .unwrap()
            .starts_with("unknown method:"),
        "got {resp}"
    );
}

#[test]
fn bad_kind_envelope_drops_no_response_without_desyncing() {
    let mut client = IpcClient::spawn();
    let body = br#"{"kind":"response","id":"x","ok":true}"#;
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    {
        let stdin = client.stdin_mut();
        stdin.write_all(header.as_bytes()).expect("write");
        stdin.write_all(body).expect("write");
        stdin.flush().expect("flush");
    }

    let resp = client.send_request("list_sessions", json!({}));
    assert_eq!(resp["id"], "1");
    assert_eq!(resp["ok"], true);
}

#[test]
fn eof_triggers_clean_exit_zero() {
    let mut client = IpcClient::spawn();
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

#[test]
fn garbage_input_does_not_corrupt_stdout() {
    let app_data_dir = tempfile::tempdir().expect("tempdir");
    let mut child = Command::new(BIN)
        .args([
            "--app-data-dir",
            app_data_dir.path().to_str().expect("path"),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn bin");

    {
        let mut stdin = child.stdin.take().expect("stdin");
        stdin
            .write_all(b"garbage garbage garbage\n")
            .expect("write");
    }

    let output = child.wait_with_output().expect("wait");
    assert!(!output.status.success(), "expected protocol error exit");
    assert!(
        output.stdout.is_empty(),
        "stdout should be protocol-only, got {:?}",
        String::from_utf8_lossy(&output.stdout)
    );
    assert!(
        !output.stderr.is_empty(),
        "stderr should contain the protocol error"
    );
}

#[test]
fn error_exit_clears_session_cache() {
    let app_data_dir = tempfile::tempdir().expect("tempdir");
    let cache_path = app_data_dir.path().join("sessions.json");
    let seeded_cache = json!({
        "version": 1,
        "active_session_id": "ghost",
        "session_order": ["ghost"],
        "sessions": {
            "ghost": {
                "cwd": "/tmp",
                "created_at": "2026-05-14T00:00:00Z",
                "exited": false,
                "last_exit_code": null
            }
        }
    });
    std::fs::write(
        &cache_path,
        serde_json::to_vec(&seeded_cache).expect("encode cache"),
    )
    .expect("seed cache");

    let mut child = Command::new(BIN)
        .args([
            "--app-data-dir",
            app_data_dir.path().to_str().expect("path"),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn bin");

    {
        let mut stdin = child.stdin.take().expect("stdin");
        stdin
            .write_all(b"garbage garbage garbage\n")
            .expect("write");
    }

    let output = child.wait_with_output().expect("wait");
    assert!(!output.status.success(), "expected protocol error exit");

    let cache: Value = serde_json::from_slice(&std::fs::read(cache_path).expect("read cache"))
        .expect("parse cache");
    assert_eq!(cache["sessions"].as_object().expect("sessions").len(), 0);
    assert_eq!(
        cache["session_order"]
            .as_array()
            .expect("session_order")
            .len(),
        0
    );
    assert!(cache["active_session_id"].is_null());
}

#[test]
fn every_production_method_returns_well_formed_response_frame() {
    let cases: &[(&str, Value)] = &[
        ("list_sessions", json!({})),
        (
            "write_pty",
            json!({"request": {"sessionId": "no-such-session", "data": ""}}),
        ),
        (
            "resize_pty",
            json!({"request": {"sessionId": "no-such-session", "cols": 80, "rows": 24}}),
        ),
        (
            "kill_pty",
            json!({"request": {"sessionId": "no-such-session"}}),
        ),
        (
            "set_active_session",
            json!({"request": {"id": "no-such-session"}}),
        ),
        ("reorder_sessions", json!({"request": {"ids": []}})),
        (
            "update_session_cwd",
            json!({"request": {"id": "no-such-session", "cwd": "/tmp"}}),
        ),
        (
            "detect_agent_in_session",
            json!({"sessionId": "no-such-session"}),
        ),
        (
            "start_agent_watcher",
            json!({"sessionId": "no-such-session"}),
        ),
        (
            "stop_agent_watcher",
            json!({"sessionId": "no-such-session"}),
        ),
        ("list_dir", json!({"request": {"path": "/tmp"}})),
        (
            "read_file",
            json!({"request": {"path": "/tmp/no-such-file-vimeflow-test"}}),
        ),
        (
            "write_file",
            json!({"request": {"path": "/tmp/no-such-dir/out.txt", "content": ""}}),
        ),
        ("git_status", json!({"cwd": "/tmp/no-such-dir"})),
        ("git_branch", json!({"cwd": "/tmp/no-such-dir"})),
        (
            "get_git_diff",
            json!({"cwd": "/tmp/no-such-dir", "file": "x", "staged": false}),
        ),
        ("start_git_watcher", json!({"cwd": "/tmp/no-such-dir"})),
        ("stop_git_watcher", json!({"cwd": "/tmp/no-such-dir"})),
        (
            "spawn_pty",
            json!({"request": {
                "sessionId": "spawn-invalid-cwd",
                "cwd": "/tmp/no-such-dir",
                "shell": null,
                "env": null,
                "enableAgentBridge": false
            }}),
        ),
    ];

    let mut client = IpcClient::spawn();
    for (method, params) in cases {
        let resp = client.send_request(method, params.clone());
        assert_eq!(resp["kind"], "response", "method={method} resp={resp}");
        assert!(resp["id"].is_string(), "method={method} id missing: {resp}");
        assert!(
            resp["ok"].is_boolean(),
            "method={method} ok missing: {resp}"
        );
        if resp["ok"] == false {
            assert!(
                resp["error"].is_string(),
                "method={method} ok=false but no error string: {resp}"
            );
        } else {
            assert!(
                resp.get("result").is_some(),
                "method={method} ok=true but no result: {resp}"
            );
        }
    }
}

#[cfg(feature = "e2e-test")]
#[test]
fn list_active_pty_sessions_responds_under_e2e_feature() {
    let mut client = IpcClient::spawn();
    let resp = client.send_request("list_active_pty_sessions", json!({}));

    assert_eq!(resp["kind"], "response");
    assert_eq!(resp["ok"], true, "expected ok, got {resp}");
    assert!(resp["result"].is_array(), "expected array, got {resp}");
}

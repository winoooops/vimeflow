use super::*;
use serde_json::json;

use crate::runtime::FakeEventSink;

fn test_store(path: PathBuf, max_bytes: u64) -> TraceStore {
    TraceStore::with_config(
        path,
        TraceStoreConfig {
            max_bytes,
            max_generations: 3,
        },
    )
}

fn test_record(correlation_id: &str, event: &str) -> TraceRecord {
    TraceRecord {
        schema_version: SCHEMA_VERSION,
        timestamp: "2026-06-08T12:00:00.000Z".to_string(),
        correlation_id: correlation_id.to_string(),
        span_id: "vf_span_test".to_string(),
        parent_span_id: Some("vf_parent".to_string()),
        layer: "backend",
        event: event.to_string(),
        session_id: Some("pty-1".to_string()),
        agent_type: Some("codex"),
        status: Some("ok"),
        attributes: trace_attributes([("operation", "test")]),
    }
}

fn read_jsonl(path: &Path) -> Vec<Value> {
    fs::read_to_string(path)
        .expect("trace file should be readable")
        .lines()
        .map(|line| serde_json::from_str(line).expect("trace line should be json"))
        .collect()
}

#[test]
fn append_writes_one_json_object_per_line() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let path = temp_dir.path().join("logs").join(TRACE_LOG_NAME);
    let store = test_store(path.clone(), DEFAULT_MAX_TRACE_BYTES);

    store
        .append(&test_record("vf_corr_append", "backend.work"))
        .expect("append trace");

    let content = fs::read_to_string(&path).expect("trace content");
    assert_eq!(content.matches('\n').count(), 1);
    let records = read_jsonl(&path);
    assert_eq!(records[0]["correlationId"], "vf_corr_append");
    assert_eq!(records[0]["event"], "backend.work");

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(&path)
            .expect("trace metadata")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
    }
}

#[test]
fn append_rotates_and_retains_bounded_generations() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let path = temp_dir.path().join(TRACE_LOG_NAME);
    fs::write(&path, "current").expect("seed current");
    fs::write(rotated_path(&path, 1), "one").expect("seed one");
    fs::write(rotated_path(&path, 2), "two").expect("seed two");
    fs::write(rotated_path(&path, 3), "three").expect("seed three");
    let store = test_store(path.clone(), 1);

    store
        .append(&test_record("vf_corr_rotate", "backend.work"))
        .expect("append trace");

    assert_eq!(
        fs::read_to_string(rotated_path(&path, 1)).expect("rotated one"),
        "current"
    );
    assert_eq!(
        fs::read_to_string(rotated_path(&path, 2)).expect("rotated two"),
        "one"
    );
    assert_eq!(
        fs::read_to_string(rotated_path(&path, 3)).expect("rotated three"),
        "two"
    );
    let records = read_jsonl(&path);
    assert_eq!(records[0]["correlationId"], "vf_corr_rotate");
}

#[test]
fn default_log_dir_resolves_linux_path() {
    let path = default_log_dir_for_home(Path::new("/home/alice"), SupportedTraceOs::Linux);

    assert_eq!(
        path,
        Path::new("/home/alice")
            .join(".local")
            .join("share")
            .join("vimeflow")
            .join("logs")
    );
}

#[test]
fn default_log_dir_resolves_macos_path() {
    let path = default_log_dir_for_home(Path::new("/Users/alice"), SupportedTraceOs::Macos);

    assert_eq!(
        path,
        Path::new("/Users/alice")
            .join("Library")
            .join("Application Support")
            .join("vimeflow")
            .join("logs")
    );
}

#[test]
fn redaction_removes_secret_keys_tokens_and_newlines() {
    let attributes = redact_attributes(BTreeMap::from([
        ("apiKey".to_string(), "sk-proj-secretsecret".to_string()),
        (
            "message".to_string(),
            "first\nBearer abcdefghijklmnop\rthird".to_string(),
        ),
    ]));

    assert_eq!(attributes["apiKey"], REDACTED);
    assert_eq!(attributes["message"], "first\\n[redacted]\\rthird");
}

#[test]
fn tracing_event_sink_forwards_agent_event_unchanged_and_records_trace() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let path = temp_dir.path().join("logs").join(TRACE_LOG_NAME);
    let tracing = TraceService::with_store(test_store(path.clone(), DEFAULT_MAX_TRACE_BYTES));
    tracing
        .set_enabled(true)
        .expect("enable tracing should create log dir");
    let context = TraceContext::from_optional(
        Some("vf_corr_agent"),
        Some("vf_root"),
        Some("pty-1"),
        Some(AgentType::Codex),
    )
    .expect("valid context");
    tracing.remember_session_context("pty-1", context);

    let raw_sink = Arc::new(FakeEventSink::new());
    let sink = TracingEventSink {
        inner: raw_sink.clone(),
        tracing,
    };
    let payload = json!({
        "sessionId": "pty-1",
        "agentSessionId": "agent-1",
        "title": "Secret branch title",
        "source": "user-renamed",
    });

    sink.emit_json("agent-session-title", payload.clone())
        .expect("emit should forward");

    assert_eq!(
        raw_sink.recorded(),
        vec![("agent-session-title".to_string(), payload)]
    );
    let records = read_jsonl(&path);
    assert_eq!(records[0]["correlationId"], "vf_corr_agent");
    assert_eq!(records[0]["layer"], "agent");
    assert_eq!(
        records[0]["attributes"]["agentEvent"],
        "agent-session-title"
    );
    assert_eq!(records[0]["attributes"]["titleLength"], "19");
    assert!(records[0]["attributes"].get("title").is_none());
}

#[test]
fn tracing_event_sink_forwards_non_agent_event_without_trace_record() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let path = temp_dir.path().join("logs").join(TRACE_LOG_NAME);
    let tracing = TraceService::with_store(test_store(path.clone(), DEFAULT_MAX_TRACE_BYTES));
    tracing.set_enabled(true).expect("enable tracing");

    let raw_sink = Arc::new(FakeEventSink::new());
    let sink = TracingEventSink {
        inner: raw_sink.clone(),
        tracing,
    };
    let payload = json!({
        "sessionId": "pty-1",
        "data": "terminal output",
    });

    sink.emit_json("pty-data", payload.clone())
        .expect("emit should forward");

    assert_eq!(raw_sink.recorded(), vec![("pty-data".to_string(), payload)]);
    assert!(
        !path.exists(),
        "non-agent events must not be persisted as traces"
    );
}

#[test]
fn correlation_id_propagates_from_user_interaction_to_ipc_backend_and_agent() {
    let temp_dir = tempfile::tempdir().expect("temp dir");
    let path = temp_dir.path().join("logs").join(TRACE_LOG_NAME);
    let tracing = TraceService::with_store(test_store(path.clone(), DEFAULT_MAX_TRACE_BYTES));
    tracing.set_enabled(true).expect("enable tracing");

    tracing
        .record_user_interaction(TraceUserInteractionRequest {
            correlation_id: "vf_corr_full".to_string(),
            span_id: "vf_root".to_string(),
            parent_span_id: None,
            event: "pane.rename".to_string(),
            session_id: Some("pty-1".to_string()),
            agent_type: Some(AgentType::ClaudeCode),
            attributes: BTreeMap::from([("titleLength".to_string(), "7".to_string())]),
        })
        .expect("record frontend event");
    let context = TraceContext::from_optional(
        Some("vf_corr_full"),
        Some("vf_root"),
        Some("pty-1"),
        Some(AgentType::ClaudeCode),
    )
    .expect("valid context");
    tracing
        .record_ipc_request("rename_agent_session", Some(&context))
        .expect("record ipc request");
    tracing
        .record_backend_work(
            Some(&context),
            "rename_agent_session.write_pty",
            "ok",
            trace_attributes([("ptyId", "pty-1")]),
        )
        .expect("record backend work");
    tracing.remember_session_context("pty-1", context);
    tracing
        .record_agent_event(
            "agent-session-title",
            &json!({
                "sessionId": "pty-1",
                "title": "Feature",
                "source": "user-renamed",
            }),
        )
        .expect("record agent event");

    let records = read_jsonl(&path);
    assert_eq!(records.len(), 4);
    assert!(records
        .iter()
        .all(|record| record["correlationId"] == "vf_corr_full"));
    assert_eq!(records[0]["layer"], "frontend");
    assert_eq!(records[1]["event"], "ipc.request");
    assert_eq!(records[2]["event"], "backend.work");
    assert_eq!(records[3]["layer"], "agent");
}

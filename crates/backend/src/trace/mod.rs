//! Local JSONL tracing for user interactions, IPC, backend work, and agent
//! events.

use std::collections::{BTreeMap, HashMap};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chrono::{SecondsFormat, Utc};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::agent::types::AgentType;
use crate::runtime::EventSink;

const TRACE_LOG_NAME: &str = "trace.jsonl";
const DEFAULT_MAX_TRACE_BYTES: u64 = 5 * 1024 * 1024;
const DEFAULT_MAX_TRACE_GENERATIONS: usize = 3;
const SCHEMA_VERSION: u8 = 1;
const MAX_TRACE_ID_BYTES: usize = 128;
const MAX_SESSION_ID_BYTES: usize = 128;
const MAX_EVENT_NAME_BYTES: usize = 96;
const MAX_ATTRIBUTE_KEY_BYTES: usize = 64;
const MAX_ATTRIBUTE_VALUE_CHARS: usize = 256;
const MAX_ATTRIBUTES: usize = 24;
const SESSION_CONTEXT_TTL: Duration = Duration::from_secs(15 * 60);
const REDACTED: &str = "[redacted]";

static SECRET_VALUE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?i)(bearer\s+[a-z0-9._~+/=-]+|sk-proj-[a-z0-9_-]{10,}|sk-[a-z0-9_-]{10,}|ghp_[a-z0-9_]{10,}|xox[baprs]-[a-z0-9-]{10,})",
    )
    .expect("secret redaction regex is valid")
});

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct SetTracingEnabledRequest {
    pub enabled: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
#[serde(rename_all = "camelCase")]
pub struct TraceUserInteractionRequest {
    pub correlation_id: String,
    pub span_id: String,
    #[cfg_attr(test, ts(optional))]
    #[serde(default)]
    pub parent_span_id: Option<String>,
    pub event: String,
    #[cfg_attr(test, ts(optional))]
    #[serde(default)]
    pub session_id: Option<String>,
    #[cfg_attr(test, ts(optional))]
    #[serde(default)]
    pub agent_type: Option<AgentType>,
    #[serde(default)]
    pub attributes: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TraceContext {
    correlation_id: String,
    parent_span_id: Option<String>,
    session_id: Option<String>,
    agent_type: Option<AgentType>,
}

impl TraceContext {
    pub(crate) fn from_optional(
        correlation_id: Option<&str>,
        parent_span_id: Option<&str>,
        session_id: Option<&str>,
        agent_type: Option<AgentType>,
    ) -> Option<Self> {
        let correlation_id = correlation_id?;
        if !is_valid_trace_id(correlation_id) {
            return None;
        }

        let parent_span_id = match parent_span_id {
            Some(value) if is_valid_trace_id(value) => Some(value.to_string()),
            Some(_) => return None,
            None => None,
        };

        Some(Self {
            correlation_id: correlation_id.to_string(),
            parent_span_id,
            session_id: session_id
                .filter(|value| is_valid_session_id(value))
                .map(str::to_string),
            agent_type,
        })
    }
}

#[derive(Debug, Clone)]
struct StoredTraceContext {
    context: TraceContext,
    recorded_at: Instant,
}

#[derive(Debug, Clone)]
struct TraceStoreConfig {
    max_bytes: u64,
    max_generations: usize,
}

#[derive(Debug, Clone)]
struct TraceStore {
    path: PathBuf,
    config: TraceStoreConfig,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TraceRecord {
    schema_version: u8,
    timestamp: String,
    correlation_id: String,
    span_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    parent_span_id: Option<String>,
    layer: &'static str,
    event: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    agent_type: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<&'static str>,
    attributes: BTreeMap<String, String>,
}

struct TraceRuntimeState {
    enabled: bool,
    store: TraceStore,
    session_contexts: HashMap<String, StoredTraceContext>,
}

struct TraceServiceInner {
    state: Mutex<TraceRuntimeState>,
    next_span_id: AtomicU64,
}

#[derive(Clone)]
pub(crate) struct TraceService {
    inner: Arc<TraceServiceInner>,
}

pub(crate) struct TracingEventSink {
    inner: Arc<dyn EventSink>,
    tracing: TraceService,
}

impl TraceStore {
    fn new(app_data_dir: PathBuf) -> Self {
        Self::with_config(
            trace_log_path_from_app_data(&app_data_dir),
            TraceStoreConfig {
                max_bytes: DEFAULT_MAX_TRACE_BYTES,
                max_generations: DEFAULT_MAX_TRACE_GENERATIONS,
            },
        )
    }

    fn with_config(path: PathBuf, config: TraceStoreConfig) -> Self {
        Self { path, config }
    }

    fn ensure_parent(&self) -> io::Result<()> {
        let Some(parent) = self.path.parent() else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "trace log path has no parent directory",
            ));
        };

        fs::create_dir_all(parent)
    }

    fn append(&self, record: &TraceRecord) -> io::Result<()> {
        self.rotate_if_needed()?;
        self.ensure_parent()?;

        let mut options = OpenOptions::new();
        options.create(true).append(true);

        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
        }

        let mut file = options.open(&self.path)?;
        let line = serde_json::to_string(record)
            .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))?;
        writeln!(file, "{line}")?;
        file.flush()
    }

    fn rotate_if_needed(&self) -> io::Result<()> {
        let Ok(metadata) = fs::metadata(&self.path) else {
            return Ok(());
        };

        if metadata.len() < self.config.max_bytes {
            return Ok(());
        }

        if self.config.max_generations == 0 {
            fs::remove_file(&self.path)?;
            return Ok(());
        }

        let oldest = rotated_path(&self.path, self.config.max_generations);
        remove_if_exists(&oldest)?;

        for generation in (1..self.config.max_generations).rev() {
            let source = rotated_path(&self.path, generation);
            let target = rotated_path(&self.path, generation + 1);
            if source.exists() {
                remove_if_exists(&target)?;
                fs::rename(source, target)?;
            }
        }

        fs::rename(&self.path, rotated_path(&self.path, 1))
    }
}

impl TraceRuntimeState {
    fn prune_expired_contexts(&mut self) {
        let now = Instant::now();
        self.session_contexts
            .retain(|_, entry| now.duration_since(entry.recorded_at) <= SESSION_CONTEXT_TTL);
    }
}

impl TraceService {
    pub(crate) fn new(app_data_dir: PathBuf) -> Self {
        Self::with_store(TraceStore::new(app_data_dir))
    }

    fn with_store(store: TraceStore) -> Self {
        Self {
            inner: Arc::new(TraceServiceInner {
                state: Mutex::new(TraceRuntimeState {
                    enabled: false,
                    store,
                    session_contexts: HashMap::new(),
                }),
                next_span_id: AtomicU64::new(1),
            }),
        }
    }

    pub(crate) fn wrap_event_sink(&self, inner: Arc<dyn EventSink>) -> Arc<dyn EventSink> {
        Arc::new(TracingEventSink {
            inner,
            tracing: self.clone(),
        })
    }

    pub(crate) fn set_enabled(&self, enabled: bool) -> Result<(), String> {
        let mut state = self
            .inner
            .state
            .lock()
            .map_err(|err| format!("trace state lock poisoned: {err}"))?;

        if enabled {
            state
                .store
                .ensure_parent()
                .map_err(|err| format!("trace log dir: {err}"))?;
        } else {
            state.session_contexts.clear();
        }

        state.enabled = enabled;
        Ok(())
    }

    pub(crate) fn is_enabled(&self) -> bool {
        self.inner
            .state
            .lock()
            .map(|state| state.enabled)
            .unwrap_or(false)
    }

    pub(crate) fn record_user_interaction(
        &self,
        request: TraceUserInteractionRequest,
    ) -> Result<(), String> {
        validate_trace_id(&request.correlation_id, "correlationId")?;
        validate_trace_id(&request.span_id, "spanId")?;
        if let Some(parent_span_id) = request.parent_span_id.as_deref() {
            validate_trace_id(parent_span_id, "parentSpanId")?;
        }
        validate_event_name(&request.event)?;
        let session_id =
            allowed_frontend_session_id(&request.event, request.session_id.as_deref())?;
        let attributes = frontend_interaction_attributes(&request.event, &request.attributes)?;

        let store = {
            let state = self
                .inner
                .state
                .lock()
                .map_err(|err| format!("trace state lock poisoned: {err}"))?;

            if !state.enabled {
                return Ok(());
            }

            state.store.clone()
        };

        let record = TraceRecord {
            schema_version: SCHEMA_VERSION,
            timestamp: timestamp(),
            correlation_id: request.correlation_id,
            span_id: request.span_id,
            parent_span_id: request.parent_span_id,
            layer: "frontend",
            event: "user.interaction".to_string(),
            session_id,
            agent_type: request.agent_type.map(agent_type_label),
            status: None,
            attributes,
        };

        store
            .append(&record)
            .map_err(|err| format!("trace append: {err}"))
    }

    pub(crate) fn context_from_params(&self, params: &Value) -> Option<TraceContext> {
        let object = params.as_object()?;
        let correlation_id = string_field(object.get("correlationId"));
        let parent_span_id = string_field(object.get("parentSpanId"));
        let session_id = string_field(object.get("sessionId"))
            .or_else(|| string_field(object.get("ptyId")))
            .or_else(|| {
                object
                    .get("request")
                    .and_then(Value::as_object)
                    .and_then(|request| {
                        string_field(request.get("sessionId"))
                            .or_else(|| string_field(request.get("ptyId")))
                    })
            });
        let agent_type = string_field(object.get("agentType")).and_then(parse_agent_type);

        TraceContext::from_optional(correlation_id, parent_span_id, session_id, agent_type)
    }

    pub(crate) fn context_from_request(
        &self,
        correlation_id: Option<&str>,
        parent_span_id: Option<&str>,
        session_id: Option<&str>,
        agent_type: Option<AgentType>,
    ) -> Option<TraceContext> {
        TraceContext::from_optional(correlation_id, parent_span_id, session_id, agent_type)
    }

    pub(crate) fn record_ipc_request(
        &self,
        method: &str,
        context: Option<&TraceContext>,
    ) -> Result<(), String> {
        let Some(context) = context else {
            return Ok(());
        };

        self.record_context_event(
            context,
            "ipc",
            "ipc.request",
            None,
            trace_attributes([("method", method.to_string())]),
        )
    }

    pub(crate) fn record_ipc_result(
        &self,
        method: &str,
        context: Option<&TraceContext>,
        ok: bool,
    ) -> Result<(), String> {
        let Some(context) = context else {
            return Ok(());
        };

        self.record_context_event(
            context,
            "ipc",
            "ipc.result",
            Some(if ok { "ok" } else { "error" }),
            trace_attributes([("method", method.to_string())]),
        )
    }

    pub(crate) fn record_backend_work(
        &self,
        context: Option<&TraceContext>,
        operation: &str,
        status: &'static str,
        extra_attributes: BTreeMap<String, String>,
    ) -> Result<(), String> {
        let Some(context) = context else {
            return Ok(());
        };

        let attributes = trace_attributes([("operation", operation.to_string())])
            .into_iter()
            .chain(redact_attributes(extra_attributes))
            .collect();

        self.record_context_event(context, "backend", "backend.work", Some(status), attributes)
    }

    pub(crate) fn remember_session_context(&self, session_id: &str, context: TraceContext) {
        let Ok(mut state) = self.inner.state.lock() else {
            return;
        };

        if !state.enabled {
            return;
        }

        state.prune_expired_contexts();
        state.session_contexts.insert(
            session_id.to_string(),
            StoredTraceContext {
                context,
                recorded_at: Instant::now(),
            },
        );
    }

    fn record_agent_event(&self, event: &str, payload: &Value) -> Result<(), String> {
        let Some(session_id) = extract_session_id(payload) else {
            return Ok(());
        };

        if event != "agent-session-title" {
            return Ok(());
        }

        let (store, maybe_stored) = {
            let mut state = self
                .inner
                .state
                .lock()
                .map_err(|err| format!("trace state lock poisoned: {err}"))?;

            if !state.enabled {
                return Ok(());
            }

            state.prune_expired_contexts();
            let stored = state.session_contexts.get(session_id).cloned();
            (state.store.clone(), stored)
        };

        let Some(stored) = maybe_stored else {
            return Ok(());
        };

        let record = TraceRecord {
            schema_version: SCHEMA_VERSION,
            timestamp: timestamp(),
            correlation_id: stored.context.correlation_id,
            span_id: self.next_span_id(),
            parent_span_id: stored.context.parent_span_id,
            layer: "agent",
            event: "agent.event".to_string(),
            session_id: Some(session_id.to_string()),
            agent_type: stored.context.agent_type.map(agent_type_label),
            status: None,
            attributes: agent_event_attributes(event, payload),
        };

        store
            .append(&record)
            .map_err(|err| format!("trace append: {err}"))?;

        let mut state = self
            .inner
            .state
            .lock()
            .map_err(|err| format!("trace state lock poisoned: {err}"))?;
        state.session_contexts.remove(session_id);

        Ok(())
    }

    fn record_context_event(
        &self,
        context: &TraceContext,
        layer: &'static str,
        event: &str,
        status: Option<&'static str>,
        attributes: BTreeMap<String, String>,
    ) -> Result<(), String> {
        let store = {
            let state = self
                .inner
                .state
                .lock()
                .map_err(|err| format!("trace state lock poisoned: {err}"))?;

            if !state.enabled {
                return Ok(());
            }

            state.store.clone()
        };

        let record = TraceRecord {
            schema_version: SCHEMA_VERSION,
            timestamp: timestamp(),
            correlation_id: context.correlation_id.clone(),
            span_id: self.next_span_id(),
            parent_span_id: context.parent_span_id.clone(),
            layer,
            event: event.to_string(),
            session_id: context.session_id.clone(),
            agent_type: context.agent_type.map(agent_type_label),
            status,
            attributes,
        };

        store
            .append(&record)
            .map_err(|err| format!("trace append: {err}"))
    }

    fn next_span_id(&self) -> String {
        let counter = self.inner.next_span_id.fetch_add(1, Ordering::Relaxed);
        format!("vf_span_{}_{}", Utc::now().timestamp_millis(), counter)
    }
}

impl EventSink for TracingEventSink {
    fn emit_json(&self, event: &str, payload: Value) -> Result<(), String> {
        if !event.starts_with("agent-") {
            return self.inner.emit_json(event, payload);
        }

        if !self.tracing.is_enabled() {
            return self.inner.emit_json(event, payload);
        }

        let trace_payload = payload.clone();
        let result = self.inner.emit_json(event, payload);

        if let Err(err) = self.tracing.record_agent_event(event, &trace_payload) {
            log::warn!("failed to write agent trace event: {err}");
        }

        result
    }
}

fn trace_log_path_from_app_data(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("logs").join(TRACE_LOG_NAME)
}

#[cfg(test)]
#[derive(Debug, Clone, Copy)]
enum SupportedTraceOs {
    Linux,
    Macos,
}

#[cfg(test)]
fn default_log_dir_for_home(home: &Path, os: SupportedTraceOs) -> PathBuf {
    match os {
        SupportedTraceOs::Linux => home
            .join(".local")
            .join("share")
            .join("vimeflow")
            .join("logs"),
        SupportedTraceOs::Macos => home
            .join("Library")
            .join("Application Support")
            .join("vimeflow")
            .join("logs"),
    }
}

fn rotated_path(path: &Path, generation: usize) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(TRACE_LOG_NAME);
    path.with_file_name(format!("{file_name}.{generation}"))
}

fn remove_if_exists(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err),
    }
}

fn validate_trace_id(value: &str, field: &str) -> Result<(), String> {
    if is_valid_trace_id(value) {
        return Ok(());
    }

    Err(format!(
        "{field} must be 1-{MAX_TRACE_ID_BYTES} chars of [A-Za-z0-9_-]"
    ))
}

fn is_valid_trace_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_TRACE_ID_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn validate_session_id(value: &str, field: &str) -> Result<(), String> {
    if is_valid_session_id(value) {
        return Ok(());
    }

    Err(format!(
        "{field} must be 1-{MAX_SESSION_ID_BYTES} chars of [A-Za-z0-9_-]"
    ))
}

fn is_valid_session_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_SESSION_ID_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn validate_event_name(event: &str) -> Result<(), String> {
    if event.is_empty() || event.len() > MAX_EVENT_NAME_BYTES {
        return Err(format!("event must be 1-{MAX_EVENT_NAME_BYTES} bytes"));
    }

    if event
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b':'))
    {
        return Ok(());
    }

    Err("event contains unsupported characters".to_string())
}

fn allowed_frontend_session_id(
    event: &str,
    session_id: Option<&str>,
) -> Result<Option<String>, String> {
    let Some(session_id) = session_id else {
        return Ok(None);
    };

    match event {
        "pane.rename" => {
            validate_session_id(session_id, "sessionId")?;
            Ok(Some(session_id.to_string()))
        }
        _ => Ok(None),
    }
}

fn frontend_interaction_attributes(
    event: &str,
    attributes: &BTreeMap<String, String>,
) -> Result<BTreeMap<String, String>, String> {
    match event {
        "pane.rename" => {
            let mut safe_attributes = trace_attributes([("interaction", "pane.rename")]);

            if let Some(title_length) = allowed_title_length(attributes.get("titleLength")) {
                safe_attributes.extend(trace_attributes([("titleLength", title_length)]));
            }

            Ok(safe_attributes)
        }
        _ => Err(format!("unsupported trace interaction event: {event}")),
    }
}

fn allowed_title_length(value: Option<&String>) -> Option<String> {
    value?
        .parse::<u16>()
        .ok()
        .map(|title_length| title_length.to_string())
}

fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn string_field(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
}

fn extract_session_id(payload: &Value) -> Option<&str> {
    payload
        .get("sessionId")
        .and_then(Value::as_str)
        .or_else(|| payload.get("session_id").and_then(Value::as_str))
        .filter(|value| !value.is_empty())
}

fn parse_agent_type(value: &str) -> Option<AgentType> {
    match value {
        "claudeCode" | "claude-code" => Some(AgentType::ClaudeCode),
        "codex" => Some(AgentType::Codex),
        "aider" => Some(AgentType::Aider),
        "generic" => Some(AgentType::Generic),
        _ => None,
    }
}

fn agent_type_label(agent_type: AgentType) -> &'static str {
    match agent_type {
        AgentType::ClaudeCode => "claudeCode",
        AgentType::Codex => "codex",
        AgentType::Aider => "aider",
        AgentType::Generic => "generic",
    }
}

fn trace_attributes<I, K, V>(entries: I) -> BTreeMap<String, String>
where
    I: IntoIterator<Item = (K, V)>,
    K: Into<String>,
    V: Into<String>,
{
    redact_attributes(
        entries
            .into_iter()
            .map(|(key, value)| (key.into(), value.into()))
            .collect(),
    )
}

fn redact_attributes(attributes: BTreeMap<String, String>) -> BTreeMap<String, String> {
    attributes
        .into_iter()
        .take(MAX_ATTRIBUTES)
        .filter_map(|(key, value)| {
            let key = sanitize_key(&key)?;
            let value = if is_secret_key(&key) {
                REDACTED.to_string()
            } else {
                sanitize_value(&value)
            };
            Some((key, value))
        })
        .collect()
}

fn sanitize_key(key: &str) -> Option<String> {
    let sanitized = key
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.'))
        .take(MAX_ATTRIBUTE_KEY_BYTES)
        .collect::<String>();

    if sanitized.is_empty() {
        return None;
    }

    Some(sanitized)
}

fn sanitize_value(value: &str) -> String {
    let escaped = value.replace('\n', "\\n").replace('\r', "\\r");
    let redacted = SECRET_VALUE_RE.replace_all(&escaped, REDACTED);
    redacted.chars().take(MAX_ATTRIBUTE_VALUE_CHARS).collect()
}

fn is_secret_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase().replace(['-', '.'], "_");
    normalized.contains("token")
        || normalized.contains("password")
        || normalized.contains("secret")
        || normalized.contains("api_key")
        || normalized.contains("apikey")
        || normalized.contains("authorization")
        || normalized == "auth"
        || normalized.contains("cookie")
}

fn agent_event_attributes(event: &str, payload: &Value) -> BTreeMap<String, String> {
    let mut attributes = trace_attributes([("agentEvent", event.to_string())]);

    match event {
        "agent-session-title" => {
            if let Some(source) = payload.get("source").and_then(Value::as_str) {
                attributes.extend(trace_attributes([("source", source.to_string())]));
            }
            if let Some(title) = payload.get("title").and_then(Value::as_str) {
                attributes.extend(trace_attributes([(
                    "titleLength",
                    title.chars().count().to_string(),
                )]));
            }
        }
        "agent-tool-call" => {
            if let Some(tool) = payload.get("tool").and_then(Value::as_str) {
                attributes.extend(trace_attributes([("tool", tool.to_string())]));
            }
            if let Some(status) = payload.get("status").and_then(Value::as_str) {
                attributes.extend(trace_attributes([("toolStatus", status.to_string())]));
            }
            if let Some(is_test_file) = payload.get("isTestFile").and_then(Value::as_bool) {
                attributes.extend(trace_attributes([("isTestFile", is_test_file.to_string())]));
            }
        }
        "agent-turn" => {
            if let Some(num_turns) = payload.get("numTurns").and_then(Value::as_u64) {
                attributes.extend(trace_attributes([("numTurns", num_turns.to_string())]));
            }
        }
        "agent-cwd" => {
            if let Some(cwd) = payload.get("cwd").and_then(Value::as_str) {
                attributes.extend(trace_attributes([("cwdBasename", path_basename(cwd))]));
            }
        }
        "agent-status" => {
            if let Some(model) = payload.get("modelDisplayName").and_then(Value::as_str) {
                attributes.extend(trace_attributes([("modelDisplayName", model.to_string())]));
            }
        }
        _ => {}
    }

    attributes
}

fn path_basename(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("[root]")
        .to_string()
}

#[cfg(test)]
mod tests;

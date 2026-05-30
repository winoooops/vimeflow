//! Codex `session_index.jsonl` watcher.
//!
//! Spawned by `base::watcher_runtime::start_watching` for live Codex sessions
//! whose locator surfaced an `agent_session_id`. Polls
//! `<codex_home>/session_index.jsonl` for changes, emits
//! `agent-session-title` events as `thread_name` updates land, and reconciles
//! AI-generated thread names with pending `/rename` claims recorded via
//! `record_user_rename` from the rename IPC. The watcher's lifetime is bound
//! 1:1 to the `WatcherHandle` (Drop signals stop + joins the thread). PR
//! #302 codex review F5 re-wired this path after the agent-adapter refactor
//! initially dropped the production caller.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use once_cell::sync::Lazy;

use crate::agent::events::emit_agent_session_title;
use crate::agent::sanitize_title;
use crate::agent::types::{AgentSessionTitleEvent, TitleSource};
use crate::runtime::EventSink;

const POLL_INTERVAL: Duration = Duration::from_millis(500);
const INTERRUPT_SLICES: u32 = 5;
const PENDING_RENAME_TTL: Duration = Duration::from_secs(30);

struct PendingRename {
    id: u64,
    session_id: String,
    title: String,
    expires_at: Instant,
    claimed: bool,
}

static PENDING_RENAMES: Lazy<Mutex<Vec<PendingRename>>> = Lazy::new(|| Mutex::new(Vec::new()));
static NEXT_PENDING_RENAME_ID: AtomicU64 = AtomicU64::new(1);

pub(crate) fn record_user_rename(session_id: &str, title: &str) {
    let Ok(mut pending) = PENDING_RENAMES.lock() else {
        log::warn!("codex title sync: pending rename lock poisoned");
        return;
    };

    let session_id = session_id.to_string();
    pending.retain(|rename| rename.session_id != session_id);
    pending.push(PendingRename {
        id: NEXT_PENDING_RENAME_ID.fetch_add(1, Ordering::Relaxed),
        session_id,
        title: title.to_string(),
        expires_at: Instant::now() + PENDING_RENAME_TTL,
        claimed: false,
    });
}

pub fn spawn_watch(
    path: PathBuf,
    agent_session_id: String,
    session_id: String,
    events: Arc<dyn EventSink>,
    stop: Arc<AtomicBool>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut last_emitted_title: Option<String> = None;
        let mut last_mtime = modified_time(&path);

        if let Some(title) = read_thread_name(&path, &agent_session_id) {
            try_emit(
                &events,
                &session_id,
                &agent_session_id,
                &title,
                &mut last_emitted_title,
            );
        }

        loop {
            if stop.load(Ordering::Acquire) {
                break;
            }
            for _ in 0..INTERRUPT_SLICES {
                if stop.load(Ordering::Acquire) {
                    break;
                }
                std::thread::sleep(POLL_INTERVAL / INTERRUPT_SLICES);
            }
            if stop.load(Ordering::Acquire) {
                break;
            }

            let current_mtime = modified_time(&path);
            if current_mtime == last_mtime {
                continue;
            }
            last_mtime = current_mtime;

            match read_thread_name(&path, &agent_session_id) {
                Some(title) => {
                    try_emit(
                        &events,
                        &session_id,
                        &agent_session_id,
                        &title,
                        &mut last_emitted_title,
                    );
                }
                None if last_emitted_title.is_some() => {
                    try_emit(
                        &events,
                        &session_id,
                        &agent_session_id,
                        "",
                        &mut last_emitted_title,
                    );
                }
                None => {}
            }
        }
    })
}

fn modified_time(path: &std::path::Path) -> Option<SystemTime> {
    std::fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
}

fn read_thread_name(path: &std::path::Path, agent_session_id: &str) -> Option<String> {
    let contents = std::fs::read_to_string(path).ok()?;
    let mut result: Option<String> = None;

    for line in contents.lines() {
        if line.is_empty() {
            continue;
        }
        let value: serde_json::Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if value.get("id").and_then(serde_json::Value::as_str) == Some(agent_session_id) {
            if let Some(thread_name) = value.get("thread_name").and_then(serde_json::Value::as_str)
            {
                result = Some(thread_name.to_string());
            }
        }
    }

    result
}

fn try_emit(
    events: &Arc<dyn EventSink>,
    session_id: &str,
    agent_session_id: &str,
    raw_title: &str,
    last_emitted_title: &mut Option<String>,
) {
    let sanitized = sanitize_title(raw_title);
    let pending_rename_claim = sanitized
        .as_deref()
        .and_then(|title| claim_pending_user_rename(session_id, title));
    let source = if pending_rename_claim.is_some() {
        TitleSource::UserRenamed
    } else {
        TitleSource::AiGenerated
    };
    let is_user_renamed = pending_rename_claim.is_some();
    let is_duplicate = sanitized.as_deref() == last_emitted_title.as_deref();
    let (title, new_memo) = match sanitized {
        Some(_) if is_duplicate && !is_user_renamed => return,
        Some(title) => (title.clone(), Some(title)),
        None if last_emitted_title.is_some() => (String::new(), None),
        None => return,
    };

    let payload = AgentSessionTitleEvent {
        session_id: session_id.to_string(),
        agent_session_id: agent_session_id.to_string(),
        title,
        source,
    };

    if let Err(err) = emit_agent_session_title(events.as_ref(), &payload) {
        log::warn!("agent-session-title emit failed: {}", err);
        if let Some(claim_id) = pending_rename_claim {
            release_pending_user_rename(claim_id);
        }
        return;
    }

    if let Some(claim_id) = pending_rename_claim {
        consume_pending_user_rename(claim_id);
    }
    *last_emitted_title = new_memo;
}

fn claim_pending_user_rename(session_id: &str, title: &str) -> Option<u64> {
    let Ok(mut pending) = PENDING_RENAMES.lock() else {
        log::warn!("codex title sync: pending rename lock poisoned");
        return None;
    };

    let now = Instant::now();
    pending.retain(|rename| rename.expires_at > now);

    let rename = pending.iter().position(|rename| {
        !rename.claimed && rename.session_id == session_id && rename.title == title
    })?;
    pending[rename].claimed = true;

    Some(pending[rename].id)
}

fn release_pending_user_rename(claim_id: u64) {
    let Ok(mut pending) = PENDING_RENAMES.lock() else {
        log::warn!("codex title sync: pending rename lock poisoned");
        return;
    };

    let now = Instant::now();
    pending.retain(|rename| rename.expires_at > now);

    if let Some(rename) = pending.iter_mut().find(|rename| rename.id == claim_id) {
        rename.claimed = false;
    }
}

fn consume_pending_user_rename(claim_id: u64) {
    let Ok(mut pending) = PENDING_RENAMES.lock() else {
        log::warn!("codex title sync: pending rename lock poisoned");
        return;
    };

    let now = Instant::now();
    pending.retain(|rename| rename.expires_at > now);

    if let Some(index) = pending.iter().position(|rename| rename.id == claim_id) {
        pending.remove(index);
    }
}

#[cfg(test)]
pub(crate) fn clear_pending_renames_for_test() {
    PENDING_RENAMES.lock().expect("pending rename lock").clear();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::events::AGENT_SESSION_TITLE;
    use crate::runtime::FakeEventSink;
    use serde_json::Value;
    use std::io::Write;
    use std::sync::atomic::Ordering;
    use std::time::Duration;
    use tempfile::TempDir;

    static PENDING_RENAME_TEST_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    struct FailingEventSink;

    impl EventSink for FailingEventSink {
        fn emit_json(&self, _event: &str, _payload: Value) -> Result<(), String> {
            Err("emit failed".to_string())
        }
    }

    fn pending_rename_test_guard() -> std::sync::MutexGuard<'static, ()> {
        // Keep tests that mutate the module-level pending registry isolated.
        PENDING_RENAME_TEST_LOCK
            .lock()
            .expect("pending rename test lock")
    }

    fn write_index(dir: &TempDir, rows: &[(&str, &str)]) -> PathBuf {
        let path = dir.path().join("session_index.jsonl");
        let mut file = std::fs::File::create(&path).expect("create index");
        for (id, name) in rows {
            writeln!(
                file,
                r#"{{"id":"{id}","thread_name":"{name}","updated_at":"2026-05-23T00:00:00Z"}}"#
            )
            .expect("write row");
        }
        file.sync_all().expect("sync index");
        path
    }

    fn title_payloads(sink: &Arc<FakeEventSink>) -> Vec<serde_json::Value> {
        sink.recorded()
            .into_iter()
            .filter(|(name, _)| name == AGENT_SESSION_TITLE)
            .map(|(_, payload)| payload)
            .collect()
    }

    #[test]
    fn initial_read_emits_matching_row_without_shutdown_clear() {
        let _guard = pending_rename_test_guard();
        clear_pending_renames_for_test();
        let dir = TempDir::new().expect("tempdir");
        let path = write_index(&dir, &[("abc-uuid", "MyTask")]);
        let sink: Arc<FakeEventSink> = Arc::new(FakeEventSink::new());
        let sink_dyn: Arc<dyn EventSink> = sink.clone();
        let stop = Arc::new(AtomicBool::new(true));
        let handle = spawn_watch(path, "abc-uuid".into(), "pty-1".into(), sink_dyn, stop);

        handle.join().expect("join watcher");

        let titles = title_payloads(&sink);
        assert_eq!(titles.len(), 1);
        assert_eq!(titles[0]["title"], "MyTask");
        assert_eq!(titles[0]["source"], "ai-generated");
        assert_eq!(titles[0]["sessionId"], "pty-1");
    }

    #[test]
    fn pending_user_rename_marks_matching_title_once() {
        let _guard = pending_rename_test_guard();
        clear_pending_renames_for_test();
        let dir = TempDir::new().expect("tempdir");
        let path = write_index(&dir, &[("abc-uuid", "MyTask")]);
        let sink: Arc<FakeEventSink> = Arc::new(FakeEventSink::new());
        let sink_dyn: Arc<dyn EventSink> = sink.clone();
        let stop = Arc::new(AtomicBool::new(true));

        record_user_rename("pty-1", "MyTask");
        let handle = spawn_watch(
            path.clone(),
            "abc-uuid".into(),
            "pty-1".into(),
            sink_dyn,
            stop,
        );

        handle.join().expect("join watcher");

        let titles = title_payloads(&sink);
        assert_eq!(titles[0]["title"], "MyTask");
        assert_eq!(titles[0]["source"], "user-renamed");

        let second_sink: Arc<FakeEventSink> = Arc::new(FakeEventSink::new());
        let second_sink_dyn: Arc<dyn EventSink> = second_sink.clone();
        let second_stop = Arc::new(AtomicBool::new(true));
        let second_handle = spawn_watch(
            path,
            "abc-uuid".into(),
            "pty-1".into(),
            second_sink_dyn,
            second_stop,
        );

        second_handle.join().expect("join watcher");

        let second_titles = title_payloads(&second_sink);
        assert_eq!(second_titles[0]["title"], "MyTask");
        assert_eq!(second_titles[0]["source"], "ai-generated");
    }

    #[test]
    fn pending_user_rename_bypasses_duplicate_title_dedup() {
        let _guard = pending_rename_test_guard();
        clear_pending_renames_for_test();
        let sink: Arc<FakeEventSink> = Arc::new(FakeEventSink::new());
        let sink_dyn: Arc<dyn EventSink> = sink.clone();
        let mut last_emitted_title = Some("MyTask".to_string());

        record_user_rename("pty-1", "MyTask");
        try_emit(
            &sink_dyn,
            "pty-1",
            "abc-uuid",
            "MyTask",
            &mut last_emitted_title,
        );
        try_emit(
            &sink_dyn,
            "pty-1",
            "abc-uuid",
            "MyTask",
            &mut last_emitted_title,
        );

        let titles = title_payloads(&sink);
        assert_eq!(titles.len(), 1);
        assert_eq!(titles[0]["title"], "MyTask");
        assert_eq!(titles[0]["source"], "user-renamed");
    }

    #[test]
    fn pending_user_rename_claim_is_atomic_until_released() {
        let _guard = pending_rename_test_guard();
        clear_pending_renames_for_test();

        record_user_rename("pty-1", "MyTask");
        let claim_id =
            claim_pending_user_rename("pty-1", "MyTask").expect("first claim should succeed");

        assert_eq!(claim_pending_user_rename("pty-1", "MyTask"), None);

        release_pending_user_rename(claim_id);

        assert!(claim_pending_user_rename("pty-1", "MyTask").is_some());
    }

    #[test]
    fn pending_user_rename_survives_emit_failure() {
        let _guard = pending_rename_test_guard();
        clear_pending_renames_for_test();
        let failing_sink: Arc<dyn EventSink> = Arc::new(FailingEventSink);
        let sink: Arc<FakeEventSink> = Arc::new(FakeEventSink::new());
        let sink_dyn: Arc<dyn EventSink> = sink.clone();
        let mut last_emitted_title = None;

        record_user_rename("pty-1", "MyTask");
        try_emit(
            &failing_sink,
            "pty-1",
            "abc-uuid",
            "MyTask",
            &mut last_emitted_title,
        );
        try_emit(
            &sink_dyn,
            "pty-1",
            "abc-uuid",
            "MyTask",
            &mut last_emitted_title,
        );

        let titles = title_payloads(&sink);
        assert_eq!(titles.len(), 1);
        assert_eq!(titles[0]["title"], "MyTask");
        assert_eq!(titles[0]["source"], "user-renamed");
    }

    #[test]
    fn missing_row_does_not_emit() {
        let dir = TempDir::new().expect("tempdir");
        let path = write_index(&dir, &[("other-uuid", "OtherTask")]);
        let sink: Arc<FakeEventSink> = Arc::new(FakeEventSink::new());
        let sink_dyn: Arc<dyn EventSink> = sink.clone();
        let stop = Arc::new(AtomicBool::new(true));
        let handle = spawn_watch(path, "abc-uuid".into(), "pty-1".into(), sink_dyn, stop);

        handle.join().expect("join watcher");

        assert_eq!(title_payloads(&sink).len(), 0);
    }

    #[test]
    fn last_write_wins_on_duplicate_ids() {
        let dir = TempDir::new().expect("tempdir");
        let path = write_index(&dir, &[("abc-uuid", "first"), ("abc-uuid", "second")]);
        let sink: Arc<FakeEventSink> = Arc::new(FakeEventSink::new());
        let sink_dyn: Arc<dyn EventSink> = sink.clone();
        let stop = Arc::new(AtomicBool::new(true));
        let handle = spawn_watch(path, "abc-uuid".into(), "pty-1".into(), sink_dyn, stop);

        handle.join().expect("join watcher");

        let titles = title_payloads(&sink);
        assert_eq!(titles.len(), 1);
        assert_eq!(titles[0]["title"], "second");
    }

    #[test]
    fn matching_row_without_thread_name_does_not_clear_previous_title() {
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("session_index.jsonl");
        std::fs::write(
            &path,
            concat!(
                r#"{"id":"abc-uuid","thread_name":"first","updated_at":"2026-05-23T00:00:00Z"}"#,
                "\n",
                r#"{"id":"abc-uuid","updated_at":"2026-05-23T00:00:01Z"}"#,
                "\n"
            ),
        )
        .expect("write index");
        let sink: Arc<FakeEventSink> = Arc::new(FakeEventSink::new());
        let sink_dyn: Arc<dyn EventSink> = sink.clone();
        let stop = Arc::new(AtomicBool::new(true));
        let handle = spawn_watch(path, "abc-uuid".into(), "pty-1".into(), sink_dyn, stop);

        handle.join().expect("join watcher");

        let titles = title_payloads(&sink);
        assert_eq!(titles.len(), 1);
        assert_eq!(titles[0]["title"], "first");
    }

    #[test]
    fn malformed_line_is_skipped() {
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("session_index.jsonl");
        std::fs::write(&path, "not-json\n").expect("write malformed index");
        let sink: Arc<FakeEventSink> = Arc::new(FakeEventSink::new());
        let sink_dyn: Arc<dyn EventSink> = sink.clone();
        let stop = Arc::new(AtomicBool::new(true));
        let handle = spawn_watch(path, "abc-uuid".into(), "pty-1".into(), sink_dyn, stop);

        handle.join().expect("join watcher");

        assert_eq!(title_payloads(&sink).len(), 0);
    }

    #[test]
    fn missing_file_does_not_panic() {
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("nonexistent.jsonl");
        let sink: Arc<FakeEventSink> = Arc::new(FakeEventSink::new());
        let sink_dyn: Arc<dyn EventSink> = sink.clone();
        let stop = Arc::new(AtomicBool::new(true));
        let handle = spawn_watch(path, "abc-uuid".into(), "pty-1".into(), sink_dyn, stop);

        handle.join().expect("join watcher");

        assert_eq!(title_payloads(&sink).len(), 0);
    }

    #[test]
    fn mtime_change_picks_up_new_thread_name() {
        let dir = TempDir::new().expect("tempdir");
        let path = write_index(&dir, &[("abc-uuid", "first")]);
        let sink: Arc<FakeEventSink> = Arc::new(FakeEventSink::new());
        let sink_dyn: Arc<dyn EventSink> = sink.clone();
        let stop = Arc::new(AtomicBool::new(false));
        let handle = spawn_watch(
            path.clone(),
            "abc-uuid".into(),
            "pty-1".into(),
            sink_dyn,
            Arc::clone(&stop),
        );

        std::thread::sleep(Duration::from_millis(50));
        std::thread::sleep(Duration::from_millis(1100));
        std::fs::write(
            &path,
            r#"{"id":"abc-uuid","thread_name":"second","updated_at":"2026-05-23T00:00:01Z"}"#,
        )
        .expect("rewrite index");
        std::thread::sleep(Duration::from_millis(700));
        stop.store(true, Ordering::Release);
        handle.join().expect("join watcher");

        let titles = title_payloads(&sink);
        assert!(titles.iter().any(|payload| payload["title"] == "first"));
        assert!(titles.iter().any(|payload| payload["title"] == "second"));
        assert!(!titles.iter().any(|payload| payload["title"] == ""));
    }
}

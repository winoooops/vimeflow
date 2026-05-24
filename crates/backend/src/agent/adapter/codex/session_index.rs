//! Codex `session_index.jsonl` watcher.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use crate::agent::events::emit_agent_session_title;
use crate::agent::sanitize_title;
use crate::agent::types::{AgentSessionTitleEvent, TitleSource};
use crate::runtime::EventSink;

const POLL_INTERVAL: Duration = Duration::from_millis(500);
const INTERRUPT_SLICES: u32 = 5;

pub fn spawn_watch(
    path: PathBuf,
    agent_session_id: String,
    session_id: String,
    events: Arc<dyn EventSink>,
    stop: Arc<AtomicBool>,
) -> std::io::Result<std::thread::JoinHandle<()>> {
    Ok(std::thread::spawn(move || {
        let mut last_emitted_title: Option<String> = None;

        if let Some(title) = read_thread_name(&path, &agent_session_id) {
            try_emit(
                &events,
                &session_id,
                &agent_session_id,
                &title,
                &mut last_emitted_title,
            );
        }
        let mut last_mtime = modified_time(&path);

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

        if last_emitted_title.is_some() {
            try_emit(
                &events,
                &session_id,
                &agent_session_id,
                "",
                &mut last_emitted_title,
            );
        }
    }))
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
            result = value
                .get("thread_name")
                .and_then(serde_json::Value::as_str)
                .map(str::to_string);
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
    let (title, new_memo) = match sanitized {
        Some(title) if last_emitted_title.as_deref() == Some(title.as_str()) => return,
        Some(title) => (title.clone(), Some(title)),
        None if last_emitted_title.is_some() => (String::new(), None),
        None => return,
    };

    let payload = AgentSessionTitleEvent {
        session_id: session_id.to_string(),
        agent_session_id: agent_session_id.to_string(),
        title,
        // Codex currently exposes `thread_name` as the persisted `/rename`
        // value and does not include provenance for generated titles. If that
        // changes, this watcher should mirror Claude's source split.
        source: TitleSource::UserRenamed,
    };

    if let Err(err) = emit_agent_session_title(events.as_ref(), &payload) {
        log::warn!("agent-session-title emit failed: {}", err);
        return;
    }

    *last_emitted_title = new_memo;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::events::AGENT_SESSION_TITLE;
    use crate::runtime::FakeEventSink;
    use std::io::Write;
    use std::sync::atomic::Ordering;
    use std::time::Duration;
    use tempfile::TempDir;

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
    fn initial_read_emits_matching_row_then_clear_on_shutdown() {
        let dir = TempDir::new().expect("tempdir");
        let path = write_index(&dir, &[("abc-uuid", "MyTask")]);
        let sink: Arc<FakeEventSink> = Arc::new(FakeEventSink::new());
        let sink_dyn: Arc<dyn EventSink> = sink.clone();
        let stop = Arc::new(AtomicBool::new(true));
        let handle = spawn_watch(path, "abc-uuid".into(), "pty-1".into(), sink_dyn, stop)
            .expect("spawn watcher");

        handle.join().expect("join watcher");

        let titles = title_payloads(&sink);
        assert_eq!(titles.len(), 2);
        assert_eq!(titles[0]["title"], "MyTask");
        assert_eq!(titles[0]["source"], "user-renamed");
        assert_eq!(titles[0]["sessionId"], "pty-1");
        assert_eq!(titles[1]["title"], "");
    }

    #[test]
    fn missing_row_does_not_emit() {
        let dir = TempDir::new().expect("tempdir");
        let path = write_index(&dir, &[("other-uuid", "OtherTask")]);
        let sink: Arc<FakeEventSink> = Arc::new(FakeEventSink::new());
        let sink_dyn: Arc<dyn EventSink> = sink.clone();
        let stop = Arc::new(AtomicBool::new(true));
        let handle = spawn_watch(path, "abc-uuid".into(), "pty-1".into(), sink_dyn, stop)
            .expect("spawn watcher");

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
        let handle = spawn_watch(path, "abc-uuid".into(), "pty-1".into(), sink_dyn, stop)
            .expect("spawn watcher");

        handle.join().expect("join watcher");

        let titles = title_payloads(&sink);
        assert_eq!(titles.len(), 2);
        assert_eq!(titles[0]["title"], "second");
        assert_eq!(titles[1]["title"], "");
    }

    #[test]
    fn malformed_line_is_skipped() {
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("session_index.jsonl");
        std::fs::write(&path, "not-json\n").expect("write malformed index");
        let sink: Arc<FakeEventSink> = Arc::new(FakeEventSink::new());
        let sink_dyn: Arc<dyn EventSink> = sink.clone();
        let stop = Arc::new(AtomicBool::new(true));
        let handle = spawn_watch(path, "abc-uuid".into(), "pty-1".into(), sink_dyn, stop)
            .expect("spawn watcher");

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
        let handle = spawn_watch(path, "abc-uuid".into(), "pty-1".into(), sink_dyn, stop)
            .expect("spawn watcher");

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
        )
        .expect("spawn watcher");

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
        assert!(titles.iter().any(|payload| payload["title"] == ""));
    }
}

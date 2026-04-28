//! Replay-aware emitter for test-run events. During the initial replay phase
//! of a tail_loop, `submit` keeps only the latest snapshot — when the loop
//! hits EOF for the first time and calls `finish_replay`, the latest pending
//! snapshot (if any) is emitted exactly once. After replay, every submit
//! emits immediately.

use tauri::{AppHandle, Emitter, Runtime};

use super::types::TestRunSnapshot;

pub struct TestRunEmitter<R: Runtime> {
    app_handle: AppHandle<R>,
    replay_done: bool,
    pending: Option<TestRunSnapshot>,
}

impl<R: Runtime> TestRunEmitter<R> {
    pub fn new(app_handle: AppHandle<R>) -> Self {
        Self {
            app_handle,
            replay_done: false,
            pending: None,
        }
    }

    pub fn submit(&mut self, snapshot: TestRunSnapshot) {
        if self.replay_done {
            if let Err(e) = self.app_handle.emit("test-run", &snapshot) {
                log::warn!("Failed to emit test-run event: {}", e);
            }
        } else {
            self.pending = Some(snapshot);
        }
    }

    pub fn finish_replay(&mut self) {
        if self.replay_done {
            return;
        }
        self.replay_done = true;
        if let Some(s) = self.pending.take() {
            if let Err(e) = self.app_handle.emit("test-run", &s) {
                log::warn!("Failed to emit test-run event: {}", e);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::test_runners::types::{TestRunStatus, TestRunSummary};
    use std::sync::{Arc, Mutex};
    use tauri::test::{mock_builder, MockRuntime};
    use tauri::Listener;

    fn snap(passed: u32) -> TestRunSnapshot {
        TestRunSnapshot {
            session_id: "s".to_string(),
            runner: "vitest".to_string(),
            command_preview: "vitest".to_string(),
            started_at: "2026-04-28T12:00:00Z".to_string(),
            finished_at: "2026-04-28T12:00:01Z".to_string(),
            duration_ms: 1000,
            status: TestRunStatus::Pass,
            summary: TestRunSummary {
                passed,
                failed: 0,
                skipped: 0,
                total: passed,
                groups: vec![],
            },
            output_excerpt: None,
        }
    }

    fn collect_emits(app: &tauri::App<MockRuntime>) -> Arc<Mutex<Vec<String>>> {
        let received = Arc::new(Mutex::new(Vec::new()));
        let clone = received.clone();
        app.handle().listen("test-run", move |event| {
            clone.lock().unwrap().push(event.payload().to_string());
        });
        received
    }

    #[test]
    fn submit_during_replay_buffers_latest() {
        let app = mock_builder().build(tauri::generate_context!()).unwrap();
        let emits = collect_emits(&app);
        let mut e = TestRunEmitter::new(app.handle().clone());
        e.submit(snap(1));
        e.submit(snap(2));
        e.submit(snap(3));
        std::thread::sleep(std::time::Duration::from_millis(100));
        assert!(emits.lock().unwrap().is_empty());
        e.finish_replay();
        std::thread::sleep(std::time::Duration::from_millis(100));
        let v = emits.lock().unwrap();
        assert_eq!(v.len(), 1);
        assert!(v[0].contains(r#""passed":3"#));
    }

    #[test]
    fn submit_after_replay_emits_immediately() {
        let app = mock_builder().build(tauri::generate_context!()).unwrap();
        let emits = collect_emits(&app);
        let mut e = TestRunEmitter::new(app.handle().clone());
        e.finish_replay();
        e.submit(snap(7));
        std::thread::sleep(std::time::Duration::from_millis(100));
        assert_eq!(emits.lock().unwrap().len(), 1);
    }

    #[test]
    fn finish_replay_is_idempotent() {
        let app = mock_builder().build(tauri::generate_context!()).unwrap();
        let emits = collect_emits(&app);
        let mut e = TestRunEmitter::new(app.handle().clone());
        e.submit(snap(1));
        e.finish_replay();
        e.finish_replay(); // second call must not re-emit
        std::thread::sleep(std::time::Duration::from_millis(100));
        assert_eq!(emits.lock().unwrap().len(), 1);
    }
}

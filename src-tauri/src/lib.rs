pub mod agent;
mod debug;
mod filesystem;
mod git;
mod terminal;

use agent::{
    detect_agent_in_session, start_agent_watcher, stop_agent_watcher, AgentWatcherState,
    TranscriptState,
};
use filesystem::{list_dir, read_file, write_file};
use git::{get_git_diff, git_status, watcher::{start_git_watcher, stop_git_watcher, GitWatcherState}};
use std::sync::Arc;
use tauri::Manager;
use terminal::{
    cache::SessionCache, kill_pty, list_sessions, reorder_sessions, resize_pty,
    set_active_session, spawn_pty, update_session_cwd, write_pty, PtyState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Initialize session cache in app_data_dir
            let app_data_dir = app.path().app_data_dir().expect("failed to get app_data_dir");
            let cache_path = app_data_dir.join("sessions.json");

            // E2E test mode: wipe the cache on every launch.
            //
            // Production cache persistence is one of the round-7 features —
            // if the app dies non-gracefully (SIGKILL, OOM, panic, host
            // shutdown) the cache still has the session list and lazy
            // reconciliation in `list_sessions` flips them all to Exited
            // so the user lands on a workspace of "Restart" tabs.
            //
            // wdio's `deleteSession()` teardown looks like a non-graceful
            // crash to the runtime — `RunEvent::ExitRequested` never fires,
            // so `cache.clear_all()` below never runs. Each spec inherits
            // the previous spec's session list as Exited stragglers, the
            // round-7 auto-create skips because `sessions.length > 0`, and
            // the test sees a full tab strip with zero live PTY → "PTY
            // never produced a prompt" / "default session never became
            // active" / "closing the spawned tab did not decrement count".
            //
            // The fix: under the `e2e-test` Cargo feature (only enabled by
            // `npm run test:e2e:build` and the CI E2E job), pre-emptively
            // delete the cache file before `SessionCache::load_or_recover`
            // reads it. Production builds are unaffected.
            #[cfg(feature = "e2e-test")]
            {
                if let Err(e) = std::fs::remove_file(&cache_path) {
                    if e.kind() != std::io::ErrorKind::NotFound {
                        log::warn!(
                            "e2e-test: failed to remove cache file {}: {}",
                            cache_path.display(),
                            e
                        );
                    }
                }
            }

            let cache = Arc::new(SessionCache::load_or_recover(cache_path));
            app.manage(cache);

            Ok(())
        })
        .manage(PtyState::new())
        .manage(AgentWatcherState::new())
        .manage(TranscriptState::new())
        .manage(GitWatcherState::new());

    #[cfg(not(feature = "e2e-test"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        spawn_pty,
        write_pty,
        resize_pty,
        kill_pty,
        list_sessions,
        set_active_session,
        reorder_sessions,
        update_session_cwd,
        detect_agent_in_session,
        start_agent_watcher,
        stop_agent_watcher,
        list_dir,
        read_file,
        write_file,
        git_status,
        get_git_diff,
        start_git_watcher,
        stop_git_watcher
    ]);

    #[cfg(feature = "e2e-test")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        spawn_pty,
        write_pty,
        resize_pty,
        kill_pty,
        list_sessions,
        set_active_session,
        reorder_sessions,
        update_session_cwd,
        detect_agent_in_session,
        start_agent_watcher,
        stop_agent_watcher,
        list_dir,
        read_file,
        write_file,
        git_status,
        get_git_diff,
        start_git_watcher,
        stop_git_watcher,
        terminal::test_commands::list_active_pty_sessions
    ]);

    // Build the App so we can intercept the exit event. Equivalent to
    // builder.run(generate_context!()) plus an event handler — needed so we
    // can wipe the SessionCache on graceful exit (Cmd+Q, window-close)
    // before the cache file gets re-read on next launch as a list of
    // ghost-Exited tabs.
    //
    // Process-kill paths (SIGKILL, OOM, panic, sudden power loss) skip
    // this handler — the lazy reconciliation in list_sessions is the
    // correctness safety net for those, by design.
    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            if let Some(cache) =
                app_handle.try_state::<std::sync::Arc<terminal::cache::SessionCache>>()
            {
                if let Err(e) = cache.clear_all() {
                    log::warn!("failed to clear session cache on exit: {e}");
                }
            }
        }
    });
}

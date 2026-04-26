mod agent;
mod filesystem;
mod git;
mod terminal;

use agent::{
    detect_agent_in_session, start_agent_watcher, start_transcript_watcher, stop_agent_watcher,
    stop_transcript_watcher, AgentWatcherState, TranscriptState,
};
use filesystem::{list_dir, read_file, write_file};
use git::{get_git_diff, git_status, watcher::{start_git_watcher, stop_git_watcher, GitWatcherState}};
use std::sync::Arc;
use tauri::Manager;
use terminal::{cache::SessionCache, kill_pty, resize_pty, spawn_pty, write_pty, PtyState};

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
            let cache = SessionCache::load(cache_path)
                .map_err(|e| {
                    log::error!("Failed to load session cache: {}", e);
                    e
                })
                .expect("session cache load failed");
            app.manage(Arc::new(cache));

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
        detect_agent_in_session,
        start_agent_watcher,
        stop_agent_watcher,
        start_transcript_watcher,
        stop_transcript_watcher,
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
        detect_agent_in_session,
        start_agent_watcher,
        stop_agent_watcher,
        start_transcript_watcher,
        stop_transcript_watcher,
        list_dir,
        read_file,
        write_file,
        git_status,
        get_git_diff,
        start_git_watcher,
        stop_git_watcher,
        terminal::test_commands::list_active_pty_sessions
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

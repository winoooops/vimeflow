mod agent;
mod filesystem;
mod git;
mod terminal;

use agent::{
    detect_agent_in_session, start_agent_watcher, start_transcript_watcher, stop_agent_watcher,
    stop_transcript_watcher, AgentWatcherState, TranscriptState,
};
use filesystem::{list_dir, read_file, write_file};
use git::{get_git_diff, git_status};
use terminal::{kill_pty, resize_pty, spawn_pty, write_pty, PtyState};

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
            Ok(())
        })
        .manage(PtyState::new())
        .manage(AgentWatcherState::new())
        .manage(TranscriptState::new());

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
        get_git_diff
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
        terminal::test_commands::list_active_pty_sessions
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

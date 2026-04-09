mod filesystem;
mod terminal;

use filesystem::{list_dir, read_file, write_file};
use terminal::{kill_pty, resize_pty, spawn_pty, write_pty, PtyState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
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
    .invoke_handler(tauri::generate_handler![
      spawn_pty,
      write_pty,
      resize_pty,
      kill_pty,
      list_dir,
      read_file,
      write_file
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

//! `vimeflow-backend` sidecar binary.
//!
//! The Tauri host remains the production runtime through PR-B. This binary is
//! the stdio IPC artifact that Electron will spawn in the later migration PR.

use std::io::Write;
use std::sync::Arc;

use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use vimeflow_lib::runtime::{ipc, BackendState, EventSink};

#[tokio::main(flavor = "multi_thread")]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn"))
        .target(env_logger::Target::Stderr)
        .init();

    let app_data_dir = match parse_app_data_dir() {
        Ok(dir) => dir,
        Err(err) => {
            write_stderr_line(&format!("vimeflow-backend: {err}"));
            std::process::exit(2);
        }
    };

    let (tx, rx) = mpsc::channel::<Vec<u8>>(ipc::STDOUT_QUEUE_CAPACITY);
    let writer_handle = tokio::spawn(ipc::writer_task(rx, tokio::io::stdout()));

    let sink: Arc<dyn EventSink> = Arc::new(ipc::StdoutEventSink::new(tx.clone()));
    let state = Arc::new(BackendState::new(app_data_dir, sink));
    let cancel = CancellationToken::new();

    let run_result = ipc::run(state.clone(), tokio::io::stdin(), tx, cancel.clone()).await;

    if run_result.is_ok() {
        state.shutdown();
    }
    drop(state);

    let _ = tokio::time::timeout(std::time::Duration::from_millis(200), writer_handle).await;

    if let Err(err) = run_result {
        write_stderr_line(&format!(
            "vimeflow-backend: run loop exited with error: {err}"
        ));
        std::process::exit(1);
    }
}

fn write_stderr_line(message: &str) {
    let _ = writeln!(std::io::stderr(), "{message}");
}

fn parse_app_data_dir() -> Result<std::path::PathBuf, String> {
    let mut args = std::env::args().skip(1);
    let mut app_data_dir: Option<std::path::PathBuf> = None;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--app-data-dir" => {
                let value = args
                    .next()
                    .ok_or_else(|| "--app-data-dir requires a path".to_string())?;
                app_data_dir = Some(value.into());
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }

    app_data_dir.ok_or_else(|| "--app-data-dir <path> is required".into())
}

pub mod agent;
pub mod aliases;
mod debug;
mod filesystem;
mod git;
mod review_state;
pub mod runtime;
mod settings;
mod terminal;

// Integration tests exercise the fd-passing transport directly (VIM-399).
#[cfg(unix)]
pub use terminal::fd_transport;

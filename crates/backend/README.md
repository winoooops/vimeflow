# crates/backend - Electron sidecar (Rust)

Long-lived sidecar process spawned by Electron over LSP-framed JSON stdio IPC.
Hosts PTY (`portable-pty`), filesystem, git (status / diff / watch), and agent
observability (Claude Code + Codex adapters).

- `src/bin/vimeflow-backend.rs` - sidecar binary entry point.
- `src/runtime/` - `BackendState`, IPC router, `EventSink` trait.
- `src/{terminal,filesystem,git,agent}/` - feature modules.
- `bindings/` - `ts-rs` generated TypeScript types; regenerate via
  `npm run generate:bindings`.
- `tests/` - integration tests.

This crate is the sole member of the workspace at `./Cargo.toml` (repo root).
The directory was renamed from `src-tauri/` after the May 2026 Electron
migration; see
[`docs/superpowers/retros/2026-05-16-electron-migration.md`](../../docs/superpowers/retros/2026-05-16-electron-migration.md).

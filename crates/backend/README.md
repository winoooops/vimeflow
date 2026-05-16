# src-tauri/ - Electron sidecar backend

> Despite the directory name, this crate contains only the Electron sidecar
> binary. The Tauri runtime was removed in PR-D3, the final PR of the 4-PR
> Electron migration. Renaming `src-tauri/` to `backend/` is tracked as a
> deferred follow-up.

## What's here

- `src/bin/vimeflow-backend.rs` - sidecar entry point. Reads and writes
  LSP-framed JSON over stdio; spawned by `electron/main.ts`.
- `src/runtime/` - runtime-neutral `BackendState`, IPC router, and event sink.
- `src/{terminal,filesystem,git,agent}/` - feature modules for PTY, file ops,
  git status/diff/watch, and agent detection. Each exposes `_inner` helper
  functions consumed by `BackendState` methods.
- `src/bindings/` - `ts-rs` generated TypeScript types. Regenerate via
  `npm run generate:bindings`.
- `tests/` - integration tests, fixtures, and transcript replay.

## What's gone

- `src/main.rs` - Tauri host binary entry.
- `src/lib.rs` `run()` function - the Tauri builder and invoke handler.
- `src/runtime/tauri_bridge.rs` - `TauriEventSink`.
- All `#[tauri::command]` wrapper functions.
- `build.rs`, `tauri.conf.json`, and `capabilities/`.
- The `tauri`, `tauri-plugin-log`, and `tauri-build` Cargo dependencies.

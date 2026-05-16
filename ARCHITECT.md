# Architect

## Architecture Decisions

- **Immutability default** — language rules may override where idiomatic
- **80% test coverage**, TDD (Red-Green-Refactor) mandatory
- **File limits**: 200-400 lines typical, 800 max; functions <50 lines, <4 nesting levels
- **Model routing**: Haiku (lightweight workers), Sonnet (main dev), Opus (deep reasoning)

## Electron + Sidecar IPC Patterns

Post-PR-D3 (2026-05-16), the desktop shell is Electron and the Rust backend runs as a long-lived `vimeflow-backend` sidecar process. The renderer talks to the sidecar through a single LSP-framed JSON IPC channel routed by Electron's main process.

- **IPC contract**: define shared types in `src-tauri/src/runtime/` and re-export via `ts-rs` to `src/bindings/` before implementing either side. Validate on the sidecar side (renderer is untrusted by default).
- **Renderer surface**: `window.vimeflow.{invoke,listen}` is the only allowed entry point; thin wrappers in `src/lib/backend.ts` provide the runtime-neutral seam. Feature code never imports `electron` directly.
- **Method allowlist**: `electron/backend-methods.ts` enumerates the methods the preload + main process forward to the sidecar. E2E-only methods are double-gated (`VITE_E2E=1` renderer flag AND Cargo `e2e-test` feature).
- **State management**: `BackendState` is the only shared-mutable container on the sidecar; wrap interior state in `Mutex<T>` / `RwLock<T>`. Production builds use `StdoutEventSink` for backend → renderer push; tests use `FakeEventSink`.
- **Commands** (invoke): request/response via `BackendState` methods + `_inner` helpers. Errors return `Result<T, String>` so the bare-string rejection contract makes it all the way to the renderer's `.catch()`.
- **Events** (listen): sidecar-initiated push via the `EventSink` trait. Payloads JSON-serializable, small, and bounded by the writer task's `STDOUT_QUEUE_CAPACITY`.

Historical note: PR-A through PR-D3 (May 13-16, 2026) replaced a Tauri 2 shell with this architecture. The migration's retrospective is at `docs/superpowers/retros/2026-05-16-electron-migration.md`.

## Visual Design

See `DESIGN.md` for the frontend design system and `docs/design/` for full screen specs.

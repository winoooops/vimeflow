# Architect

## Architecture Decisions

- **Immutability default** — language rules may override where idiomatic
- **80% test coverage**, TDD (Red-Green-Refactor) mandatory
- **File limits**: 200-400 lines typical, 800 max; functions <50 lines, <4 nesting levels
- **Model routing**: Haiku (lightweight workers), Sonnet (main dev), Opus (deep reasoning)

## Tauri Patterns

- **IPC contract**: define shared types before implementing either side; validate on Rust side (frontend untrusted)
- **State management**: `Mutex<T>` / `RwLock<T>` for thread safety
- **Allowlist**: least-privilege in `tauri.conf.json`
- **Commands** (invoke): request/response for frontend-initiated calls
- **Events** (listen): backend-initiated notifications pushed to frontend

## Visual Design

See `DESIGN.md` for the frontend design system and `docs/design/` for full screen specs.

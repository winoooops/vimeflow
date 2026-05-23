# Changelog

English | [简体中文](./CHANGELOG.zh-CN.md)

This file records the supported user-facing state of Vimeflow. For the detailed implementation timeline, use [docs/roadmap/progress.yaml](./docs/roadmap/progress.yaml), [docs/superpowers/](./docs/superpowers/), and the review knowledge base in [docs/reviews/CLAUDE.md](./docs/reviews/CLAUDE.md).

## [Unreleased]

### Changed

- Shortened the English and Chinese README files into source-build guides for the current `0.1.0` line, with deeper implementation details moved behind references.
- Documented the Lifeline Claude Code extension and the repository's harness-engineering practice framing in both READMEs.

## [0.1.0] - Current Source-Supported Line

### Supported

- Vimeflow is currently supported only as a source-built `0.1.0` app.
- Linux AppImage is the only supported packaged target, built locally with `npm run electron:build`.
- Hosted binary releases, signed installers, auto-update, and macOS / Windows packaging are not supported yet.

### Added

- Electron 42 desktop shell with the Rust `vimeflow-backend` sidecar over LSP-framed JSON IPC. This replaced the historical Tauri runtime. See the Electron migration retrospective in [docs/superpowers/retros/2026-05-16-electron-migration.md](./docs/superpowers/retros/2026-05-16-electron-migration.md).
- Terminal-first workspace: session tabs, multi-pane `SplitView` layouts, docked editor and diff panels, file explorer, git diff surfaces, command palette, and status bar.
- Agent observability for Claude Code and Codex through the shared backend adapter model and frontend agent-status panel.
- Codex cwd tracking from transcript events and terminal OSC 7 updates, plus linked-worktree names in pane headers.
- Agent-status UI polish including the collapsed rail bucket meters and activity-detail tooltips.

### Changed

- Rust backend moved to `crates/backend/` under a root Cargo workspace. The only shipping Rust binary is `vimeflow-backend`.
- E2E coverage now runs through WebdriverIO with `@wdio/electron-service`; the old Tauri driver path is gone.
- UI handoff work is still in progress. Completed and remaining items are tracked in [docs/roadmap/progress.yaml](./docs/roadmap/progress.yaml).

### Fixed

- Tooltip floating-anchor references now survive anchor updates.
- Terminal pane focus and border-reset issues from recent workspace polish were corrected.

### Removed

- Tauri runtime files, Tauri npm scripts, Tauri dependencies, and the old Tauri build workflow.

### References

- Build and setup: [SETUP.md](./SETUP.md)
- Developer commands: [DEVELOPMENT.md](./DEVELOPMENT.md)
- Architecture: [ARCHITECT.md](./ARCHITECT.md)
- Current roadmap state: [docs/roadmap/progress.yaml](./docs/roadmap/progress.yaml)

# Vimeflow

<div align="center">

**A terminal-first workspace for AI coding agents**

English | [简体中文](./README.zh-CN.md)

<img src="docs/media/hero-init.gif" alt="Starting a Claude Code session in Vimeflow and watching the agent panel stream tool calls" width="900" />

</div>

Vimeflow is an Electron desktop app with a Rust `vimeflow-backend` sidecar. It brings terminal sessions, multi-pane layouts, file browsing, code editing, git diff review, command palette actions, and live Claude Code / Codex observability into one workspace.

## Current Support

Vimeflow currently supports **version 0.1.0 from source code only**.

- Supported release line: `0.1.0`
- Supported packaged target: Linux AppImage built locally from source
- Desktop runtime: Electron 42 + Rust sidecar over LSP-framed JSON IPC
- Agent observability: Claude Code and Codex
- Not yet supported: hosted binary releases, macOS / Windows packaging, signing, or auto-update

Development on non-Linux systems may work, but the current supported build path is source checkout plus the Linux AppImage target.

## Build And Run From Source

Prerequisites:

- Node.js >= 22; Node 24 from `.nvmrc` is preferred for CI parity
- `nvm` is optional but recommended for using `.nvmrc`; skip `nvm use` if Node 24 is already active through another manager
- Rust stable toolchain
- Git
- Linux for the supported AppImage packaging path

```bash
git clone https://github.com/winoooops/vimeflow.git
cd vimeflow
nvm use # Optional: switches to Node 24 from .nvmrc
npm ci
```

Run the desktop app from source:

```bash
npm run electron:dev
```

On Linux hosts without a working Chromium sandbox:

```bash
VIMEFLOW_NO_SANDBOX=1 npm run electron:dev
```

Build the supported `0.1.0` AppImage:

```bash
npm run electron:build
chmod +x release/vimeflow-*.AppImage
./release/vimeflow-*.AppImage --no-sandbox
```

If the host does not provide `libfuse2`, use AppImage's fallback:

```bash
./release/vimeflow-*.AppImage --appimage-extract-and-run --no-sandbox
```

## Use Vimeflow

1. Start Vimeflow with `npm run electron:dev` or the locally built AppImage.
2. Open a terminal pane and run `claude` or `codex`.
3. Use the workspace to split panes, browse files, edit code, and review git diffs.
4. The agent status panel appears when a supported agent is detected.

For terminal working-directory sync, `zsh` and `fish` usually emit OSC 7 automatically. For `bash`, run:

```bash
./scripts/setup-shell-osc7.sh
```

## Lifeline And Harness Engineering

This repository is also a practical harness-engineering project. Vimeflow's development workflow uses the [Lifeline Claude Code extension](https://github.com/winoooops/lifeline) for planning, autonomous implementation loops, reviews, PR requests, upstream review handling, and PR approval.

Project-local setup notes live in [CLAUDE.md](./CLAUDE.md#lifeline-plugin-setup).

## Verify A Checkout

```bash
npm run lint
npm run format:check
npm run type-check
npm test
cargo test --manifest-path crates/backend/Cargo.toml
```

Regenerate TypeScript bindings after Rust type changes:

```bash
npm run generate:bindings
```

## Project References

- Setup details: [SETUP.md](./SETUP.md)
- Development commands and style: [DEVELOPMENT.md](./DEVELOPMENT.md)
- Architecture and Electron sidecar IPC: [ARCHITECT.md](./ARCHITECT.md)
- Design system: [DESIGN.md](./DESIGN.md) and [docs/design/UNIFIED.md](./docs/design/UNIFIED.md)
- Current roadmap status: [docs/roadmap/progress.yaml](./docs/roadmap/progress.yaml)
- Changelog: [CHANGELOG.md](./CHANGELOG.md) / [CHANGELOG.zh-CN.md](./CHANGELOG.zh-CN.md)
- Backend crate notes: [crates/backend/README.md](./crates/backend/README.md)

## License

MIT

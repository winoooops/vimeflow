# Vimeflow

<div align="center">

**A CLI Agent Control Plane for the Terminal-First Era**

🇺🇸 English | [🇨🇳 简体中文](./README.zh-CN.md)

</div>

<div align="center">

<img src="docs/media/hero-init.gif" alt="Spawning a Claude Code session in Vimeflow and running /init — the agent panel auto-detects and streams tool calls live" width="900" />

<sub>Spawn <code>claude</code>, run <code>/init</code>, watch the agent panel auto-detect and stream tool calls live.</sub>

</div>

> A Tauri desktop app that unifies terminal sessions, file explorer, code editor, and git diff into a single workspace — purpose-built for AI coding agents like Claude Code.

Vimeflow is a **CLI coding agent control plane** built with Tauri 2 (Rust + React/TypeScript). It gives you one window to manage terminal sessions where AI agents work, browse files, review diffs, and edit code — all with vim-style keybindings and a dark atmospheric UI.

But the product is only half the story. This repository is also a testbed for **harness-engineered, AI-native development**: an autonomous agent loop builds features from specification, governed by layered rules and specialized agents.

## What's Built

![Vimeflow workspace — Icon Rail, Sidebar, Terminal Zone with an active Claude Code session, and the Agent Status panel](docs/media/workspace-overview.png)

### Terminal Core (Phase 3)

Full xterm.js terminal integrated with a Tauri Rust PTY backend:

- **TauriTerminalService** — singleton IPC bridge between xterm.js and `portable-pty`
- Rust PTY commands: spawn, write, resize, kill — with stdout streamed via Tauri events
- Session caching per tab, multi-tab terminal support
- ResizeObserver + FitAddon for responsive terminal sizing
- WebGL renderer with Catppuccin Mocha theme

### Workspace Layout (Phase 2)

A 4-zone grid layout inspired by IDE + terminal multiplexer patterns:

- **Icon Rail** — project avatars and navigation
- **Sidebar** — session list with status indicators
- **Terminal Zone** — primary workspace area (xterm.js terminals)
- **Agent Activity Panel** — status, metrics, collapsible sections
- **Context Switcher** — Files / Editor / Diff tabs in a top tab bar

### Agent Status Sidebar (Phase 4 — Latest)

Real-time agent observability panel that auto-detects running AI coding agents in terminal sessions:

- **Rust backend** — `src-tauri/src/agent/` module with agent detector (process tree polling), statusline file watcher (`notify` crate), and transcript JSONL parser for tool call tracking
- **Statusline bridge** — per-session shell script pipes Claude Code's statusline JSON to a watched file; Rust parses and emits Tauri events (`agent-detected`, `agent-status`, `agent-tool-call`, `agent-disconnected`)
- **Frontend panel** — `src/features/agent-status/` with `useAgentStatus` hook subscribing to Tauri events, plus components: StatusCard (identity + model badge), BudgetMetrics (adaptive API key vs subscriber layout), ContextBucket (fill gauge + progress bar), ToolCallSummary (aggregated chips), RecentToolCalls, FilesChanged, TestResults, and ActivityFooter
- **Auto-collapse** — panel is 0px when no agent detected, animates to 280px on detection, holds final state for 5s after disconnect
- **ts-rs type codegen** — Rust types exported to `src/bindings/` for type-safe frontend consumption

Design spec: [`docs/superpowers/specs/2026-04-12-agent-status-sidebar/`](docs/superpowers/specs/2026-04-12-agent-status-sidebar/CLAUDE.md)

<p align="center">
  <img src="docs/media/agent-status-sidebar.png" alt="Agent Status Sidebar — Current Context gauge, Token Cache block, Activity feed, Files Changed, Tests panel" width="280" />
</p>

<sub align="center">Right panel close-up — Context gauge, Token Cache, Activity feed, Files Changed, and Tests panel populated by a live Claude Code session.</sub>

### Feature Modules

| Module           | Description                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------- |
| **terminal**     | xterm.js + Tauri PTY IPC bridge, session management                                       |
| **editor**       | IDE-style tabbed editor — CodeMirror 6, vim mode (@replit/codemirror-vim), vim status bar |
| **diff**         | Lazygit-style git diff viewer (side-by-side + unified, hunk navigation, stage/discard)    |
| **files**        | File explorer tree with breadcrumbs, git status badges (M/A/D/U), drag-and-drop           |
| **agent-status** | Real-time agent observability panel (statusline bridge + transcript parsing)              |
| **workspace**    | Layout shell composing all zones above                                                    |

![Editor with vim mode — `:w` typed, status bar shows -- NORMAL --](docs/media/editor-vim.png)

![Diff Viewer — changed files list and a hunk with green added lines](docs/media/git-diff.png)

### Quality

- **1399 tests** passing (plus 3 skipped, 1402 total) with **~91% coverage**
- Accessibility-first test queries (`getByRole` over `getByText`)
- Pre-commit hooks: ESLint + Prettier on staged files
- Commit-msg hook: conventional commits via commitlint
- Pre-push hook: full Vitest run

## Changelog

See [`CHANGELOG.md`](./CHANGELOG.md) (English) or [`CHANGELOG.zh-CN.md`](./CHANGELOG.zh-CN.md) (简体中文) for the linear timeline of notable changes. Each entry may cross-link review patterns from [`docs/reviews/`](./docs/reviews/CLAUDE.md) that it applied, updated, or created — so the CHANGELOG is the _when_ and `docs/reviews/` is the _why_.

## Tech Stack

| Layer         | Technologies                                          |
| ------------- | ----------------------------------------------------- |
| **Desktop**   | Tauri 2, Rust, portable-pty, tokio                    |
| **Frontend**  | React 19, TypeScript 5 (strict), Vite                 |
| **Styling**   | Tailwind CSS v4, Catppuccin Mocha semantic tokens     |
| **Terminal**  | xterm.js 6, WebGL addon, FitAddon                     |
| **Editor**    | CodeMirror 6, @replit/codemirror-vim (vim mode)       |
| **Animation** | Framer Motion 12                                      |
| **Testing**   | Vitest 3, Testing Library                             |
| **Quality**   | ESLint 9 (flat config), Prettier 3, Husky, commitlint |
| **Git**       | simple-git 3, diff2html 3                             |

## Design System: "The Obsidian Lens"

Dark atmospheric UI built on the Catppuccin Mocha palette — treats UI as illuminated, translucent layers within a deep void.

- **No visible borders** — use tonal depth and surface hierarchy (8 levels)
- **Glassmorphism** for floating elements (60-80% opacity, 12-20px blur)
- **Typography**: Manrope (headlines), Inter (body/labels), JetBrains Mono (code)
- **Semantic tokens**: `bg-surface-container`, `text-on-surface`, `text-primary`, etc.

Full spec: [`docs/design/DESIGN.md`](docs/design/DESIGN.md)

## Quick Start

```bash
# Prerequisites: Node >= 24, Rust toolchain
nvm use                          # Uses .nvmrc

# Frontend only (no Tauri backend)
npm install
npm run dev                      # Vite dev server at localhost:1420

# Full desktop app (requires Rust)
npm run tauri:dev                # Tauri + Rust backend

# Tests
npm test                         # 1399 tests (+3 skipped)
npx vitest run src/path/file.test.tsx  # Single file

# Quality
npm run lint                     # ESLint (type-checked)
npm run format:check             # Prettier check
npm run type-check               # tsc -b
```

### Shell Setup (OSC 7)

The sidebar file explorer auto-syncs with the terminal's working directory. This relies on your shell emitting [OSC 7](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h3-Operating-System-Commands) escape sequences when `cd` is used.

| Shell    | Status                                            |
| -------- | ------------------------------------------------- |
| **zsh**  | Works out of the box                              |
| **fish** | Works out of the box                              |
| **bash** | Requires a one-time setup (adds `PROMPT_COMMAND`) |

```bash
# Automatic setup (idempotent — safe to run multiple times)
./scripts/setup-shell-osc7.sh
```

Or add manually to `~/.bashrc`:

```bash
PROMPT_COMMAND="${PROMPT_COMMAND:+$PROMPT_COMMAND;}"'printf "\e]7;file://%s%s\a" "$HOSTNAME" "$PWD"'
```

### Linux / Wayland: WebKitGTK Renderer

The `tauri:dev` script sets `WEBKIT_DISABLE_DMABUF_RENDERER=1`. WebKitGTK's DMA-BUF renderer crashes on many Wayland compositor + driver combos with `Gdk-Message: Error 71 (Protocol error) dispatching to Wayland display`. Disabling DMA-BUF falls back to a renderer that works reliably across setups.

The variable is harmless on macOS (no WebKitGTK) but the inline shell syntax does not work on Windows `cmd.exe`. If Windows support is needed, swap in [`cross-env`](https://www.npmjs.com/package/cross-env).

### Harness Plugin Setup

The autonomous development harness is distributed as a local Claude Code plugin with three skills: `/harness-plugin:loop` (agent loop), `/harness-plugin:review` (local Codex review), and `/harness-plugin:github-review` (PR review fix).

```bash
# 1. Add the project's local marketplace (one-time)
/plugin marketplace add .

# 2. Install the harness plugin
/plugin install harness-plugin@harness

# 3. Reload to activate
/reload-plugins
```

The marketplace is defined at `.claude-plugin/marketplace.json` and the plugin source lives at `plugins/harness/`. After installation, skills are cached at `~/.claude/plugins/cache/harness/` and persist across sessions.

> Plugin skills don't appear in `/` autocomplete due to a [known Claude Code bug](https://github.com/anthropics/claude-code/issues/18949). See [`CLAUDE.md`](CLAUDE.md#harness-plugin-setup) for the optional autocomplete workaround (thin command wrappers in `~/.claude/commands/`).

## Repository Structure

```
CLAUDE.md                   # AI navigation hub (agents start here)
ARCHITECT.md                # Architecture decisions, Tauri IPC patterns
docs/design/DESIGN.md       # UI design system (single source of truth)

src/
├── features/
│   ├── terminal/           # xterm.js + TauriTerminalService IPC bridge
│   ├── editor/             # Tabbed code editor with CodeMirror 6 + vim mode
│   ├── diff/               # Lazygit-style diff viewer
│   ├── files/              # File explorer tree
│   ├── command-palette/    # Vim-style command palette
│   ├── agent-status/       # Real-time agent observability panel
│   └── workspace/          # 4-zone layout shell
├── components/layout/      # Shared layout (IconRail, Sidebar, TopTabBar, ContextPanel)
└── test/                   # Vitest setup

src-tauri/
├── src/
│   ├── main.rs             # Tauri entry point
│   ├── lib.rs              # Library setup
│   ├── terminal/           # PTY commands, state, types
│   ├── filesystem/         # List/read/write commands with scope validation
│   ├── git/                # Git status, diff, stage/unstage
│   └── agent/              # Agent detector, statusline watcher, transcript parser
├── Cargo.toml              # Rust dependencies
└── tauri.conf.json         # Tauri configuration

agents/                     # 10 specialized AI agent definitions
rules/                      # Hierarchical dev standards (common + TS + Rust)
harness/                    # Autonomous dev loop (Python; spawns `claude -p` per role, SDK fallback)
```

## The AI-Native Development Process

Traditional projects have humans write code and AI assist. Vimeflow inverts this:

1. **Humans write specs** — product requirements, design system, development rules
2. **An autonomous harness builds features** — a two-agent loop (Initializer + Coder) decomposes specs into a feature list and implements them incrementally
3. **Specialized agents review the work** — 10 AI agents handle planning, TDD, code review, security, and documentation
4. **Rules govern everything** — a hierarchical rule system (common + language-specific) ensures consistency without human intervention per commit

The harness (`harness/`) is a Python loop that spawns `claude -p` per role — it inherits the user's Claude Code CLI auth (no `ANTHROPIC_API_KEY` required on the default path). The SDK is preserved as an opt-in fallback (`--client sdk`). See [`docs/harness/CLAUDE.md`](docs/harness/CLAUDE.md) for the bilingual overview and [`harness/CLAUDE.md`](harness/CLAUDE.md) for the full reference.

## Roadmap

| Phase    | Status  | Description                                             |
| -------- | ------- | ------------------------------------------------------- |
| Phase 1  | Done    | Tauri scaffold, Rust compilation, CI green              |
| Phase 2  | Done    | Workspace layout shell (4-zone grid, all components)    |
| Phase 3  | Done    | Terminal core (xterm.js + Tauri PTY IPC)                |
| Phase 4  | Done    | Agent status sidebar (detection, statusline bridge, UI) |
| Phase 5  | Next    | Session management + Zustand state                      |
| Phase 6+ | Planned | Real git ops, AI agent output streaming, drag-and-drop  |

Progress tracked in [`docs/roadmap/progress.yaml`](docs/roadmap/progress.yaml).

## License

MIT

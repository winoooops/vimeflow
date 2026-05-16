# Vimeflow

<div align="center">

**A CLI Agent Control Plane for the Terminal-First Era**

🇺🇸 English | [🇨🇳 简体中文](./README.zh-CN.md)

</div>

<div align="center">

<img src="docs/media/hero-init.gif" alt="Spawning a Claude Code session in Vimeflow and running /init — the agent panel auto-detects and streams tool calls live" width="900" />

<sub>Spawn <code>claude</code>, run <code>/init</code>, watch the agent panel auto-detect and stream tool calls live.</sub>

</div>

> An Electron desktop app that unifies terminal sessions, file explorer, code editor, and git diff into a single workspace — purpose-built for AI coding agents like Claude Code and Codex.

Vimeflow is a **CLI coding agent control plane** built with Electron 42 (renderer: React + TypeScript) on top of a long-lived `vimeflow-backend` Rust sidecar (PTY, filesystem, git, agent observability) over LSP-framed JSON IPC. It gives you one window to manage terminal sessions where AI agents work, browse files, review diffs, and edit code — all with vim-style keybindings and a dark atmospheric UI.

> Historical note: Vimeflow was originally a Tauri 2 desktop app. The Electron migration ([retrospective](docs/superpowers/retros/2026-05-16-electron-migration.md), PRs [#209](https://github.com/winoooops/vimeflow/pull/209) / [#210](https://github.com/winoooops/vimeflow/pull/210) / [#211](https://github.com/winoooops/vimeflow/pull/211)) replaced the Tauri shell with Electron + a runtime-neutral Rust sidecar in May 2026.

But the product is only half the story. This repository is also a testbed for **Lifeline-driven, AI-native development**: an autonomous agent loop builds features from specification, governed by layered rules and specialized agents.

## What's Built

![Vimeflow workspace — Icon Rail, Sidebar, Terminal Zone with an active Claude Code session, and the Agent Status panel](docs/media/workspace-overview.png)

### Terminal Core (Phase 3)

Full xterm.js terminal integrated with the `vimeflow-backend` Rust sidecar via Electron IPC:

- **DesktopTerminalService** — singleton renderer-side bridge between xterm.js and `portable-pty` (renamed from `TauriTerminalService` in PR-D3)
- Rust PTY commands: spawn, write, resize, kill — dispatched through `BackendState` methods; stdout streamed via `StdoutEventSink` events
- Session caching per tab, multi-tab terminal support
- ResizeObserver + FitAddon for responsive terminal sizing
- WebGL renderer with Catppuccin Mocha theme

### Workspace Shell (Phase 2 + UI Handoff Steps 1-3)

A terminal-first workspace inspired by IDE + terminal multiplexer patterns:

- **Icon Rail** — project avatars and navigation
- **Sidebar** — handoff-styled session list with status indicators, subtitles, state pills, and line deltas
- **Session Tabs** — browser-style tabs wired to `useSessionManager`
- **Terminal Zone** — primary workspace area (xterm.js terminals)
- **Bottom Drawer** — editor and diff panels under the terminal zone
- **Agent Activity Panel** — status, metrics, collapsible sections
- **Context Switcher** — Files / Editor / Diff tabs in a top tab bar
- **Status Bar** — compact workspace status row

Current UI handoff progress is tracked in [`docs/roadmap/progress.yaml`](docs/roadmap/progress.yaml): steps 1-3 are done (`#171`, `#173`, `#174`); the single `TerminalPane` handoff step is next.

### Agent Status Sidebar (Phase 4)

Real-time agent observability panel that auto-detects running AI coding agents in terminal sessions. Supports **Claude Code** and **Codex** (since [#154](https://github.com/winoooops/vimeflow/pull/154)) with one shared frontend:

- **`AgentAdapter` trait** — `crates/backend/src/agent/adapter/` defines a single trait (`status_source` / `parse_status` / `validate_transcript` / `tail_transcript`) that each agent's adapter implements; the watcher pipeline, frontend events, and panel UI are agent-agnostic
- **Claude Code adapter** (`adapter/claude_code/`) — per-session shell script pipes Claude's statusline JSON to a watched file; the adapter parses it and emits sidecar events (`agent-detected`, `agent-status`, `agent-tool-call`, `agent-disconnected`)
- **Codex adapter** (`adapter/codex/`) — schema-driven SQLite locator over `~/.codex/*.sqlite` (logs DB → thread_id, threads DB → rollout JSONL path) with `/proc`-driven Linux fast-paths and FS-scan fallback; fold `event_msg.token_count` into the same `AgentStatusEvent` shape Claude emits
- **Rust backend orchestration** — `crates/backend/src/agent/` adds the agent detector (process tree polling), the `base::start_for` watcher driver (file-change notify + polling fallback), and per-adapter transcript JSONL tailers for tool-call / turn / test-run signals
- **Frontend panel** — `src/features/agent-status/` with `useAgentStatus` hook subscribing to the sidecar event bus, plus components: StatusCard (identity + model badge), BudgetMetrics (adaptive ApiKey/Subscriber/Fallback layout — Codex sessions render Subscriber with rate-limit bars; Claude API-key sessions render the Cost cell), ContextBucket (fill gauge + progress bar driven by `last_token_usage` for Codex, `total_input_tokens` for Claude), ToolCallSummary (aggregated chips), RecentToolCalls, FilesChanged, TestResults, and ActivityFooter
- **Auto-collapse** — panel is 0px when no agent detected, animates to 280px on detection, holds final state for 5s after disconnect
- **ts-rs type codegen** — Rust types exported to `src/bindings/` for type-safe frontend consumption (`CostMetrics.totalCostUsd: number | null` distinguishes Codex's no-cost surface from Claude's reported cost)

Design specs: [`2026-04-12-agent-status-sidebar/`](docs/superpowers/specs/2026-04-12-agent-status-sidebar/CLAUDE.md) (panel) · [`2026-05-02-claude-adapter-refactor-design.md`](docs/superpowers/specs/2026-05-02-claude-adapter-refactor-design.md) (trait abstraction, Stage 1) · [`2026-05-03-codex-adapter-stage-2-design.md`](docs/superpowers/specs/2026-05-03-codex-adapter-stage-2-design.md) (Codex adapter, Stage 2) · [`2026-05-04-codex-adapter-stage-2-scope-expansion.md`](docs/decisions/2026-05-04-codex-adapter-stage-2-scope-expansion.md) (ratified deviations)

<p align="center">
  <img src="docs/media/agent-status-sidebar.png" alt="Agent Status Sidebar — Current Context gauge, Token Cache block, Activity feed, Files Changed, Tests panel" width="280" />
</p>

<p align="center"><sub>Right panel close-up — Context gauge, Token Cache, Activity feed, Files Changed, and Tests panel. Driven by either a Claude Code or Codex session via the shared <code>AgentAdapter</code> trait.</sub></p>

### Feature Modules

| Module              | Description                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **terminal**        | xterm.js + sidecar PTY IPC bridge, session management                                                                       |
| **editor**          | IDE-style tabbed editor — CodeMirror 6, vim mode (@replit/codemirror-vim), vim status bar                                   |
| **diff**            | Lazygit-style git diff viewer (side-by-side + unified, hunk navigation, stage/discard)                                      |
| **files**           | File explorer tree with breadcrumbs, git status badges (M/A/D/U), drag-and-drop                                             |
| **command-palette** | Vim-style `:` palette (global shortcut, fuzzy match, namespace drill-in) — built-in command registry shipping incrementally |
| **agent-status**    | Real-time agent observability panel — multi-agent (Claude Code + Codex) via the `AgentAdapter` trait                        |
| **workspace**       | Layout shell composing all zones above                                                                                      |

![Editor with vim mode — `:w` typed, status bar shows -- NORMAL --](docs/media/editor-vim.png)

![Diff Viewer — changed files list and a hunk with green added lines](docs/media/git-diff.png)

### Quality

- Vitest + Testing Library coverage across frontend/domain modules, plus Rust tests for backend modules
- Accessibility-first test queries (`getByRole` over `getByText`)
- Pre-commit hooks: ESLint + Prettier on staged files
- Commit-msg hook: conventional commits via commitlint
- Pre-push hook: full Vitest run

## Changelog

See [`CHANGELOG.md`](./CHANGELOG.md) (English) or [`CHANGELOG.zh-CN.md`](./CHANGELOG.zh-CN.md) (简体中文) for the linear timeline of notable changes. Each entry may cross-link review patterns from [`docs/reviews/`](./docs/reviews/CLAUDE.md) that it applied, updated, or created — so the CHANGELOG is the _when_ and `docs/reviews/` is the _why_.

## Tech Stack

| Layer         | Technologies                                          |
| ------------- | ----------------------------------------------------- |
| **Desktop**   | Electron 42, Rust sidecar, portable-pty, tokio        |
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
# Prerequisites: Node >= 22 (Node 24 via .nvmrc for CI parity), Rust toolchain
nvm use                          # Uses .nvmrc

# Frontend only (no Rust backend; useful for renderer-only iteration)
npm install
npm run dev                      # Vite dev server at localhost:5173

# Full desktop app (requires Rust)
npm run electron:dev             # Electron + Rust sidecar (vimeflow-backend)

# Linux dev hosts without a working Chromium sandbox
VIMEFLOW_NO_SANDBOX=1 npm run electron:dev

# Packaged Linux AppImage
npm run electron:build           # Produces release/vimeflow-<version>-x64.AppImage

# Tests
npm test                         # Vitest suite
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

### Linux: AppImage smoke

`npm run electron:build` produces `release/vimeflow-<version>-x64.AppImage`. On dev hosts without a SUID `chrome-sandbox`, launch with `--no-sandbox`:

```bash
chmod +x release/vimeflow-*.AppImage
./release/vimeflow-*.AppImage --no-sandbox &
```

On hosts without `libfuse2`, fall back to `--appimage-extract-and-run --no-sandbox` (extracts to tmp and runs the unpacked tree). Post-PR-D3, the GTK/WebKitGTK renderer flags from the old Tauri setup (`WEBKIT_DISABLE_DMABUF_RENDERER=1`) are no longer needed — Electron ships its own Chromium.

### Lifeline Plugin Setup

The autonomous development workflow is provided by the dedicated [Lifeline Claude Code plugin](https://github.com/winoooops/lifeline). Lifeline provides `/lifeline:planner`, `/lifeline:loop`, `/lifeline:review`, `/lifeline:request-pr`, `/lifeline:upsource-review`, and `/lifeline:approve-pr`.

```bash
# 1. Register the Lifeline marketplace (one-time)
/plugin marketplace add winoooops/lifeline

# 2. Install the plugin
/plugin install lifeline@lifeline

# 3. Reload to activate
/reload-plugins
```

After installation, Lifeline is cached under Claude Code's plugin cache and persists across sessions. Project-local usage notes live in [`CLAUDE.md`](CLAUDE.md#lifeline-plugin-setup).

> Plugin skills don't appear in `/` autocomplete due to a [known Claude Code bug](https://github.com/anthropics/claude-code/issues/18949). See [`CLAUDE.md`](CLAUDE.md#lifeline-plugin-setup) for the optional autocomplete workaround.

## Repository Structure

```
CLAUDE.md                   # AI navigation hub (agents start here)
ARCHITECT.md                # Architecture decisions, Electron sidecar IPC patterns
docs/design/DESIGN.md       # UI design system (single source of truth)

src/
├── features/
│   ├── workspace/          # Workspace shell, session tabs/sidebar, bottom drawer
│   ├── terminal/           # xterm.js + DesktopTerminalService IPC bridge
│   ├── editor/             # Tabbed code editor with CodeMirror 6 + vim mode
│   ├── diff/               # Lazygit-style diff viewer
│   ├── files/              # File explorer tree
│   ├── command-palette/    # Vim-style command palette
│   └── agent-status/       # Real-time agent observability panel
├── components/             # Shared primitives (Tooltip)
├── hooks/                  # Shared React hooks
├── agents/                 # Agent metadata registry
├── bindings/               # Generated Rust -> TypeScript types
└── test/                   # Vitest setup

Cargo.toml                  # Workspace root manifest (members = ["crates/backend"])
Cargo.lock                  # Workspace lockfile (tracked at repo root)
target/                     # Cargo workspace build dir (gitignored)
.cargo/config.toml          # Cargo env: TS_RS_EXPORT_DIR = src/bindings/
crates/                     # Rust workspace members
└── backend/                # Renamed from src-tauri/
    ├── src/
    │   ├── bin/
    │   │   └── vimeflow-backend.rs  # Sidecar binary entry — stdin/stdout LSP-framed JSON IPC
    │   ├── lib.rs                   # Module declarations only (post-PR-D3 collapse)
    │   ├── runtime/                 # BackendState, IPC router, EventSink trait
    │   ├── terminal/                # PTY commands (_inner helpers + BackendState methods)
    │   ├── filesystem/              # List/read/write commands with scope validation
    │   ├── git/                     # Git status, diff, stage/unstage
    │   └── agent/                   # Agent detector, statusline watcher, transcript parser
    ├── Cargo.toml                   # Crate manifest (Tauri deps removed in PR-D3)
    └── README.md                    # Crate-level orientation

electron/                   # Electron desktop shell (PR-D1+)
├── main.ts                 # App lifecycle + ipcMain + sidecar process orchestration
├── preload.ts              # contextBridge.exposeInMainWorld('vimeflow', { invoke, listen })
├── sidecar.ts              # LSP frame codec + pending-request map + shutdown escalation
├── ipc-channels.ts         # Channel-name constants
└── backend-methods.ts      # Production method allowlist

electron-builder.yml        # Linux AppImage packaging config

agents/                     # 10 specialized AI agent definitions
rules/                      # Hierarchical dev standards (common + TS + Rust)
```

## The AI-Native Development Process

Traditional projects have humans write code and AI assist. Vimeflow inverts this:

1. **Humans write specs** — product requirements, design system, development rules
2. **Lifeline builds features** — the dedicated plugin decomposes specs into a feature list and implements them incrementally
3. **Specialized agents review the work** — 10 AI agents handle planning, TDD, code review, security, and documentation
4. **Rules govern everything** — a hierarchical rule system (common + language-specific) ensures consistency without human intervention per commit

Lifeline is the dedicated workflow plugin for Vimeflow's AI-native development loop. See [`CLAUDE.md`](CLAUDE.md#lifeline-plugin-setup) for Vimeflow-specific usage notes and <https://github.com/winoooops/lifeline> for the plugin runbook.

## Roadmap

| Phase      | Status      | Description                                                      |
| ---------- | ----------- | ---------------------------------------------------------------- |
| Phase 1    | Done        | Tauri scaffold, Rust compilation, CI green                       |
| Phase 2    | Done        | Workspace layout shell (4-zone grid, all components)             |
| Phase 3    | Done        | Terminal core (xterm.js + sidecar PTY IPC)                       |
| Phase 4    | Done        | Agent status sidebar (detection, statusline bridge, UI)          |
| UI Handoff | In progress | Steps 1-3 done: tokens/registry, app shell, sidebar/session tabs |
| Phase 5    | Planned     | Session management + persistence/state                           |
| Phase 6+   | Planned     | Remaining watcher, context-panel, usage, and desktop polish work |

Progress tracked in [`docs/roadmap/progress.yaml`](docs/roadmap/progress.yaml).

## License

MIT

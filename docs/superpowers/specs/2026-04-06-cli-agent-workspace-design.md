# CLI Agent Workspace — Design Spec

**Date**: 2026-04-06
**Status**: Draft
**Replaces**: Chat-based conversation manager vision

## Overview

Vimeflow pivots from a chatbot conversation manager to a **CLI coding agent control plane** — a Tauri desktop app that unifies terminal sessions (running AI coding agents), file explorer, code editor, and git diff into one window. The core pain point: developers currently juggle between a terminal app (for CLI agents like Claude Code), an editor (Zed, VSCode), and a file manager (Windows Explorer) to keep track of what agents are doing. Vimeflow eliminates this by putting everything in one window with the terminal as the primary workspace.

## Core Concepts

### Agent Session

A single instance of a CLI coding agent (Claude Code at launch, extensible to Codex, Aider, etc.) running in a PTY. Each session has:

- A name (user-assigned or derived from the initial prompt)
- A working directory (project root)
- A status: `running`, `paused`, `completed`, `errored`
- A terminal pane (xterm.js)
- Associated context: file changes, tool calls, test results

### Project

A grouping of agent sessions tied to a directory. Represented as an avatar in the icon rail. Analogous to a Discord server — click to see its sessions.

### Context Panels

Companion views (Files Explorer, Code Editor, Git Diff) that surround the terminal and react to the active agent session. They are scoped to the session's working directory and update as the agent makes changes.

## Layout Architecture

4-zone layout using the Discord navigation pattern:

```
┌──────┬────────────────┬──────────────────────┬──────────────┐
│ Icon │    Sidebar      │    Terminal Zone      │    Agent     │
│ Rail │                 │                      │   Activity   │
│ 48px │     260px       │     flexible         │    280px     │
│      │                 │                      │              │
│ [Pj] │ ┌─ Sessions ──┐│  ┌────────────────┐  │ Status       │
│ [Pj] │ │ auth middlwr ││  │ 🤖 Claude Code │  │ Context: 😊  │
│ [Pj] │ │ login fix    ││  │ ~/project $    │  │ 5h: 142/200  │
│      │ │ api refactor ││  │ █              │  │ ▾ Files (3)  │
│  +   │ ├─ Context ────┤│  └────────────────┘  │ ▸ Tools (4)  │
│  ⚙   │ │ 📁📝± tabs  ││  [tab1] [tab2] [+]   │ ▸ Tests (4/5)│
│      │ │ file tree... ││                      │ ▸ Usage      │
└──────┴────────────────┴──────────────────────┴──────────────┘
```

### Zone 1: Icon Rail (48px, fixed)

**Purpose**: Project selector + global actions.

| Section | Content                                                                                                                           |
| ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Top     | Project avatars (2-letter abbreviation, e.g., "My", "Vf"). Active project highlighted with `primary-container/20` pill backlight. |
| Bottom  | `+` New project button, `⚙` Settings                                                                                              |

Clicking a project avatar switches the sidebar to show that project's sessions and context.

### Zone 2: Sidebar (260px, collapsible)

**Purpose**: Session management + context panels for the active project.

Two stacked sections:

**Top — Session List**:

- Lists all agent sessions for the active project
- Each item shows: session name, status badge (`● running` / `⏸ paused` / `○ completed`), relative timestamp
- Active session highlighted with left accent border (`primary`) and `surface-container` background
- Click to switch the terminal zone and agent activity panel to that session

**Bottom — Context Switcher**:

- Tab row: `📁 Files` | `📝 Editor` | `± Diff`
- Content below renders the selected context panel, scoped to the active session's working directory
- Files Explorer: file tree with git status badges (M/A/D), click to open in Editor
- Code Editor: tabbed file viewer with syntax highlighting (CodeMirror 6). Note: at 260px this is a compact preview — clicking a file opens a full-width editor overlay or expands the sidebar.
- Git Diff: unified diff view (side-by-side requires more width). Click to open full-width diff overlay.

The sidebar collapses to give the terminal more room. When collapsed, the icon rail remains visible. Context panels can also expand to overlay the terminal zone for full-width editing/diffing.

### Zone 3: Terminal Zone (flexible, center)

**Purpose**: Primary workspace — where the agent runs.

- **Tabbed terminals**: Tab bar along the top. First tab is the agent PTY session. Additional tabs are plain shell panes added via `+` button.
- **One terminal per tab**: No splitting. Each tab renders a full xterm.js terminal instance.
- **Tab labels**: Agent tabs show `🤖 <session name>`, shell tabs show `🐚 shell` (or user-renamed).
- **No splitting rationale**: The context panels (Files, Editor, Diff, Agent Activity) already provide the multi-view. Splitting the terminal zone would duplicate functionality and reduce terminal readability.

### Zone 4: Agent Activity (280px, collapsible)

**Purpose**: Real-time dashboard for the active agent session.

Data sources:

- **File watcher** (Rust `notify` crate → Tauri events): Monitors the session's working directory for filesystem changes. Agent-agnostic.
- **Terminal output parser**: Parses Claude Code's stdout to extract structured info (tool calls, test results, status). Agent-specific, extensible via adapters.

#### Always-Visible (Pinned)

**Status Card**:

- Agent name and type (e.g., "Claude Code")
- State badge: `● running` (green), `⏸ paused` (blue), `○ completed` (muted), `✗ errored` (red)
- Current action description (parsed from terminal, e.g., "Creating auth middleware...")

**Context Window**:

- Smiley face indicator matching Claude Code's UX: `😊` (fresh) → `😐` (moderate) → `😟` (high) → `🥵` (near limit)
- Displayed as icon + label (e.g., `😊 Context`)

**5-Hour Usage**:

- Message or token count for the current 5-hour billing window
- Shows used / limit (e.g., `142 / 200 messages`)

#### Collapsible Sections

**Files Changed** (auto-expanded):

- Live list from file watcher
- Each entry: filename, change type badge (`new` / `modified` / `deleted`), line diff summary (`+5 -1`)
- Click a file → opens in Editor or Diff context panel

**Tool Calls** (collapsed by default, auto-expands on activity):

- Parsed from terminal output
- Each entry: status icon (`✓` done / `⟳` running / `✗` failed), tool name + argument summary
- Scrollable, newest at bottom

**Tests** (collapsed by default, auto-expands when tests run):

- Parsed from terminal output (vitest, jest, pytest patterns)
- Summary: passed / failed / total count
- Failed test details: file:line, assertion message

**Usage Details** (collapsed by default):

- Weekly usage: messages, tokens, cost
- Monthly usage: messages, tokens, cost
- Cost breakdown by model
- Mirrors metrics from the Claude Code billing page

**Footer** (always visible):

- Session duration
- Turn count
- Lines added / removed summary

## What Changes from Current Design

| Aspect          | Before (Chat Manager)                      | After (CLI Agent Workspace)                      |
| --------------- | ------------------------------------------ | ------------------------------------------------ |
| Primary view    | Chat message thread                        | Terminal pane (xterm.js)                         |
| Icon Rail       | Tab switcher (Chat/Files/Editor/Diff)      | Project selector (Discord pattern)               |
| Sidebar         | Conversation list + categories             | Agent session list + context switcher            |
| Right panel     | Context Panel (model info, recent actions) | Agent Activity (files, tools, tests, usage)      |
| Chat view       | Core feature                               | Dropped entirely                                 |
| Chat types/data | `Message`, `Conversation`, mock data       | Removed                                          |
| Terminal        | Not present                                | Core feature (PTY + xterm.js)                    |
| Agent awareness | None (generic AI chat)                     | First-class (status, tool calls, context window) |

## What Stays the Same

- **Design system**: "The Obsidian Lens" — Catppuccin Mocha palette, glassmorphism, no-border rules, ambient shadows, all typography and spacing tokens
- **4-column layout structure**: Icon Rail, Left Panel, Main Content, Right Panel — just different content in each zone
- **Files Explorer**: File tree with git status badges, context menus, breadcrumbs
- **Code Editor**: Tabbed editor with syntax highlighting (CodeMirror 6), vim status bar
- **Git Diff**: Side-by-side/unified diff, stage/discard actions
- **Command Palette**: `:` trigger, fuzzy search, keyboard navigation
- **Component patterns**: Arrow-function components, explicit return types, test co-location
- **Test infrastructure**: Vitest + Testing Library, 80%+ coverage target

## Tech Stack

| Component     | Technology            | Notes                                           |
| ------------- | --------------------- | ----------------------------------------------- |
| Runtime       | Tauri v2              | Rust backend for PTY, file watching, system ops |
| Frontend      | React 19 + TypeScript | Existing stack                                  |
| Bundler       | Vite                  | Existing                                        |
| Terminal      | xterm.js              | De facto standard for web-based terminals       |
| PTY           | portable-pty (Rust)   | Cross-platform PTY spawning                     |
| File watching | notify (Rust crate)   | FS events → Tauri events → frontend             |
| Editor        | CodeMirror 6          | Already designed, matches Termio's choice       |
| State         | Zustand               | Replaces prop drilling                          |
| Styling       | Tailwind CSS          | Existing, with semantic tokens                  |

## Agent Support Strategy

**Launch**: Claude Code only. The terminal output parser understands Claude Code's output format (tool calls, status updates, progress).

**Extension**: Agent adapters. Each supported agent gets a parser module that extracts structured data from its terminal output. The file watcher layer is agent-agnostic and works with any process.

```
AgentAdapter (interface)
├── ClaudeCodeAdapter    ← launch
├── CodexAdapter         ← future
├── AiderAdapter         ← future
└── GenericAdapter       ← fallback (no parsing, just file watcher)
```

## Google Stitch Prompts

For recreating the design in Google Stitch, use these prompts against the existing project (https://aistudio.google.com/apps/71779b0a-a865-421d-9e16-8d224a1a26a8):

### Prompt 1: Main Workspace Layout

```
Redesign the main application layout as a CLI coding agent workspace. Keep the existing "Obsidian Lens" dark theme (Catppuccin Mocha palette: surface #121221, surface-container #1e1e2e, primary #e2c7ff, on-surface #e3e0f7).

Layout is 4 zones:
1. Icon Rail (48px, left): Project avatars as 32x32 rounded squares with 2-letter abbreviations. Active project has a purple (#cba6f7) pill backlight at 20% opacity. Bottom: "+" and gear icons. Dark background #121221.

2. Sidebar (260px): Split into two stacked sections.
   - Top: "Sessions" header, then a list of agent sessions. Each session is a card showing: session name (bold), status badge (green dot "running", blue "paused", gray "completed"), and relative time. Active session has a left purple border accent and slightly lighter background (#292839).
   - Bottom: A tab row (Files | Editor | Diff) with content below. Active tab has purple text and bottom border. Show a file tree below with indented folders and files.
   Background: #1a1a2a.

3. Terminal Zone (flexible, center): A tab bar at top with tabs like "🤖 auth middleware" (active, purple bottom border) and "🐚 shell". Below: a full terminal view with dark background #121221, green prompt text (#7defa1), gray output text (#cdc3d1), purple cursor.

4. Agent Activity (280px, right): Background #1a1a2a.
   - Status card: agent name "Claude Code", green "running" badge, description text.
   - Context window: smiley face emoji (😊) with label "Context".
   - 5-hour usage: "142 / 200 messages" with a thin progress bar (purple gradient).
   - Collapsible sections with chevron toggles: "Files Changed" (expanded, showing green "+file" entries), "Tool Calls" (collapsed, showing count badge), "Tests" (collapsed, showing "4/5" badge), "Usage Details" (collapsed).
   - Footer: session time, turn count, lines added/removed in muted text.

No visible borders — use background color shifts only. Glassmorphism on floating elements. Rounded corners (cards: 1rem, buttons: 0.75rem). Fonts: Manrope for headings, Inter for body, JetBrains Mono for terminal/code.
```

### Prompt 2: Agent Activity Panel Detail

```
Design a detailed Agent Activity sidebar panel (280px wide) for a CLI coding agent manager. Dark theme, Catppuccin Mocha (#1a1a2a background).

Always-visible pinned section at top:
- Status card (#292839 background, 8px rounded): Row with "Claude Code" label and green "● running" badge. Below: "Creating auth middleware..." in gray.
- Context window indicator: A smiley face emoji (😊) next to the label "Context" in muted text. The emoji changes based on usage: 😊 (fresh, <50%), 😐 (moderate, 50-75%), 😟 (high, 75-90%), 🥵 (critical, >90%).
- 5-hour usage: "142 / 200" with "messages" label. Thin 3px progress bar below (purple gradient #e2c7ff → #cba6f7 fill, #1e1e2e track).

Collapsible sections below (each has a chevron ▾/▸ and a count badge):
1. "Files Changed" (expanded): List of files with green "+" prefix for new, purple "~" for modified, red "-" for deleted. Each has a line diff summary on the right (+5 -1).
2. "Tool Calls" (collapsed): Just header with badge "4".
3. "Tests" (collapsed): Header with badge showing "4/5" in green.
4. "Usage Details" (collapsed): Header with no badge.

Footer bar: muted text (#4a444f) showing "⏱ 2m 34s · 💬 12 turns · +48 -3".

No borders, use spacing and background shifts. Sections separated by 6px gap.
```

### Prompt 3: Session List in Sidebar

```
Design an agent session list for the sidebar (260px wide) of a CLI coding agent manager. Dark theme (#1a1a2a background).

Header: "Sessions" in muted uppercase (#4a444f), small font, letter-spacing.

Session items stacked vertically with 4px gap:
1. Active session: #292839 background, left 2px border in purple (#e2c7ff), 6px rounded. Shows "auth middleware" in white (#e3e0f7) bold, below that "● running" in green (#7defa1) on left and "2m ago" in muted on right.
2. Inactive session: transparent background, same layout. "fix: login bug" in gray (#cdc3d1), "⏸ paused" in blue (#a8c8ff), "15m ago".
3. Completed session: "refactor: api layer" in gray, "○ completed" in muted (#4a444f), "1h ago".

Below the session list, a thin separator line (#333344 at 15% opacity).

Then a "Context" label in muted uppercase, followed by a tab row: three small pill buttons (📁 Files, 📝 Edit, ± Diff). Active tab has #292839 background and purple text. Inactive tabs are transparent with gray text.

Below the tabs: a file tree showing folders and files with indentation, matching the existing Files Explorer design.
```

## Revised Roadmap (High-Level)

The old 6-phase Tauri migration roadmap is replaced. New phases:

| Phase | Focus                            | Key Deliverables                                                               |
| ----- | -------------------------------- | ------------------------------------------------------------------------------ |
| 1     | Tauri Scaffold                   | `src-tauri/` bootstrap, native window, CI green                                |
| 2     | Terminal Core                    | xterm.js + portable-pty integration, single terminal pane                      |
| 3     | Session Management               | Project/session data model, Zustand stores, sidebar session list               |
| 4     | File Watcher + Agent Activity    | Rust `notify` → Tauri events, Agent Activity sidebar, file change tracking     |
| 5     | Terminal Parser + Agent Adapters | Claude Code output parsing, tool call extraction, test result detection        |
| 6     | Context Panel Integration        | Wire Files/Editor/Diff to react to active session, scoped to working directory |
| 7     | Usage Metrics                    | Context window indicator, 5-hour usage, weekly/monthly usage panels            |
| 8     | Desktop Polish                   | Window state persistence, native menus, system tray, auto-updater              |

Detailed roadmap with timelines, dependencies, and risks to be written separately.

## Out of Scope (for now)

- Multi-agent support (Codex, Aider) — Claude Code only at launch
- SSH/remote connections — local PTY only
- Terminal splitting within a session — context panels handle multi-view
- AI copilot/chat sidebar — the terminal IS the conversation
- Drag-and-drop file upload to terminal — future enhancement
- Workspace export/sharing — future enhancement

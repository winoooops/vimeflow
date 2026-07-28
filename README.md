# Vimeflow

<div align="center">

<img src="build/icon.png" alt="Vimeflow logo" width="128" />

**Why settle for a terminal _or_ a GUI? Run both — seamlessly, in one window.**

A terminal-first workspace for AI coding agents: your agent CLIs live in real terminal panes, and a GUI wraps around them — never on top of them.

English | [简体中文](./README.zh-CN.md)

<img src="docs/media/hero-workspace.gif" alt="Creating a session in a demo project, launching Claude Code in a native Ghostty pane, and watching the agent panel stream traces" width="900" />

</div>

Vimeflow is an Electron desktop app riding on a Rust `vimeflow-backend` sidecar. One window holds your agent terminals — native Ghostty panes on macOS — plus multi-pane layouts you split and resize from the keyboard, a file explorer, a vim-mode editor, hunk-level git review, a vim-style command palette, themes you can bend to taste, and live observability for Claude Code, Codex CLI, Kimi Code, and OpenCode. One workspace, every agent, no tab-juggling.

## Native Ghostty Terminals On macOS

Vimeflow doesn't emulate a terminal in the browser. Packaged macOS arm64 builds embed **the real Ghostty engine** (`libghostty-spm` + a parented `NSView`) as the terminal backbone while the Rust sidecar keeps PTY ownership — so you get Ghostty's GPU-accelerated rendering right inside Electron. Output paints live as it streams, and panes stay smooth and coherent through a resize instead of tearing or lagging the way a web-based terminal does.

<div align="center">
  <img src="docs/media/ghostty-resize.gif" alt="Dragging a Vimeflow pane divider while the terminal renders live — Ghostty reflows the content smoothly and coherently through the resize" width="900" />
</div>

**Run your beloved TUI in the same pane** — `nvim`, `lazygit`, and other full-screen tools render side by side with your agent session and reflow cleanly as you resize. Linux and the dev fallback keep xterm.js.

<div align="center">
  <img src="docs/media/ghostty-tui.png" alt="Neovim running full-screen inside a native Ghostty terminal pane next to an agent session" width="900" />
</div>

Try it:

1. Launch a packaged macOS build, or `npm run electron:dev:ghostty` from source.
2. Press `⌘;` and run `:vsplit` to add a second pane.
3. Start an agent in one pane and `nvim .` in the other — both are real PTYs.

For terminal working-directory sync, `zsh` and `fish` usually emit OSC 7 automatically. For `bash`, run:

```bash
./scripts/setup-shell-osc7.sh
```

## Many Agents, One Workspace

Every coding-agent CLI crams its state into a one-line statusline you have to squint at. Vimeflow gives each agent a readable panel instead — model, context window, and a live **trace feed** — detected automatically, no wrapper commands and no ceremony; just run the CLI you already use. The trace feed is a scrollable **history of every tool the agent has run**, sorted into semantic traces per agent (Claude, Codex, Kimi, and OpenCode each get their own profile), each with a **Show diff** shortcut when it touched the working tree. So you see not just what the agent is doing this second, but everything it has already done — and can jump straight to the change any step made.

<div align="center">
  <img src="docs/media/multi-agent-grid.png" alt="Claude Code, Codex CLI, Kimi Code, and OpenCode each running in its own pane with the agent status panel expanded" width="900" />
</div>

Try it:

1. Click **+** in the sidebar — the New Session dialog takes a session name, a working directory, and optionally the agent command to launch with it.
2. Press `⌘;` and run `:layout` to pick a multi-pane arrangement (or `:vsplit` / `:split` vim-style).
3. Run `claude`, `codex`, `kimi`, or `opencode` in any pane — the status panel picks each one up as it starts.

### Reading the status sidebar

The panel isn't just a readout — it's three live gauges you can trust at a glance:

<table>
  <tr>
    <td width="33%" valign="top"><img src="docs/media/agent-context.png" alt="Context reservoir gauge in the agent status sidebar" width="100%" /></td>
    <td width="33%" valign="top"><img src="docs/media/agent-cache.png" alt="Cache-rate ring in the agent status sidebar" width="100%" /></td>
    <td width="33%" valign="top"><img src="docs/media/agent-traces.png" alt="The Traces feed in the agent status sidebar — recent tool calls with arguments and result status" width="100%" /></td>
  </tr>
  <tr>
    <td valign="top"><b>Context reservoir</b> — how much of the model's context window is left, draining like a tank as the conversation grows. The fill even shifts color as it climbs, so you feel the ceiling coming before you hit it.</td>
    <td valign="top"><b>Cache rate</b> — the share of this turn served from cache, drawn as a ring; the fuller it reads, the cheaper and faster the turn.</td>
    <td valign="top"><b>Traces</b> — a scrollable history of every tool the agent has fired: tool, arguments, and result, newest first.</td>
  </tr>
</table>

### Plan usage, where the API allows it

For agents that expose it, the panel tracks your remaining quota right beside the model — session and weekly, ticking down live as you work.

<div align="center">
  <img src="docs/media/usage-bars.png" alt="Agent status card showing the model, a turn count, and plan-usage bars for the 5-hour session and weekly usage, each with a percentage remaining" width="520" />
</div>

Kimi Code shows the very same bars — with a one-click switch to turn the tracking off entirely:

<div align="center">
  <img src="docs/media/kimi-usage.png" alt="Kimi Code plan-usage card — kimi-code/k3 with 5-hour session and weekly usage bars, and a Turn off plan-usage tracking control" width="520" />
</div>

<sub><i>Kimi Code plan-usage is opt-in — fetching it sends your configured Kimi credentials to the Kimi API. Detection, transcript tailing, and activity otherwise stay entirely local (`~/.kimi-code/`).</i></sub>

<sub><i>OpenCode exposes no usage-quota API, so there are no bars to draw — the status card links the upstream request ([sst/opencode#16017](https://github.com/sst/opencode/issues/16017)) instead. It's detected through a small auto-installed bridge plugin that reads model, context window (sized from OpenCode's models.dev cache), and tool activity with zero credential access.</i></sub>

## Review Changes Hunk By Hunk

A full inline review surface docked beside your terminals — not a shell-out to `git diff`. Diffs render through **Pierre**'s engine (`@pierre/diffs`), themed to match your workspace, with the changed-files list one pane over. You act on hunks in place — **stage or unstage a single hunk**, **discard a hunk or a whole file** (confirmed first) — and review here is a conversation, not a monologue: **leave a line-level comment and the working agent answers it in the same thread**, fixes the code, and marks it resolved. Want a second opinion? **Request review** hands the diff to a tertiary reviewer — dispatch it to another agent, or copy the prompt and take it wherever you like. Either way you step through the edits hunk by hunk and catch a bad change while it's still being written, without ever leaving the window.

<div align="center">
  <img src="docs/media/hunk-review.png" alt="A resolved review thread on a changed line in the diff dock: a comment asking to improve accessibility, answered by the agent and marked resolved" width="900" />
</div>

Try it:

1. Open a session in a repository with uncommitted changes.
2. Press `⌘G` (or `⌘;` → `:open-diff`) to open the diff dock next to your panes.
3. Pick a file in the changed-files list and stage, unstage, or discard individual hunks.
4. Tune hunk rendering under **Settings → Version Control → Hunk Appearance**.

## Seamless Worktree Integration

Multi-agent work means multiple git worktrees — and losing track of which one you're staring at. Vimeflow won't let you. It **watches each agent's terminal and auto-detects when it enters a worktree** — an `Entering worktree(...)`, a bare `cd`, an `EnterWorktree` skill report, an OSC 7 hint — and **hot-switches** the pane to match, no reload, no fuss. The **git chip** in the status bar always shows exactly where you are (`worktree → branch`), one click from copying the worktree name, its path, or the branch.

<div align="center">
  <img src="docs/media/worktree-chip.png" alt="The git chip's copy popover — Copy worktree (readme-refresh), Copy path, and Copy branch (docs/readme-refresh) — above the status-bar chip showing worktree to branch" width="560" />
</div>

Better still, the worktree an agent lives in **decides what you see**: the **file explorer** follows into that tree, and **diff review** scopes its changed-files list and hunks to that worktree — so you're always reviewing the code the agent is actually touching, not a stale checkout. Cleaner reviews, sharper quality gates, and zero _"wait, which branch is this?"_

## Command Palette And Settings

The palette borrows shamelessly from the greats — vim's `:` commands, Neovim's muscle memory, and Zed's fuzzy launcher. `⌘;` opens it: `:tabnew` for a new session, `:vsplit` / `:split` / `:only` for layouts, `:open-diff`, `:open-editor`, `:theme`, `:settings`, `:goto`, and friends — with fuzzy matching and per-command shortcuts. The settings dialog covers the rest: appearance, keymap, coding agents, editor, terminal, version control, and more.

<div align="center">
  <img src="docs/media/command-palette.png" alt="The vim-style command palette open over the workspace showing layout and diff commands" width="900" />
</div>

Try it:

1. Press `⌘;` and type a few letters — commands fuzzy-match as you type.
2. Run `:tabnew` to spin up a session, `:goto` to jump between sessions.
3. Open **Settings** (bottom of the sidebar) to remap keys under **Keymap** or configure agent launchers under **Coding Agents**.

## BYOT: Bring Your Own Theme

The Lens theme system ships a spread of built-in themes — **Catppuccin** (dark default), **Flexoki** (light), **Gruvbox** (dark and light), **Tokyo Night**, and **Dracula** — and every color in the app is a semantic token, so the whole workspace (terminals included) recolors instantly, with live preview before you commit. Don't see yours? **Import and export themes as JSON** and roll your own — the built-ins are just where you start.

<div align="center">
  <img src="docs/media/theme-tour.gif" alt="Cycling through the built-in color themes from the command palette with live preview" width="900" />
</div>

Try it:

1. Press `⌘;` and run `:theme`.
2. Move through the list — the workspace previews each theme live before you commit.
3. Press `Enter` to apply, `Esc` to snap back.

## On Linux

Everything above runs on Linux too — same workspace, same panes, same agent observability. The one swap: xterm.js does the terminal honors instead of native Ghostty (that embed is macOS-only for now). Package it as an AppImage, `chmod +x`, and you're off.

<div align="center">
  <img src="docs/media/linux-workspace.png" alt="Vimeflow running the full workspace on Linux, with xterm.js terminal panes" width="900" />
</div>

## Current Support

Vimeflow currently supports **version 0.1.0 from source code only**.

- Supported release line: `0.1.0`
- Supported packaged targets: Linux x64 AppImage and macOS arm64 DMG built locally from source
- Desktop runtime: Electron 42 + Rust sidecar over LSP-framed JSON IPC
- Terminal runtime: built-in native Ghostty via `libghostty-spm` for packaged macOS arm64, with xterm.js kept as the Linux/dev fallback
- Agent observability: Claude Code, Codex CLI, Kimi Code, and OpenCode
- Not yet supported: hosted binary releases, Windows packaging, production signing/notarization, or auto-update

Packaging is host-specific: build the Linux x64 AppImage on Linux x64, and build the macOS arm64 DMG on an Apple Silicon Mac.

## Build And Run From Source

Prerequisites:

- Node.js >= 22; Node 24 from `.nvmrc` is preferred for CI parity
- `nvm` is optional but recommended for using `.nvmrc`; skip `nvm use` if Node 24 is already active through another manager
- Rust stable toolchain
- Git
- Linux x64 or Apple Silicon macOS for supported package builds

```bash
git clone https://github.com/winoooops/vimeflow.git
cd vimeflow
nvm use # Optional: switches to Node 24 from .nvmrc
npm ci
```

To keep any dev run fully isolated from an installed Vimeflow (separate sessions, settings, and agent state), point any of the commands below at a throwaway data directory:

```bash
VIMEFLOW_USER_DATA_DIR=/tmp/vimeflow-demo npm run electron:dev
```

### macOS

Run with the **native Ghostty runtime** — the same terminal backbone the packaged build ships:

```bash
npm run electron:dev:ghostty
```

Or run on the **xterm.js** path — same app, no native Ghostty:

```bash
npm run electron:dev
```

Build the arm64 DMG:

```bash
npm run electron:build            # or: npm run electron:build:mac:arm64
```

The DMG lands at `release/vimeflow-*-arm64.dmg`. It bundles the native Ghostty parent runtime, is intended for local source builds, and is not notarized.

### Linux

Run from source — terminals are **xterm.js** on Linux (native Ghostty is macOS-only for now):

```bash
npm run electron:dev
```

On hosts without a working Chromium sandbox:

```bash
VIMEFLOW_NO_SANDBOX=1 npm run electron:dev
```

Build the x64 AppImage:

```bash
npm run electron:build            # or: npm run electron:build:linux:x64
```

Then run it:

```bash
chmod +x release/vimeflow-*.AppImage
./release/vimeflow-*.AppImage --no-sandbox
```

If the host does not provide `libfuse2`, use AppImage's extract-and-run fallback:

```bash
./release/vimeflow-*.AppImage --appimage-extract-and-run --no-sandbox
```

## Use Vimeflow

1. Start Vimeflow with `npm run electron:dev` or a locally built package.
2. Click **+** to create a session in your project, optionally launching `claude`, `codex`, `kimi`, or `opencode` with it.
3. Split panes, browse files, edit code, and review git changes hunk by hunk — see the feature tour above.
4. The agent status panel appears whenever a supported agent is detected.

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

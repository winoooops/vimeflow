# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Structure: Index-Only by Design

This file is intentionally minimal — it is an **index, not a reference**. Each linked document is self-contained. Read only what you need for the current task to keep context concise. Do NOT inline content from sub-documents back into this file.

## What This Project Is

Vimeflow is a **CLI coding agent control plane** — an Electron desktop application (Rust sidecar + React/TypeScript frontend) that unifies terminal sessions for AI coding agents, file explorer, code editor, git diff, command palette, and live agent observability in one window.

**Current state** — the chat-first UI has been removed. The Rust backend crate exists under `crates/backend/` as the `vimeflow-backend` Electron sidecar with terminal PTY, filesystem, git, and agent adapter modules for Claude Code, Codex CLI, Kimi Code, and OpenCode. The frontend workspace shell is active: sessions own `layout` + `panes[]`, `TerminalZone` renders the 5-layout `SplitView`, and `DockPanel` hosts Editor / Diff with bottom / top / left / right docking and elastic resize. Track live status in `docs/roadmap/progress.yaml`.

## Commands

```bash
npm run dev             # Vite dev server
npm run build           # tsc -b && vite build
npm run test            # Vitest (--passWithNoTests)
npx vitest run src/path/to/file.test.tsx  # Run a single test file
npm run lint            # ESLint (flat config, type-checked)
npm run lint:fix        # ESLint with auto-fix
npm run format:check    # Prettier check
npm run format          # Prettier write
npm run type-check      # tsc -b
# Lifeline plugin skills:
# /lifeline:planner, /lifeline:loop, /lifeline:review,
# /lifeline:request-pr, /lifeline:upsource-review, /lifeline:approve-pr
```

`package.json` permits Node >=22; use Node 24 from `.nvmrc` for CI parity. ESM-only (`"type": "module"`).

## Architecture

```
src/
├── main.tsx                    # React entry point
├── App.tsx                     # Root component, renders WorkspaceView
├── index.css                   # Tailwind + global styles
├── components/                 # Shared primitives, e.g. Tooltip
├── agents/                     # Agent metadata registry for UI handoff work
├── hooks/                      # Shared React hooks promoted out of features
├── bindings/                   # Generated Rust -> TypeScript types
├── features/
│   ├── sessions/               # Session tabs, pane model, layout state, lifecycle orchestration
│   ├── workspace/              # Workspace assembly, shell components, DockPanel, focus state
│   ├── terminal/               # xterm.js + DesktopTerminalService IPC bridge
│   ├── agent-status/           # Live agent observability panel
│   ├── files/                  # File explorer data/services/components
│   ├── editor/                 # CodeMirror editor, file buffers, vim mode
│   ├── diff/                   # Git status/diff viewer
│   └── command-palette/        # Vim-style command palette
└── test/setup.ts               # Vitest setup (jsdom, testing-library matchers)

crates/backend/
├── src/
│   ├── bin/vimeflow-backend.rs # Electron sidecar binary entry point
│   ├── runtime/                # BackendState, IPC router, EventSink trait
│   ├── terminal/               # PTY commands, cache, bridge, state
│   ├── filesystem/             # List/read/write commands with scope validation
│   ├── git/                    # Git status/diff/watch support
│   └── agent/                  # Agent detector and adapters for supported coding agents
└── tests/                      # Rust integration fixtures and transcript tests
```

**Feature-based organization**: code lives under `src/features/<name>/` with co-located components, types, and data. Cross-feature primitives live in `src/components/`, and current workspace composition lives in `src/features/workspace/WorkspaceView.tsx`.

**Test co-location**: every `.tsx`/`.ts` file has a sibling `.test.tsx`/`.test.ts` file.

## Code Style (Enforced by ESLint + Prettier)

- No semicolons, single quotes, trailing commas (es5)
- Arrow-function components only (`react/function-component-definition`)
- Explicit return types on all exported functions (`@typescript-eslint/explicit-function-return-type`)
- No `console.log` (`no-console: error`)
- `test()` not `it()` in Vitest (`vitest/consistent-test-it`)
- CSpell spell-checking enabled via ESLint
- Conventional commits enforced by commitlint: `feat|fix|refactor|docs|test|chore|perf|ci: description`

## Design System: "The Lens"

**The Lens** is a multi-theme system: **Catppuccin** (dark, default — atmospheric dark on the Catppuccin Mocha palette) and **Flexoki** (light). Colors are defined as semantic theme tokens in `src/theme/` (TS theme definitions applied as CSS variables at runtime — see `docs/superpowers/specs/2026-06-11-theme-system-design.md`; utilities like `bg-surface-container`, `text-on-surface`, `text-primary` resolve per active theme). The dark theme's file/id keeps the legacy `obsidian-lens` slug (its display label is `Catppuccin`). Fonts: Manrope (headlines), Inter (body/labels), JetBrains Mono (code). No visible borders — use tonal depth and glassmorphism.

**Read order:** `docs/design/UNIFIED.md` (authoritative, code-grounded — 3-zone shell + two-plane surface model, agent-state contract, component contracts), then `docs/design/DESIGN.md` (foundational philosophy/typography), then `src/theme/themes/*.ts` for runtime token values. Historical handoffs/mockups live in `docs/design/archive/` (reference only; UNIFIED wins).

## Git Hooks (Husky)

- **pre-commit**: lint-staged (ESLint + Prettier on staged files)
- **commit-msg**: commitlint (conventional commits)
- **pre-push**: vitest run

## Structure: Index-Only by Design

This file covers what you need to start working. For deeper topics, read the linked doc — do NOT inline their content back here.

| Topic                                                    | Where                                                                                                                                                                                     |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture decisions, Electron sidecar IPC patterns    | `ARCHITECT.md`                                                                                                                                                                            |
| UI design system, screens, components                    | `docs/design/UNIFIED.md` (authoritative, code-grounded) -> `docs/design/DESIGN.md` (foundation) -> `src/theme/themes/*.ts` (runtime tokens); historical mockups in `docs/design/archive/` |
| AI agent specs (planner, tdd-guide, code-reviewer, etc.) | `agents/CLAUDE.md`                                                                                                                                                                        |
| Development standards (coding style, testing, security)  | `rules/CLAUDE.md`                                                                                                                                                                         |
| Autonomous development loop and Codex review workflows   | Lifeline plugin — see [Plugin Setup](#lifeline-plugin-setup)                                                                                                                              |
| Architecture specs, exploration notes                    | `docs/CLAUDE.md`                                                                                                                                                                          |
| Codex code review (project context for Codex)            | `AGENTS.md`                                                                                                                                                                               |
| Historical Codex review specs                            | `docs/superpowers/specs/2026-04-02-codex-code-review-design.md`, `docs/superpowers/specs/2026-04-03-codex-feedback-loop-design.md`                                                        |
| Progress tracking (roadmap status)                       | `docs/roadmap/progress.yaml`                                                                                                                                                              |
| Linear change timeline (paired with reviews)             | `CHANGELOG.md` / `CHANGELOG.zh-CN.md`                                                                                                                                                     |
| Shell OSC 7 setup (file explorer cwd sync)               | `README.md` → "Shell Setup (OSC 7)"                                                                                                                                                       |
| Review knowledge base (patterns from past reviews)       | `docs/reviews/CLAUDE.md`                                                                                                                                                                  |
| Technical decision records (library choices, etc.)       | `docs/decisions/CLAUDE.md`                                                                                                                                                                |

## Lifeline Plugin Setup

Install the dedicated Lifeline Claude Code plugin from <https://github.com/winoooops/lifeline>:

```bash
# 1. Register the marketplace (one-time)
/plugin marketplace add winoooops/lifeline

# 2. Install the plugin
/plugin install lifeline@lifeline

# 3. Reload this Claude Code session
/reload-plugins
```

Available skills: `/lifeline:planner`, `/lifeline:loop`, `/lifeline:review`, `/lifeline:request-pr`, `/lifeline:upsource-review`, and `/lifeline:approve-pr`. Lifeline is self-contained and installs its Python orchestrator into the Claude plugin cache; this repo keeps only project-local usage notes.

### Project-Critical Skills (set up on first clone)

Two skills are load-bearing for non-trivial development on this repo. New contributors should know about both and have them available before opening their first PR.

#### 1. `/lifeline:planner` (in-repo, symlinked) — spec + plan authoring with codex review

Carries every non-trivial spec from draft to codex-reviewed-and-committed. Per-section iteration (codex reviews each section as it's added) plus a final whole-spec pass; same for plans. Output: a committed spec + plan that codex has signed off on, ready for human or subagent execution. The Electron migration ([retrospective](docs/superpowers/retros/2026-05-16-electron-migration.md)) was the third project to use it end-to-end (after PR-D1 and PR-D2); it now anchors how design work happens in this repo.

The skill ships helper bash scripts (`codex-review.sh`, `update-footer.sh`, `resolve-skill-dir.sh`) that resolve `SKILL_DIR` as `skills/<skill-name>` relative to the project root. The Claude plugin cache at `~/.claude/plugins/cache/lifeline/...` is _not_ in their lookup chain, so a fresh checkout fails the first `/lifeline:planner` invocation with `no prompt template for hook 'spec-complete'`. Fix once per clone:

```bash
mkdir -p skills

# Replace <version> with the installed lifeline plugin version (e.g. 0.0.2).
# Run `ls ~/.claude/plugins/cache/lifeline/lifeline/` to confirm.
ln -sfn ~/.claude/plugins/cache/lifeline/lifeline/<version>/skills/planner skills/planner
ln -sfn ~/.claude/plugins/cache/lifeline/lifeline/<version>/skills/upsource-review skills/upsource-review

# Keep the symlinks out of git (per-machine; the plugin cache path is operator-local).
grep -qxF 'skills/' .git/info/exclude || echo 'skills/' >> .git/info/exclude
```

After the bootstrap, `/lifeline:planner` resolves cleanly and codex output lands in `.lifeline-planner/` (also gitignored). The full rationale, alternatives, and risk mitigations live in [`docs/decisions/2026-05-16-in-repo-skills-setup.md`](docs/decisions/2026-05-16-in-repo-skills-setup.md).

#### 2. `native-feel-cross-platform-desktop` (system-wide skill) — desktop architecture shape

Globally available (loaded from `~/.claude/skills/` or equivalent). Trigger phrases: "Electron alternative", "Tauri vs native", "WebView wrapper", "near-native performance", "Raycast architecture", "WKWebView", "system tray app". Use it at the **shape** stage — before any spec is written — to answer "what's the right runtime + bundler + sidecar architecture for a native-feeling desktop app on macOS / Windows / Linux?" The Electron migration's design phase relied on it to short-circuit a multi-day "which bundler does Codex Desktop use, and why?" research detour into a single conversation.

The two skills compose: `native-feel-cross-platform-desktop` answers "what should this look like?" once; `/lifeline:planner` answers "is this spec self-consistent and complete?" on every iteration. Future migrations / new desktop projects should pair them in that order — shape with the design skill first, then write specs with the planner.

### Autocomplete Workaround

Plugin skills don't appear in `/` autocomplete due to a [known Claude Code bug](https://github.com/anthropics/claude-code/issues/18949). To enable autocomplete, create thin command wrappers in `~/.claude/commands/`:

```bash
mkdir -p ~/.claude/commands

while IFS='|' read -r slug desc; do
  cat > ~/.claude/commands/lifeline-${slug}.md <<EOF
---
description: ${desc}
---
Use the Skill tool to invoke \`lifeline:${slug}\`.
EOF
done <<'SKILLS'
planner|Brainstorm a design spec with automatic Codex review
loop|Launch the autonomous development loop
review|Run local Codex code review against the staged diff
request-pr|Open a PR from the current branch
upsource-review|Fetch and fix PR review findings
approve-pr|Finish a PR end-to-end
SKILLS
```

After running `/reload-plugins`, `/lifeline-*` aliases will appear in autocomplete. The plugin skills (`/lifeline:*`) continue to work when typed directly.

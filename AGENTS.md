# AGENTS.md

Project context for OpenAI Codex code review.

## Project

Vimeflow is an Electron desktop application (Rust sidecar + React/TypeScript frontend) for managing terminal-first AI coding agent workspaces.

**Current state:** The Rust backend crate exists under `crates/backend/` as the `vimeflow-backend` Electron sidecar with PTY, filesystem, git, and agent-observability modules. The frontend is a workspace shell with terminal sessions, a multi-pane `SplitView` terminal canvas, file/sidebar surfaces, docked editor/diff panels, command palette, and the agent status panel. The UI handoff migration is in progress; see `docs/roadmap/progress.yaml`.

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
│   ├── agent-status/           # Live Claude Code / Codex observability panel
│   ├── files/                  # File explorer data/services/components
│   ├── editor/                 # CodeMirror editor, file buffers, vim mode
│   ├── diff/                   # Git status/diff viewer
│   └── command-palette/        # Vim-style command palette
└── test/setup.ts               # Vitest setup

crates/backend/
├── src/
│   ├── bin/vimeflow-backend.rs # Electron sidecar binary entry point
│   ├── runtime/                # BackendState, IPC router, EventSink trait
│   ├── terminal/               # PTY commands, cache, bridge, state
│   ├── filesystem/             # List/read/write commands with scope validation
│   ├── git/                    # Git status/diff/watch support
│   └── agent/                  # Agent detector and Claude Code / Codex adapters
└── tests/                      # Rust integration fixtures and transcript tests
```

- **Feature-based organization**: code lives under `src/features/<name>/` with co-located components, types, and data
- **Test co-location**: every `.tsx`/`.ts` file has a sibling `.test.tsx`/`.test.ts`
- **Generated bindings**: Rust `ts-rs` exports live in `src/bindings/`; use `npm run generate:bindings` after Rust type changes
- **Workspace shell**: current top-level UI composition lives in `src/features/workspace/WorkspaceView.tsx`

## Code Style

Quick reference: no semicolons, single quotes, trailing commas (es5), arrow-function components only, explicit return types on exports, no `console.log`, `test()` not `it()`, CSpell spell-checking, ESM-only.

Commit messages for Codex-assisted changes must include the trailer `Co-Authored-By: codex <codex@openai.com>` exactly once at the end. See `rules/common/git-workflow.md` for the full commit format.

**For complete standards**, read these files in `rules/`:

- `rules/common/coding-style.md` — immutability, file organization, error handling, input validation
- `rules/common/code-review.md` — review checklist, severity levels, approval criteria
- `rules/common/security.md` — mandatory security checks, secret management
- `rules/common/testing.md` — 80% coverage minimum, TDD workflow, test types
- `rules/typescript/coding-style/CLAUDE.md` — TypeScript-specific style (explicit return types, no `any`, a11y)
- `rules/typescript/testing/CLAUDE.md` — Vitest patterns, Testing Library a11y queries
- `rules/typescript/security.md` — TypeScript security patterns
- `rules/typescript/patterns.md` — repository pattern, API format, React patterns

## Design System

"The Obsidian Lens" — dark atmospheric UI on Catppuccin Mocha palette. No visible borders — use tonal depth and glassmorphism.

Tooltips are unified: every hover label uses the shared `Tooltip` (`@/components/Tooltip`; contract in `docs/design/UNIFIED.md` §5.6). Flag native `title=` attributes on DOM elements and new hand-rolled floating surfaces.

Floating surfaces have public primitives: `Dropdown` (`@/components/Dropdown`; §5.7), `Menu`, and `Popover` are the canonical floating surfaces — features import these, never `@floating-ui/react` directly. `@floating-ui/react` belongs only in `src/components/base/floating/**` (the package-private substrate) and the grandfathered `src/components/Tooltip.tsx`. This boundary is enforced by ESLint rings 1–2 in `eslint.config.js`; flag any new `@floating-ui/react` import outside those two paths as a CRITICAL finding.

**For complete design specifications**, read:

- `DESIGN.md` — color palette, typography, layout, critical design rules, interaction patterns
- `docs/design/UNIFIED.md` — current authoritative UI contract for the handoff migration
- `docs/design/DESIGN.md` — full design system spec
- `docs/design/handoff/` — current UI handoff screenshots and prototype
- `docs/design/agent_workspace/` — workspace screen mockup and reference HTML
- `docs/design/code_editor/` — code editor screen
- `docs/design/files_explorer/` — files explorer screen
- `docs/design/git_diff/` — git diff viewer screen
- `docs/design/command_palette/` — command palette overlay

## Lifeline Integration

This file is read by Codex during Lifeline local reviews (`/lifeline:review`), Lifeline PR fix cycles (`/lifeline:upsource-review`), and GitHub PR reviews, including reviews posted by the `chatgpt-codex-connector[bot]` GitHub App. It provides the project context that informs review quality. Lifeline is installed from <https://github.com/winoooops/lifeline>; this repository no longer vendors the old `harness/` scripts or `harness-plugin`.

## Review Profile

Follow the review process and checklist defined in `agents/code-reviewer.md`. Key points:

- Gather context via `git diff`, understand scope, read surrounding code
- Apply confidence-based filtering: only report issues you are >80% confident about
- Consolidate similar issues instead of listing each separately
- Check security (CRITICAL), code quality (HIGH), React/UI patterns (HIGH), Electron/sidecar IPC patterns (HIGH), performance (MEDIUM), best practices (LOW)
- For AI-generated code: prioritize behavioral regressions, security assumptions, hidden coupling, unnecessary complexity

**Full review agent spec**: `agents/code-reviewer.md`

## GitHub Codex Connector

For PR reviews posted by the `chatgpt-codex-connector[bot]` GitHub App, treat the root `AGENTS.md` instructions as the repository-level review profile. Before reporting findings, apply `agents/code-reviewer.md` as the full checklist and methodology, with `rules/common/idea-framework.md` as the canonical IDEA definition.

Connector review findings should follow the same profile as Claude Code Review:

- Review only lines added or modified in the PR diff
- Apply the confidence, reality, and fix-cost filters from `agents/code-reviewer.md`
- Consolidate related findings into one issue instead of splitting one bug class across comments
- Use the project's severity levels and approval criteria below
- Skip low-value perfection findings; report only issues with plausible real-world impact or meaningful future-change cost

## Review Guidelines

- **Scope boundary (mandatory)**: Review ONLY the lines added or modified in the diff. Pre-existing bugs in unchanged code are out of scope — note them as follow-ups in a separate "Out-of-Scope Observations" section, never as findings with severity. Do not cascade into related files or chase increasingly niche edge cases in working code. Exception: actively exploitable CRITICAL security vulnerabilities.
- **Illustrative docs are out of scope**: Static, hand-authored explainer/diagram files under `docs/**` (e.g. `docs/diagrams/*.html`, `docs/design/*/code.html`) carry no application logic, runtime code, or tests. They are documentation. Do not line-by-line review them, raise CSS/SVG/markup nits, or treat them as behavioral surface; at most confirm links resolve. These files are also Prettier-ignored.
- Severity levels: CRITICAL (security/data loss), HIGH (bugs), MEDIUM (maintainability), LOW (style)
- Flag any hardcoded secrets, `console.log` statements, or `any` types
- Approval: no CRITICAL/HIGH = approve; HIGH only = warn; CRITICAL = block

## Review Knowledge Base

Past review findings are collected in `docs/reviews/CLAUDE.md`, grouped by recurring pattern. When reviewing, check if a finding matches an existing pattern — if so, note it. When fixing findings, record the fix in the appropriate pattern file per the ingestion protocol in the design spec.

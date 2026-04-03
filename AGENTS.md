# AGENTS.md

Project context for OpenAI Codex code review.

## Project

Vimeflow is a Tauri desktop application (Rust backend + React/TypeScript frontend) for managing conversations with AI coding agents.

**Phase:** Early implementation. The Tauri/Rust backend (`src-tauri/`) does not exist yet — current focus is frontend.

## Architecture

```
src/
├── main.tsx                    # React entry point
├── App.tsx                     # Root component
├── index.css                   # Tailwind + global styles
├── components/layout/          # Shared layout shells
└── features/chat/              # Chat feature module
    ├── ChatView.tsx            # Page assembly
    ├── components/             # Chat-specific components
    ├── data/mockMessages.ts    # Mock conversation data
    └── types/index.ts          # Chat domain types
```

- **Feature-based organization**: code lives under `src/features/<name>/` with co-located components, types, and data
- **Test co-location**: every `.tsx`/`.ts` file has a sibling `.test.tsx`/`.test.ts`
- **Shared layout**: `src/components/layout/` for cross-feature layout shells

## Code Style

Quick reference: no semicolons, single quotes, trailing commas (es5), arrow-function components only, explicit return types on exports, no `console.log`, `test()` not `it()`, CSpell spell-checking, ESM-only.

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

**For complete design specifications**, read:

- `DESIGN.md` — color palette, typography, layout, critical design rules, interaction patterns
- `docs/design/DESIGN.md` — full design system spec
- `docs/design/chat_or_main/` — chat screen mockup and reference HTML
- `docs/design/code_editor/` — code editor screen
- `docs/design/files_explorer/` — files explorer screen
- `docs/design/git_diff/` — git diff viewer screen
- `docs/design/command_palette/` — command palette overlay

## Harness Integration

This file is read by Codex during both **local reviews** (Phase 2 inner loop via `codex exec review --base main`) and **cloud reviews** (GitHub Action on PRs). It provides the project context that informs review quality. See `harness/CLAUDE.md` for the full three-phase harness workflow.

## Review Profile

Follow the review process and checklist defined in `agents/code-reviewer.md`. Key points:

- Gather context via `git diff`, understand scope, read surrounding code
- Apply confidence-based filtering: only report issues you are >80% confident about
- Consolidate similar issues instead of listing each separately
- Check security (CRITICAL), code quality (HIGH), React/UI patterns (HIGH), Tauri/IPC patterns (HIGH), performance (MEDIUM), best practices (LOW)
- For AI-generated code: prioritize behavioral regressions, security assumptions, hidden coupling, unnecessary complexity

**Full review agent spec**: `agents/code-reviewer.md`

## Review Guidelines

- Focus only on issues **introduced by the PR diff** — do not flag pre-existing problems
- Severity levels: CRITICAL (security/data loss), HIGH (bugs), MEDIUM (maintainability), LOW (style)
- Flag any hardcoded secrets, `console.log` statements, or `any` types
- Approval: no CRITICAL/HIGH = approve; HIGH only = warn; CRITICAL = block

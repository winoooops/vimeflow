# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Structure: Index-Only by Design

This file is intentionally minimal — it is an **index, not a reference**. Each linked document is self-contained. Read only what you need for the current task to keep context concise. Do NOT inline content from sub-documents back into this file.

## What This Project Is

Vimeflow is a **coding agent conversation manager** — a Tauri desktop application (Rust backend + React/TypeScript frontend) for managing conversations with AI coding agents.

**Phase: Early implementation** — CI/CD tooling, design system, and layout shell are established. Chat UI with mock data is functional. No Tauri/Rust backend yet (`src-tauri/` does not exist).

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
```

Node >= 24 (see `.nvmrc`). ESM-only (`"type": "module"`).

## Architecture

```
src/
├── main.tsx                    # React entry point
├── App.tsx                     # Root component, renders ChatView
├── index.css                   # Tailwind + global styles
├── components/layout/          # Shared layout shells (IconRail, Sidebar, TopTabBar, ContextPanel)
├── features/chat/              # Chat feature module
│   ├── ChatView.tsx            # Page assembly — composes layout + chat components
│   ├── components/             # Chat-specific components (MessageThread, MessageInput, AgentMessage, etc.)
│   ├── data/mockMessages.ts    # Mock conversation data
│   └── types/index.ts          # Chat domain types (Message, Conversation, etc.)
└── test/setup.ts               # Vitest setup (jsdom, testing-library matchers)
```

**Feature-based organization**: code lives under `src/features/<name>/` with co-located components, types, and data. Shared layout components live in `src/components/layout/`.

**Test co-location**: every `.tsx`/`.ts` file has a sibling `.test.tsx`/`.test.ts` file.

## Code Style (Enforced by ESLint + Prettier)

- No semicolons, single quotes, trailing commas (es5)
- Arrow-function components only (`react/function-component-definition`)
- Explicit return types on all exported functions (`@typescript-eslint/explicit-function-return-type`)
- No `console.log` (`no-console: error`)
- `test()` not `it()` in Vitest (`vitest/consistent-test-it`)
- CSpell spell-checking enabled via ESLint
- Conventional commits enforced by commitlint: `feat|fix|refactor|docs|test|chore|perf|ci: description`

## Design System: "The Obsidian Lens"

Dark atmospheric UI built on Catppuccin Mocha palette. Colors defined as semantic tokens in `tailwind.config.js` (e.g. `bg-surface-container`, `text-on-surface`, `text-primary`). Fonts: Manrope (headlines), Inter (body/labels), JetBrains Mono (code). No visible borders — use tonal depth and glassmorphism. See `DESIGN.md` and `docs/design/` for full specs.

## Git Hooks (Husky)

- **pre-commit**: lint-staged (ESLint + Prettier on staged files)
- **commit-msg**: commitlint (conventional commits)
- **pre-push**: vitest run

## Structure: Index-Only by Design

This file covers what you need to start working. For deeper topics, read the linked doc — do NOT inline their content back here.

| Topic                                                    | Where                                                           |
| -------------------------------------------------------- | --------------------------------------------------------------- |
| Architecture decisions, Tauri IPC patterns               | `ARCHITECT.md`                                                  |
| UI design system, screens, components                    | `DESIGN.md` → `docs/design/`                                    |
| AI agent specs (planner, tdd-guide, code-reviewer, etc.) | `agents/CLAUDE.md`                                              |
| Development standards (coding style, testing, security)  | `rules/CLAUDE.md`                                               |
| Autonomous development loop (harness)                    | `harness/CLAUDE.md`                                             |
| Architecture specs, exploration notes                    | `docs/CLAUDE.md`                                                |
| Codex code review (project context for Codex)            | `AGENTS.md`                                                     |
| Codex review design spec                                 | `docs/superpowers/specs/2026-04-02-codex-code-review-design.md` |

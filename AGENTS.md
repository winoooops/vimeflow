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

## Code Style (enforced by ESLint + Prettier)

- No semicolons, single quotes, trailing commas (es5)
- Arrow-function components only
- Explicit return types on all exported functions
- No `console.log` (eslint `no-console: error`)
- `test()` not `it()` in Vitest
- CSpell spell-checking enabled
- ESM-only (`"type": "module"`)

## Design System

"The Obsidian Lens" — dark atmospheric UI on Catppuccin Mocha palette. Semantic color tokens defined in `tailwind.config.js` (e.g. `bg-surface-container`, `text-on-surface`, `text-primary`). No visible borders — use tonal depth and glassmorphism.

## Review Guidelines

- Focus only on issues **introduced by the PR diff** — do not flag pre-existing problems
- Reference `rules/` directory for detailed coding standards
- Severity levels: CRITICAL (security/data loss), HIGH (bugs), MEDIUM (maintainability), LOW (style)
- Flag any hardcoded secrets, `console.log` statements, or `any` types

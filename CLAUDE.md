# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Structure: Index-Only by Design

This file is intentionally minimal — it is an **index, not a reference**. Each linked document is self-contained. Read only what you need for the current task to keep context concise. Do NOT inline content from sub-documents back into this file.

## What This Project Is

Vimeflow is a **CLI coding agent control plane** — a Tauri desktop application (Rust backend + React/TypeScript frontend) that unifies terminal sessions (AI coding agents like Claude Code), file explorer, code editor, and git diff into one window.

**Phase: Early implementation** — CI/CD tooling, design system, and layout shell are established. Pivoting from chat-based UI to terminal-first agent workspace. No Tauri/Rust backend yet (`src-tauri/` does not exist).

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
npm run review          # Local Codex code review (saves to .codex-reviews/)
npm run review:fix      # Interactive review-fix loop (fetch → fix → push → poll)
# Plugin skills: /harness-plugin:review (local), /harness-plugin:github-review (cloud PR), /harness-plugin:loop (agent loop)
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

Dark atmospheric UI built on Catppuccin Mocha palette. Colors defined as semantic tokens in `tailwind.config.js` (e.g. `bg-surface-container`, `text-on-surface`, `text-primary`). Fonts: Manrope (headlines), Inter (body/labels), JetBrains Mono (code). No visible borders — use tonal depth and glassmorphism. See `docs/design/DESIGN.md` for the full spec (single source of truth).

## Git Hooks (Husky)

- **pre-commit**: lint-staged (ESLint + Prettier on staged files)
- **commit-msg**: commitlint (conventional commits)
- **pre-push**: vitest run

## Structure: Index-Only by Design

This file covers what you need to start working. For deeper topics, read the linked doc — do NOT inline their content back here.

| Topic                                                    | Where                                                             |
| -------------------------------------------------------- | ----------------------------------------------------------------- |
| Architecture decisions, Tauri IPC patterns               | `ARCHITECT.md`                                                    |
| UI design system, screens, components                    | `docs/design/DESIGN.md` (single source of truth)                  |
| AI agent specs (planner, tdd-guide, code-reviewer, etc.) | `agents/CLAUDE.md`                                                |
| Development standards (coding style, testing, security)  | `rules/CLAUDE.md`                                                 |
| Autonomous development loop (harness + Codex review)     | `harness/CLAUDE.md`                                               |
| Harness pre-launch safety hooks (hookify rules)          | `harness/CLAUDE.md` → "Hookify Pre-Launch Rules"                  |
| Harness plugin (skills for agent loop, review, PR fix)   | `plugins/harness/` — see [Plugin Setup](#harness-plugin-setup)    |
| Architecture specs, exploration notes                    | `docs/CLAUDE.md`                                                  |
| Codex code review (project context for Codex)            | `AGENTS.md`                                                       |
| Codex review design spec                                 | `docs/superpowers/specs/2026-04-02-codex-code-review-design.md`   |
| Codex feedback loop design spec                          | `docs/superpowers/specs/2026-04-03-codex-feedback-loop-design.md` |
| Progress tracking (roadmap status)                       | `docs/roadmap/progress.yaml`                                      |

## Harness Plugin Setup

The harness skills (`/harness-plugin:loop`, `/harness-plugin:review`, `/harness-plugin:github-review`) are distributed as a local plugin marketplace. If they are not available in your session, install them:

```bash
# 1. Add the project's local marketplace (one-time)
/plugin marketplace add .

# 2. Install the harness plugin
/plugin install harness-plugin@harness
```

The marketplace definition lives at `.claude-plugin/marketplace.json` and the plugin source is at `plugins/harness/`. After installation, the skills are cached at `~/.claude/plugins/cache/harness/` and persist across sessions.

### Autocomplete Workaround

Plugin skills don't appear in `/` autocomplete due to a [known Claude Code bug](https://github.com/anthropics/claude-code/issues/18949). To enable autocomplete, create thin command wrappers in `~/.claude/commands/`:

```bash
mkdir -p ~/.claude/commands

cat > ~/.claude/commands/harness-loop.md << 'EOF'
---
description: Launch the VIBM autonomous development harness
---
Use the Skill tool to invoke `harness-plugin:loop`.
EOF

cat > ~/.claude/commands/harness-review.md << 'EOF'
---
description: Run local Codex code review and fix issues
---
Use the Skill tool to invoke `harness-plugin:review`.
EOF

cat > ~/.claude/commands/harness-github-review.md << 'EOF'
---
description: Fetch and fix Codex review findings from current PR
---
Use the Skill tool to invoke `harness-plugin:github-review`.
EOF
```

After running `/reload-plugins`, `/harness-loop`, `/harness-review`, and `/harness-github-review` will appear in autocomplete. The plugin skills (`/harness-plugin:*`) continue to work when typed directly.

# Rules — Hierarchical Development Standards

Rules follow a layered precedence model (like CSS specificity). Language-specific rules override common defaults where idioms differ.

## Structure

```
rules/
├── common/                # Universal defaults (10 files) — always applies
├── typescript/            # TypeScript/React overrides
│   ├── coding-style/      # CLAUDE.md (auto-loaded) + a11y-components.md (on-demand)
│   ├── testing/           # CLAUDE.md (auto-loaded) + a11y-queries.md (on-demand)
│   ├── hooks.md
│   ├── patterns.md
│   └── security.md
└── rust/                  # Rust/Tauri overrides (5 files)
```

Language-specific rules reference their common counterpart via `../../common/` (directories) or `../common/` (files). **Do not flatten** — they share filenames intentionally.

Topics with enough depth use the **directory pattern**: `topic/CLAUDE.md` (auto-loaded rule) + `topic/*.md` (on-demand examples agents read when needed).

## File Topics

Each directory contains files covering the same topics:

| File                      | Covers                                                               |
| ------------------------- | -------------------------------------------------------------------- |
| `coding-style/`           | Formatting, immutability, naming, a11y component patterns            |
| `testing/`                | Framework, coverage targets, TDD workflow, a11y query patterns       |
| `patterns.md`             | Repository pattern, API format, IPC patterns (Tauri)                 |
| `security.md`             | Secrets, input validation, scanning tools                            |
| `hooks.md`                | PreToolUse/PostToolUse hooks for formatters and linters              |
| `git-workflow.md`         | Commit format, PR process (common only)                              |
| `development-workflow.md` | Full pipeline: research → plan → TDD → review → commit (common only) |
| `performance.md`          | Profiling, caching, bundle size (common only)                        |
| `code-review.md`          | Review triggers, severity levels, agent delegation (common only)     |
| `agents.md`               | Agent orchestration, parallel execution (common only)                |

## Precedence

1. Language-specific rules (highest)
2. Common rules (lowest)

## Key Standards (Quick Reference)

- **Immutability**: default everywhere; Rust overrides for idiomatic mutation
- **Test coverage**: 80% minimum, TDD mandatory
- **File size**: 200-400 lines typical, 800 max
- **Function size**: <50 lines, <4 nesting levels
- **Commits**: conventional format (`feat|fix|refactor|docs|test|chore|perf|ci`)

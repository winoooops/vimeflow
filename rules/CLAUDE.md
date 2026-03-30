# Rules — Hierarchical Development Standards

Rules follow a layered precedence model (like CSS specificity). Language-specific rules override common defaults where idioms differ.

## Structure

```
rules/
├── common/          # Universal defaults (10 files) — always applies
├── typescript/      # TypeScript/React overrides (5 files)
└── rust/            # Rust/Tauri overrides (5 files)
```

Each language-specific file references its common counterpart via `../common/`. **Do not flatten** these directories — they share filenames intentionally and language files would overwrite common ones.

## File Topics

Each directory contains files covering the same topics:

| File                      | Covers                                                               |
| ------------------------- | -------------------------------------------------------------------- |
| `coding-style.md`         | Formatting, immutability, naming, file/function size limits          |
| `testing.md`              | Framework, coverage targets, TDD workflow                            |
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

# Technical Decisions — Records

Self-contained records of significant technical choices: what we chose, what we rejected, and why — preserved so future agents and contributors don't re-litigate settled trade-offs.

These are **technical decisions** (library choices, scoped patterns, reversible bets). For higher-level architecture (Tauri IPC structure, repo layout), see `ARCHITECT.md`.

## Structure: Index-Only by Design

This file is an index. Each linked record is self-contained. Read only what you need; do NOT inline record content here.

## Records

| Date       | Decision                                                                                       | Status   |
| ---------- | ---------------------------------------------------------------------------------------------- | -------- |
| 2026-05-04 | [Codex adapter Stage 2 scope expansion](./2026-05-04-codex-adapter-stage-2-scope-expansion.md) | Accepted |
| 2026-05-03 | [Claude parser JSON boundary](./2026-05-03-claude-parser-json-boundary.md)                     | Accepted |
| 2026-04-22 | [Tooltip library: `@floating-ui/react`](./2026-04-22-tooltip-library.md)                       | Accepted |

## Adding a record

Write one when:

- Adopting or rejecting a new dependency (especially infra-level: UI primitives, state, routing)
- Choosing between architectural patterns within a feature (portal vs inline, sync vs async, etc.)
- Reversing a previous decision
- Rejecting an obvious option for a non-obvious reason

Skip if:

- The choice is purely stylistic (lint rules, formatting)
- The full reasoning fits in a single commit message

## Format

Use the latest existing record as the working template. Each record covers, in order:

1. **Context** — what problem, where it surfaced
2. **Options considered** — including the ones rejected
3. **Decision**
4. **Justification** — numbered reasons
5. **Alternatives rejected** — per option, with reasons
6. **Known risks & mitigations** — open issues, fallbacks
7. **References** — URLs for follow-up

File naming: `YYYY-MM-DD-<short-slug>.md`. The folder context makes the `-decision` suffix redundant.

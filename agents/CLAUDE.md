# Agents — Specialized AI Agent Definitions

Standalone markdown specs defining purpose, tools, model, and behavior for each agent. Each agent is self-contained and can operate without knowledge of other agents. All are tailored for the Tauri/TypeScript/Rust stack with IPC-aware patterns.

## Agent Inventory

### Planning Phase

| Agent          | Model | Purpose                                                      |
| -------------- | ----- | ------------------------------------------------------------ |
| `planner.md`   | Opus  | Implementation planning for complex features and refactoring |
| `architect.md` | Opus  | System design, scalability, and technical decision-making    |

### Development Phase

| Agent                    | Model  | Purpose                                                 |
| ------------------------ | ------ | ------------------------------------------------------- |
| `code-reviewer.md`       | Sonnet | General code quality, patterns, security review         |
| `tdd-guide.md`           | Sonnet | TDD enforcement (Red-Green-Refactor), 80%+ coverage     |
| `typescript-reviewer.md` | Sonnet | TypeScript/JS type safety, async correctness, Tauri IPC |

### Infrastructure & Security

| Agent                     | Model  | Purpose                                           |
| ------------------------- | ------ | ------------------------------------------------- |
| `build-error-resolver.md` | Sonnet | TypeScript/Rust build errors, minimal diffs       |
| `security-reviewer.md`    | Sonnet | OWASP Top 10, secrets, injection, Tauri allowlist |

### Testing & Maintenance

| Agent                 | Model  | Purpose                                          |
| --------------------- | ------ | ------------------------------------------------ |
| `e2e-runner.md`       | Sonnet | Playwright E2E tests for Tauri webview           |
| `refactor-cleaner.md` | Sonnet | Dead code removal, unused exports, consolidation |
| `doc-updater.md`      | Haiku  | Codemaps, documentation generation               |

## Spec Format

Each agent file uses YAML frontmatter:

```yaml
---
name: agent-name
description: One-line purpose
tools: ['Read', 'Write', ...]
model: opus | sonnet | haiku
---
```

Followed by role definition, workflow steps, and output format.

## Prescribed Workflow

Agents are used in this order during feature development:

```
planner → tdd-guide → code-reviewer → security-reviewer → build-error-resolver (if needed)
```

## Model Routing

- **Opus**: Deep reasoning tasks (planning, architecture)
- **Sonnet**: Main development work (review, TDD, testing, security)
- **Haiku**: Lightweight workers (documentation)

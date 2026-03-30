# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

VIBM is a **coding agent conversation manager** — a Tauri desktop application with a TypeScript frontend. It manages conversations with AI coding agents.

The project is currently in **groundwork phase**: agent specifications, development rules, and architectural foundations are being established before any application code is written.

## Project Status

**Phase: Foundation / Pre-implementation**

Current repo contents are the development standards and agent definitions that will govern how the application is built. The Tauri app scaffolding, TypeScript source, and Rust backend do not exist yet.

## Tech Stack (Planned)

- **Desktop framework**: Tauri (Rust backend + web frontend)
- **Frontend**: React + TypeScript (arrow-function components)
- **Testing**: Vitest + Testing Library (unit/integration), Playwright (E2E)
- **Linting**: ESLint flat config with type-checked rules, Prettier, CSpell
- **UI development**: Storybook
- **Rules/agents**: Markdown specifications (current content)

## Repository Structure

```
vibm/
├── agents/       # 10 specialized AI agent definitions (.md files)
├── harness/      # Autonomous development harness (Python)
│   ├── prompts/  # Initializer + coder prompt templates
│   └── *.py      # Agent loop, security, progress tracking
├── rules/
│   ├── common/   # Language-agnostic development rules
│   ├── rust/     # Rust/Tauri-specific rule extensions
│   └── typescript/  # TypeScript-specific rule extensions
└── docs/         # Documentation directory
```

## Groundwork Architecture

### Rules Layer (Hierarchical Override System)

Rules follow a layered precedence model (like CSS specificity):

- `rules/common/` — universal defaults
- `rules/<language>/` — language-specific overrides that extend common rules

Each language-specific file references its common counterpart via relative paths (`../common/`). **Do not flatten** common and language directories together — they share filenames intentionally and language files would overwrite common ones.

### Agent Layer

Agents in `agents/` are standalone markdown specs defining purpose, tools, and behavior for specialized AI agents, organized by development lifecycle phase:

- **Planning**: `planner.md`, `architect.md`
- **Development**: `code-reviewer.md`, `tdd-guide.md`, `typescript-reviewer.md`
- **Infrastructure**: `build-error-resolver.md`
- **Security**: `security-reviewer.md`
- **Testing**: `e2e-runner.md`
- **Maintenance**: `refactor-cleaner.md`, `doc-updater.md`

All agents are tailored for the Tauri/TypeScript stack with IPC-aware review patterns.

### Prescribed Development Workflow

```
Research & Reuse → Plan (planner) → TDD (tdd-guide) →
Code Review (code-reviewer) → Security Review → Commit → PR
```

## Autonomous Development Harness

The `harness/` directory contains a Python-based autonomous coding loop adapted from [Anthropic's autonomous-coding demo](https://github.com/anthropics/claude-quickstarts/tree/main/autonomous-coding). It uses the two-agent pattern:

1. **Initializer** (first run) — reads `app_spec.md`, generates `feature_list.json`
2. **Coder** (subsequent runs) — picks the next feature, implements it, marks done

```bash
cd harness
pip install -r requirements.txt
python autonomous_agent_demo.py                    # Run unlimited
python autonomous_agent_demo.py --max-iterations 3  # Test with limit
```

Before running: fill in `harness/prompts/app_spec.md` with the full VIBM product specification.

**Safety**: Bash commands are allowlisted (`security.py`), feature_list.json is write-protected against deletions (`hooks.py`), and the SDK runs in a sandbox.

## Working in This Repo (Current Phase)

Until app scaffolding begins, work involves:

- Adding/modifying agent specs in `agents/`
- Adding/modifying rules in `rules/common/`, `rules/rust/`, or `rules/typescript/`
- Refining harness prompts in `harness/prompts/`

When adding a new language directory:

1. Create `rules/<language>/` with files matching the common filenames
2. Each file should start by referencing its common counterpart
3. Only include language-specific overrides and examples — don't repeat common content

## Key Design Decisions

- **Immutability is the default** coding standard; language-specific rules may override where idiomatic
- **80% test coverage** is mandatory
- **TDD (Red-Green-Refactor)** is the required methodology
- **Model routing by task**: Haiku for lightweight workers, Sonnet for main development, Opus for deep reasoning
- Agent specs are self-contained — each agent can operate without knowledge of other agents

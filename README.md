# Vimeflow

<div align="center">

🇺🇸 English | [🇨🇳 简体中文](./README.zh-CN.md)

</div>

> An experiment in **Harness-Engineered, AI-Native Development** — where autonomous agent loops build the application from specification to implementation, governed by layered rules and specialized agents.

Vimeflow is a coding agent conversation manager built as a Tauri desktop app (Rust + React/TypeScript). But the product itself is secondary to the process: this repository is a testbed for exploring how far autonomous development harnesses can go when given well-structured specifications, safety guardrails, and progressive disclosure documentation.

## What Makes This AI-Native

Traditional projects have humans write code and AI assist. Vimeflow inverts this:

1. **Humans write specs** — product requirements, design system, development rules
2. **An autonomous harness builds features** — a two-agent loop (Initializer + Coder) decomposes specs into feature lists and implements them incrementally
3. **Specialized agents review the work** — 10 AI agents handle planning, TDD, code review, security, and documentation
4. **Rules govern everything** — a hierarchical rule system (common + language-specific) ensures consistency without human intervention per commit

The CI/CD infrastructure, linter configuration, and git hooks already in this repository were all built by the harness from an `app_spec.md` specification.

## Repository Structure

```
CLAUDE.md           <- AI navigation hub (start here for agents)
README.md           <- You are here (for humans)
DEVELOPMENT.md      <- Commands, tech stack, code style
ARCHITECT.md        <- Architecture decisions, Tauri patterns
DESIGN.md           <- UI design system (Obsidian Lens / Catppuccin Mocha)

agents/             <- 10 specialized AI agent definitions
rules/              <- Hierarchical development standards (common + TS + Rust)
harness/            <- Autonomous development loop (Claude Code SDK, Python)
docs/design/        <- Screen mockups, Stitch HTML/CSS, design spec
```

## The Harness

The autonomous development harness (`harness/`) is the engine of this experiment. It is a Python-based loop built on the Claude Code SDK:

- **Initializer agent** reads `app_spec.md` and decomposes it into a phased `feature_list.json`
- **Coder agent** picks the next pending feature, implements it, marks it done, and auto-continues
- **Safety layers** include a bash command allowlist, sandboxed execution, and write-protection on the feature list

```bash
cd harness && pip install -r requirements.txt
python autonomous_agent_demo.py                    # Unlimited iterations
python autonomous_agent_demo.py --max-iterations 5 # Capped
```

See `harness/CLAUDE.md` for the full details.

## Current Status

**Phase: Foundation / Pre-implementation**

- Development rules, agent specs, and CI/CD tooling are established
- Design system (5 screens) specified via Google Stitch
- Application code (Tauri scaffolding, `src/`, `src-tauri/`) does not exist yet
- Next: harness builds the app from the design spec

## Tech Stack

Tauri 2 (Rust backend + web frontend) | React 19 + TypeScript | Vitest + Playwright | ESLint + Prettier | Husky + commitlint | GitHub Actions CI/CD

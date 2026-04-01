# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Structure: Index-Only by Design

This file is intentionally minimal — it is an **index, not a reference**. Each linked document is self-contained. Read only what you need for the current task to keep context concise. Do NOT inline content from sub-documents back into this file.

## What This Project Is

Vimeflow is a **coding agent conversation manager** — a Tauri desktop application (Rust backend + React/TypeScript frontend) for managing conversations with AI coding agents.

**Phase: Foundation / Pre-implementation** — CI/CD tooling infrastructure is established; application code (Tauri scaffolding, `src/`, `src-tauri/`) does not exist yet.

## Where to Look

Each topic is self-contained. Start here, drill down as needed.

| What You Need                                            | Where                        |
| -------------------------------------------------------- | ---------------------------- |
| Commands, tech stack, code style                         | `DEVELOPMENT.md`             |
| Architecture decisions, Tauri patterns                   | `ARCHITECT.md`               |
| UI design system, screens, components                    | `DESIGN.md` → `docs/design/` |
| AI agent specs (planner, tdd-guide, code-reviewer, etc.) | `agents/CLAUDE.md`           |
| Development standards (coding style, testing, security)  | `rules/CLAUDE.md`            |
| Autonomous development loop (drove CI/CD setup)          | `harness/CLAUDE.md`          |
| Architecture specs, exploration notes                    | `docs/CLAUDE.md`             |

---
id: documentation-accuracy
category: code-quality
created: 2026-04-09
last_updated: 2026-04-09
ref_count: 0
---

# Documentation Accuracy

## Summary

When implementation changes (removing an addon, renaming a directory, changing
behavior), inline docs and comments must be updated in the same commit.
Stale documentation misleads future contributors and review agents.

## Findings

### 1. TerminalPane docs claim WebGL rendering after addon removal

- **Source:** github-codex | PR #33 | 2026-04-08
- **Severity:** LOW
- **File:** `src/features/terminal/components/TerminalPane.tsx`
- **Finding:** Component doc comment lists "Hardware-accelerated rendering with WebGL addon" but WebGL addon was removed in this PR
- **Fix:** Updated feature list to reflect Canvas2D renderer
- **Commit:** `6a312b3 fix: terminal rendering, WebGL, backspace, and progress tracker (#33)`

### 2. Broken design reference path in mock file tree

- **Source:** github-codex | PR #36 | 2026-04-09
- **Severity:** LOW
- **File:** `src/features/files/data/mockFileTree.ts`
- **Finding:** Comment references `docs/design/left-sidebar/` but actual path is `docs/design/leftsidebar/`
- **Fix:** Updated comment to correct directory name
- **Commit:** `435e217 feat: interactive sidebar sessions, resizable panels, and real file explorer (#36)`

### 3. Wrong dev server port in README

- **Source:** github-codex | PR #35 | 2026-04-09
- **Severity:** LOW
- **File:** `README.md`
- **Finding:** Quick Start says `npm run dev` serves at `localhost:1420` but Vite uses `localhost:5173`
- **Fix:** Updated README to correct port
- **Commit:** `95a4075 docs: rewrite README for current project state (#35)`

### 4. Unverified security finding in roadmap

- **Source:** github-codex | PR #25 | 2026-04-05
- **Severity:** MEDIUM
- **File:** `docs/roadmap/tauri-migration-roadmap.md`
- **Finding:** Roadmap claims CRITICAL issue about `.env` using plain HTTP but no `.env` exists in repo — speculative finding presented as confirmed
- **Fix:** Reframed as conditional risk with clear assumptions
- **Commit:** `bacec0e docs: add Tauri migration roadmap (#25)`

### 5. Roadmap dependency inconsistencies

- **Source:** github-codex | PR #30 | 2026-04-06
- **Severity:** LOW
- **File:** `docs/roadmap/progress.yaml`
- **Finding:** Phase dependencies inconsistent between roadmap narrative, dependency graph, and `progress.yaml`
- **Fix:** Aligned all three sources for consistent dependency information
- **Commit:** `6b80a60 docs: rewrite roadmap for CLI agent workspace pivot (#30)`

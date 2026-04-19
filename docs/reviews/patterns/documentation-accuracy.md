---
id: documentation-accuracy
category: code-quality
created: 2026-04-09
last_updated: 2026-04-14
ref_count: 2
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

### 6. `DRAWER_MAX` comment claims dynamic viewport ratio, but value is hardcoded

- **Source:** github-claude | PR #38 round 2 | 2026-04-10
- **Severity:** LOW
- **File:** `src/features/workspace/components/BottomDrawer.tsx`
- **Finding:** Comment read `// Resizable hook - default 400px (50% of 800px), min 150px, max 640px (80% of 800px)`. The `80% of 800px` phrasing implied a computed ratio of window height, but `DRAWER_MAX = 640` was an unconditional constant. On a 1080px display 80% would be 864px, not 640px.
- **Fix:** Rewrite comment to clearly state the values are fixed pixels and explain how to adjust them.
- **Commit:** `0c8f0ac fix: address Claude review round 12 findings`

### 7. `MockFileSystemService.readFile` comment mismatches behavior

- **Source:** github-claude | PR #38 round 3 | 2026-04-10
- **Severity:** LOW
- **File:** `src/features/files/services/fileSystemService.ts`
- **Finding:** Comment said `// Mock implementation - returns empty content` but the method resolved with `'// Mock file content'`. Tests expecting an empty baseline would see unexpected dirty state.
- **Fix:** Align comment with actual behavior: "returns placeholder content for browser/test mode".
- **Commit:** `3aa2c5d fix: address Claude review round 9 findings`

### 8. `handleSave` memoization comment creates false confidence

- **Source:** github-claude | PR #38 round 3 | 2026-04-10
- **Severity:** LOW
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** Comment claimed `useCallback` memoization prevents the dialog focus-trap from re-binding on each render. The reasoning was wrong: the focus-trap effect depends on `onCancel`, not `onSave`, and `editorBuffer` is a plain object rebuilt on every `useEditorBuffer` render (every keystroke) so `handleSave`'s identity is actually unstable. Harmless in practice (the dialog captures focus while open) but the comment created false confidence.
- **Fix:** Replace with an accurate description of the current situation and a note for future refactors (destructure stable callbacks from `editorBuffer` if it's memoized later).
- **Commit:** `38292c7 fix: address Claude review round 15 findings`

### 9. Brittleness note suggested a fix that wouldn't compile

- **Source:** github-claude | PR #43 round 4 | 2026-04-11
- **Severity:** LOW
- **File:** `src/features/editor/hooks/useCodeMirror.test.ts`
- **Finding:** A JSDoc brittleness note on the `readScrollTargetPos` test helper advised future maintainers to harden the effect-type check by writing `effect.is(EditorView.scrollIntoView)`, stating it "IS a `StateEffectType` comparable via `effect.is(scrollIntoView)`". This is wrong on two counts: `EditorView.scrollIntoView` is a factory function with signature `(pos, options?) => StateEffect<ScrollTarget>`, not a `StateEffectType`, and `StateEffect.is()` accepts a `StateEffectType`, not a factory. A developer following the comment's guidance would hit a compile error, then waste time investigating why the "correct" fix doesn't work.
- **Fix:** Rewrite the brittleness note to correctly describe `EditorView.scrollIntoView` as a factory, explain that CM6 does not publicly export the underlying `StateEffectType`, show the actual escape hatch (`EditorView.scrollIntoView(0).type` reads the underlying type off a throwaway instance), and recommend fixing the duck-type shape directly rather than hardening the type comparison in the common case.
- **Commit:** `21d7c00 docs(editor): fix incorrect StateEffectType comment in round-4 brittleness note`

### 10. Agent status spec names removed transcript function

- **Source:** github-claude | PR #63 round 1 | 2026-04-14
- **Severity:** LOW
- **File:** `docs/superpowers/specs/2026-04-12-agent-status-sidebar/CLAUDE.md`
- **Finding:** The implementation notes referenced `TranscriptState::start_if_not_exists`, but the implementation had moved to `start_or_replace`. The same note described a double-check locking algorithm that the code did not yet implement at the time of review.
- **Fix:** Update the note to name `start_or_replace` and describe the current double-check flow after the transcript watcher locking fix.
- **Commit:** (pending — agent-status-sidebar PR)

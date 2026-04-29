---
id: documentation-accuracy
category: code-quality
created: 2026-04-09
last_updated: 2026-04-29
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

### 11. Skill spec uses commit-trailer variable that is never assigned

- **Source:** github-claude | PR #112 round 1 | 2026-04-29
- **Severity:** HIGH
- **File:** `plugins/harness/skills/github-review/SKILL.md`
- **Finding:** Step 6.6 of the github-review skill emits `GitHub-Review-Processed-Claude: ${LATEST_CLAUDE_ID:-}` into the commit-trailer template, but Step 2A only computes the full `LATEST_CLAUDE` JSON object — it never derives the scalar `LATEST_CLAUDE_ID`. The trailer always expands to the empty string, so the next cycle's `extract_trailer "GitHub-Review-Processed-Claude"` returns empty, `CLAUDE_HANDLED_IDS` stays empty, and the same already-fixed Claude comment is re-processed forever. Any spec that names a variable in one step and assumes it exists in another must derive it explicitly.
- **Fix:** Add `LATEST_CLAUDE_ID=$(jq -r 'if . == null then "" else (.id | tostring) end' <<< "$LATEST_CLAUDE")` immediately after the `LATEST_CLAUDE=$(...)` block in Step 2A. Use `if . == null` so an unprocessed-set-empty cycle still yields `LATEST_CLAUDE_ID=""` (jq's default `// empty` would error on null).
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 12. Spec mandates a convention then violates it two steps later

- **Source:** github-claude | PR #112 round 2 | 2026-04-29
- **Severity:** MEDIUM
- **File:** `plugins/harness/skills/github-review/SKILL.md`
- **Finding:** Step 6.8 explicitly prohibits `for x in $(jq -c ...)` due to JSON word-splitting and mandates `while IFS= read -r x; done < <(...)`. Step 6.9 (resolveReviewThread loop) immediately uses the prohibited form: `for thread_id in $(list_thread_ids_to_close); do ... done`. PRRT\_ IDs have no embedded spaces today, so this is safe in practice, but the inconsistency two steps after the rule is stated will silently corrupt iteration if the ID format changes — and contributors copying from this file would propagate the anti-pattern.
- **Fix:** Apply the same pattern Step 6.8 mandates: `while IFS= read -r thread_id; do ...; done < <(list_thread_ids_to_close)`. Also added a `[ -z "$thread_id" ] && continue` guard for empty-line input safety.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 13. Cleanup-recovery doc cross-references loop_start_scan placement incorrectly

- **Source:** github-claude | PR #112 round 2 | 2026-04-29
- **Severity:** LOW
- **File:** `plugins/harness/skills/github-review/references/cleanup-recovery.md`
- **Finding:** The cross-reference said "`loop_start_scan` runs at the start of Step 1 (BEFORE input resolution)". But Step 0 is the input-resolution step in this skill's pipeline; Step 1 is "Resolve PR_BASE." SKILL.md actually places `loop_start_scan` in the Bootstrap section (before Step 0). A maintainer following this cross-reference during a refactor would relocate it to Step 1, after PR state has already been read.
- **Fix:** Rewrite the cross-reference to: "`loop_start_scan` runs in the Bootstrap section, before Step 0 (input resolution). It must execute before any step reads or writes PR state." The "must execute before" framing makes the load-bearing position explicit.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 14. Pattern-kb source-label list missed the human-reviewer source

- **Source:** github-codex-connector | PR #112 round 2 | 2026-04-29
- **Severity:** P2 / MEDIUM
- **File:** `plugins/harness/skills/github-review/references/pattern-kb.md`
- **Finding:** Step 6.2's pattern-entry schema lists allowed `Source:` reviewer labels as `<github-claude | github-codex-connector | local-codex>` — missing a label for human findings (Step 2D source `human`). Without a label, downstream cycles either invent ad-hoc names (`human-reviewer`, `human`, etc.) or silently default to one of the bot labels, breaking the pattern-source taxonomy.
- **Fix:** Extend the allowed list to include `github-human` and document the meaning ("a non-bot GitHub account commenting on a PR"). Also extended `docs/reviews/CLAUDE.md` § Source labels — the index doc that lists the closed label set — to include `github-human` so the two stay in sync.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 15. SKILL.md as orchestrator vs progressive-disclosure for reference details

- **Source:** github-human | PR #112 round 2 | 2026-04-29
- **Severity:** HUMAN
- **File:** `plugins/harness/skills/github-review/SKILL.md`
- **Finding:** SKILL.md should be the orchestrator entry-point — describes WHAT each step does and the contract between steps. Long inline bash blocks (>10 lines) for input resolution, reconciliation, etc. should live in the corresponding `references/<step>.md` file. The `scripts/` directory should ONLY hold sourceable / executable shell scripts (helpers.sh, verify.sh) — not one-off bash for a single step. Without the discipline, SKILL.md becomes a 600+ line scroll-fest and the entry-point's WHAT/HOW separation collapses.
- **Fix:** Extracted Step 0's input-resolution bash (~38 lines) into a new `references/input-resolution.md` (with worktree recipe + per-error-case prompts). Trimmed Step 1's bash (~17 lines) to a brief operational summary citing `references/commit-trailers.md` § Step 1 — Reading trailers back. Updated the File-structure section to add the new reference + a "where to look for what" preamble describing the orchestrator-vs-references discipline.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 16. SKILL.md missing Q&A / Troubleshooting section

- **Source:** github-human | PR #112 round 2 | 2026-04-29
- **Severity:** HUMAN
- **File:** `plugins/harness/skills/github-review/SKILL.md`
- **Finding:** When a cycle gets stuck (verify times out, branch mismatch, plugin cache out of sync, max-rounds hit), users had to read through `incident.md` or chase cross-references to figure out the recovery. No quick lookup table of "symptom → likely cause → fastest fix" — recovery friction wasted dogfood iteration time in cycle 1.
- **Fix:** Added a `## Troubleshooting / Q&A` section near the end of SKILL.md (before the final Cleanup link) with 9 terse Q+A entries: branch mismatch, verify timeout/error, reconciliation lag, commitlint nits, plugin cache sync, max-rounds, GraphQL bot-suffix difference, INDEX_TOUCHED missing.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

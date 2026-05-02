---
id: documentation-accuracy
category: code-quality
created: 2026-04-09
last_updated: 2026-04-30
ref_count: 13
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

### 17. Bootstrap calls `loop_start_scan` not defined in the only sourced file

- **Source:** github-claude | PR #112 round 3 | 2026-04-29
- **Severity:** MEDIUM
- **File:** `plugins/harness/skills/github-review/SKILL.md`
- **Finding:** SKILL.md Bootstrap sources only `$SKILL_DIR/scripts/helpers.sh`, which previously defined exactly two functions: `paginated_review_threads_query` and `extract_trailer`. Bootstrap then called `loop_start_scan` with the comment `# defined in references/cleanup-recovery.md`. That function lived inside a markdown code block in `cleanup-recovery.md`, never sourced — so under `set -euo pipefail` Bootstrap exited with `command not found: loop_start_scan` on first execution. This contradicted SKILL.md's own header claim "Read references on-demand from the per-step 'see' links — none of them are required to start a run." Worse, an AI agent recovering from the failure could synthesize a simplified `loop_start_scan` that auto-deletes aborted dirs (the load-bearing forensics guarantee).
- **Fix:** Moved both `loop_start_scan` and `cleanup_on_clean_exit` from `references/cleanup-recovery.md` into `scripts/helpers.sh` as canonical implementations. Marked the markdown copies in `cleanup-recovery.md` as illustrative with a pointer to `helpers.sh`. Bootstrap now successfully calls both helpers because they are part of the sourced file.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 18. `extract_trailer` doc claims deduplication but pipeline has no `sort -u`

- **Source:** github-claude | PR #112 round 3 | 2026-04-29
- **Severity:** LOW
- **File:** `plugins/harness/skills/github-review/scripts/helpers.sh`
- **Finding:** `extract_trailer`'s function header stated "deduplicated by line, blanks stripped" but the pipeline `tr ',' '\n' | awk 'NF' | tr '\n' ',' | sed 's/,$//'` only stripped blanks — no `sort -u` or `uniq`. If the same trailer key appeared in multiple commits within `PR_BASE..HEAD` (cherry-picks, accidental double-commits), output contained duplicate values. Current consumers use `jq`'s `index()` membership test which tolerates duplicates, but the false doc contract risked misleading any future consumer that did length-based set arithmetic. The same-codebase inconsistency was particularly confusing because `commit-trailers.md`'s `CLAUDE_HANDLED_IDS` derivation correctly used `sort -u` for the union of two trailer sources.
- **Fix:** Added `| sort -u` between `awk 'NF'` and `tr '\n' ','` in the pipeline. Implementation now matches the doc claim and the sibling `CLAUDE_HANDLED_IDS` derivation.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 19. `classify_cycle` pseudocode declares only two states while prose mandates three

- **Source:** github-claude | PR #112 round 5 | 2026-04-29
- **Severity:** MEDIUM
- **File:** `plugins/harness/skills/github-review/references/empty-state-classification.md`
- **Finding:** The mixed-state prose rule above the pseudocode reads "if at least one reviewer is case 2, the cycle proceeds" and the human-comment exception says human findings have cases 1, 2, and 3 — so the classification surface is three reviewers, not two. The pseudocode however declared only `local claude_state codex_state` and tested only those two in the FIX / EXIT_CLEAN / POLL_NEXT chain. An LLM agent following the pseudocode literally would let a cycle with `claude_state=case_1`, `codex_state=case_1`, but a real new human comment fall through to POLL_NEXT, silently discarding the human finding. Same family as documentation-accuracy #11 (Bootstrap script-path docs vs runtime), #17 (`loop_start_scan` defined-but-not-sourced), and error-surfacing #15 (incomplete propagation of an earlier reviewer-surface addition). Human reviewers were added as Step 2D after the original Claude+connector pseudocode was authored; the prose was updated, the bash skeleton was not.
- **Fix:** Added `human_state` to the `local` declaration. Derived case_1/case_2 from `$HUMAN_FINDINGS_COUNT` (humans have no case 4/5 per the prose human-comment exception). Extended the FIX check with `|| [ "$human_state" = "case_2" ]`. Guarded EXIT_CLEAN with `[ "$human_state" != "case_2" ]` (treating case_1 as exit-eligible since humans don't emit explicit "clean" verdicts — absence is the closest equivalent). Inline comments document the human-side asymmetry so a future reader sees why the LOUD_FAIL guard wasn't extended to `human_state`.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 20. SKILL.md Bootstrap comment cites `cleanup-recovery.md` for `loop_start_scan` after it moved to `helpers.sh`

- **Source:** github-claude | PR #112 round 5 | 2026-04-29
- **Severity:** LOW
- **File:** `plugins/harness/skills/github-review/SKILL.md`
- **Finding:** Cycle 3 (finding #17 above) moved `loop_start_scan` and `cleanup_on_clean_exit` out of `references/cleanup-recovery.md` (where they had lived as illustrative bash) and into `scripts/helpers.sh` as canonical implementations, with `cleanup-recovery.md` re-marked as illustrative copy with a pointer to `helpers.sh`. The Bootstrap-section comment at SKILL.md:181 was missed by that move and still read `loop_start_scan   # defined in references/cleanup-recovery.md`. An LLM agent or developer debugging a `loop_start_scan` failure would follow that comment to a file that explicitly says "illustrative copy; edit helpers.sh first" — but might attempt to fix the illustrative copy first if not careful, leaving the canonical source unchanged. Stale-after-refactor doc class, same family as #11 (Bootstrap script-path docs) and #17 itself.
- **Fix:** Replaced the comment with `# defined in scripts/helpers.sh (mirrored in references/cleanup-recovery.md)`. The sourced filename is now primary, the illustrative mirror parenthetical, matching the post-cycle-3 authoritative-source layout.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 21. `helpers.sh` header documents the `dirname "$0"` sourcing pattern that SKILL.md explicitly replaces

- **Source:** github-claude | PR #112 round 5 | 2026-04-29
- **Severity:** LOW
- **File:** `plugins/harness/skills/github-review/scripts/helpers.sh`
- **Finding:** Lines 4–7 of `helpers.sh` instructed readers to source the file with `source "$(dirname "$0")/scripts/helpers.sh"`. SKILL.md's Bootstrap section spends a full paragraph explaining why this fails in a skill context: in an interactive shell (which is what runs the skill body), `$0` is the shell binary's name (`bash`), so `dirname "$0"` resolves to `/usr/bin` and the source path becomes `/usr/bin/scripts/helpers.sh` — a spurious file-not-found that would mask every later step. SKILL.md's Bootstrap replaces this with a hardcoded repo-relative path (`SKILL_DIR="plugins/harness/skills/github-review"; source "$SKILL_DIR/scripts/helpers.sh"`) plus a `git rev-parse` fallback. A developer or agent reading only `helpers.sh` to learn how to invoke it would copy the documented-but-broken pattern into a new script and hit the same failure without SKILL.md's explanatory bootstrap guard. Doc-vs-authoritative-usage divergence after SKILL.md was refactored, same family as #20 above and #17 (canonical-source migration leaving stale pointers behind).
- **Fix:** Replaced the `dirname "$0"` example in the header with the repo-relative form from SKILL.md, and added a one-line cross-reference to SKILL.md § Bootstrap so anyone learning to source helpers.sh sees the rationale (interactive `$0` quirk) before trying the broken alternative.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 22. architect.md embeds design-philosophy concepts but omits the cross-reference planner.md carries

- **Source:** github-claude | PR #114 round 1 | 2026-04-30
- **Severity:** LOW
- **File:** `agents/architect.md`
- **Finding:** PR #114 added bullets to two architect.md sections — "1. Modularity & Separation of Concerns" gained "Deep modules" and "Information hiding" lines extracted directly from the new `rules/common/design-philosophy.md`, and "Red Flags" gained "Shallow Abstraction" and "Leaky Interface" anti-patterns from the same source. The sibling `agents/planner.md` was given an explicit "Apply `rules/common/design-philosophy.md`: prefer strategic changes…" pointer in its Pattern Identification step. architect.md got the concepts inline but no pointer back to the source file. An architect agent making a deep design trade-off would see the summary bullets but not know to open `design-philosophy.md` for the full Complexity Budget, Interface Discipline, and Review Heuristics sections. Same family as #20 (stale cross-references after sibling-file refactor) and #21 (doc-vs-authoritative-usage divergence) — sibling docs land their borrowed concepts but the back-pointer to the canonical source is missed.
- **Fix:** Added a single cross-reference bullet at the end of "### 1. Modularity & Separation of Concerns" — placed adjacent to the existing deep-module and information-hiding bullets so readers see the source pointer right where the embedded concepts appear: "See `rules/common/design-philosophy.md` for the full depth-vs-shallowness rationale, complexity budget guidance, and interface discipline review heuristics that inform these principles and the Red Flags below". Mirrors the planner.md "Apply" approach, costs one bullet, closes the gap between architect's inline embedding and planner's explicit pointer.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 23. rules/CLAUDE.md common-files count off-by-one after adding design-philosophy.md

- **Source:** github-claude | PR #114 round 2 | 2026-04-30
- **Severity:** LOW
- **File:** `rules/CLAUDE.md`
- **Finding:** Line 9 of `rules/CLAUDE.md` was bumped from `(11 files)` to `(12 files)` by this PR. `ls rules/common/` confirms 13 files are actually present after `design-philosophy.md` was added. The pre-PR count was already stale (claimed 11, actual 12), and the PR incremented by 1 to 12 instead of recounting — so it kept the off-by-one rather than fixing it. Agents reading the structural-tree comment to verify directory completeness would stop at 12 and miss the 13th file. Same off-by-one-after-stale-baseline class as #2 (broken design path mock) and #3 (wrong dev server port): a number-bearing doc gets nudged by the immediate diff without re-deriving from ground truth.
- **Fix:** Changed `(12 files)` to `(13 files)` on line 9. Re-derived from `ls rules/common/ | wc -l` rather than incrementing the stale baseline. The pre-existing inconsistency that pre-dates this PR is corrected as part of the same fix since it is in the line we are touching anyway and Claude flagged the resulting number specifically.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 24. code-reviewer.md severity ordering broken — MEDIUM section landed mid-HIGH block

- **Source:** github-claude | PR #114 round 3 | 2026-04-30
- **Severity:** MEDIUM
- **File:** `agents/code-reviewer.md`
- **Finding:** The review checklist in `agents/code-reviewer.md` is severity-ordered (CRITICAL → HIGH → MEDIUM → LOW). The new `### Design Complexity (MEDIUM)` section was inserted between `### Code Quality (HIGH)` and `### React/UI Patterns (HIGH)`, with three more HIGH sections following before the next MEDIUM (`### Performance (MEDIUM)`). An LLM reviewer iterating the file linearly would hit a MEDIUM mid-HIGH and de-prioritize subsequent HIGH sections, weakening the implicit priority signal that document order conveys. Theme: doc structure carries semantic meaning that text-content-only reviews miss — placement = priority hint.
- **Fix:** Moved the Design Complexity section out of L116–135 (between Code Quality and React/UI) and re-inserted it immediately before Performance (MEDIUM) and after Backend Patterns (HIGH). Final ordering is now contiguous-by-severity: Security (CRITICAL) → Code Quality (HIGH) → React/UI Patterns (HIGH) → Tauri/IPC Patterns (HIGH) → Backend Patterns (HIGH) → Design Complexity (MEDIUM) → Performance (MEDIUM) → Best Practices (LOW). The thematic pairing with Code Quality (the IDEA's stated authoring intent) is preserved at zero cost — Design Complexity still appears in the same overall MEDIUM-band region readers expect.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 25. design-philosophy.md error-handling rule has missing pronoun "it"

- **Source:** github-claude | PR #114 round 3 | 2026-04-30
- **Severity:** LOW
- **File:** `rules/common/design-philosophy.md`
- **Finding:** Line 80 read "Retry or mask the failure only when the module can prove that is safe." The pronoun "it" was missing — should be "prove that it is safe." Ungrammatical and the referent of "that" was ambiguous (the failure? the masking action? the module state?) in a rule about when error masking is permissible. Agents reading the rule for guidance might infer broader permission to mask failures from the looser-than-intended phrasing.
- **Fix:** Inserted the missing pronoun: "prove that is safe" → "prove that it is safe" on line 80. Single-character semantic addition, no structural change.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 26. Multi-paragraph JSDoc on extracted utility violates one-line comment rule

- **Source:** github-claude | PR #115 round 2 | 2026-04-30
- **Severity:** LOW
- **File:** `src/features/agent-status/utils/format.ts`
- **Finding:** Round-1 review-fix added a 10-line JSDoc block on the extracted `formatTokens` utility, listing the three threshold buckets and explaining the intentional non-consolidation with `ContextBucket`'s formatter. The first paragraph describes WHAT the code does — directly readable from the three-line implementation. CLAUDE.md is explicit: "Never write multi-paragraph docstrings or multi-line comment blocks — one short line max" and "Don't explain WHAT the code does, since well-named identifiers already do that." Only the non-obvious WHY (the deliberate split from ContextBucket) qualifies under the allowed exception. The over-documentation is a common artefact of extracting a utility from a component — authors often over-explain at the point of extraction.
- **Fix:** Collapsed the 10-line block to a single line capturing only the non-obvious WHY: `// Not consolidated with ContextBucket's M-aware formatter — would change that component's display.` Threshold bucket list deleted; the implementation is the spec.
- **Commit:** `eadee9c fix(agent-status): address Claude review on TokenCache (PR #115 round 2)`

### 27. Placeholder commit SHAs left unfilled in pattern-file finding entries

- **Source:** github-claude | PR #115 round 3 | 2026-04-30
- **Severity:** LOW
- **File:** `docs/reviews/patterns/accessibility.md` (and three sibling pattern files)
- **Finding:** Round-1 and round-2 review-fix commits each appended pattern-file entries documenting the resolved findings, but every entry's `**Commit:**` field carried the literal template string `\`<COMMIT_SHA_PLACEHOLDER>\``instead of the actual short SHA. Four files affected:`accessibility.md:125`, `module-boundaries.md:33`, `testing-gaps.md:99`, `documentation-accuracy.md:251`. The placeholder is a doc-first authoring artifact — the pattern entry was written before the commit existed and the author forgot to fill the SHA after committing. Future agents and contributors that try `git show <COMMIT_SHA_PLACEHOLDER>` to trace a finding's fix get a git error instead of the diff. Left unaddressed across enough cycles, the knowledge base loses its core traceability value.
- **Fix:** Replaced every occurrence with the short SHA of the originating commit: round-1 entries → `570d225`, round-2 entries → `eadee9c`. (Claude only flagged three of the four files; `testing-gaps.md` carried the same bug pattern from the round-2 commit and was caught and fixed under the same scope as a same-class issue, not a drive-by. A future-work follow-up could add a pre-commit hook that rejects the literal string `<COMMIT_SHA_PLACEHOLDER>` under `docs/reviews/patterns/` to prevent recurrence; out of scope for this cycle.)
- **Commit:** _(see git log for the round-3 fix commit)_

### 28. Unused `export default TokenCache` is dead code in a feature module that uses named exports only

- **Source:** github-claude | PR #115 round 3 | 2026-04-30
- **Severity:** LOW
- **File:** `src/features/agent-status/components/TokenCache.tsx`
- **Finding:** Line 182 read `export default TokenCache`, alongside the existing `export const TokenCache` at line ~107. Both consumers in this PR (`AgentStatusPanel.tsx:5` and `TokenCache.test.tsx:3`) import via `{ TokenCache }`, and every other component in `src/features/agent-status/components/` (StatusCard, ContextBucket, ToolCallSummary, etc.) exports named-only. The default export was a scaffolding-convention artefact with no current callers. Risk is drift: a future contributor seeing both forms might assume the default is canonical and write `import TokenCache from './TokenCache'` in a new file, breaking module-style consistency across the feature.
- **Fix:** Removed line 182 (`export default TokenCache`). Named export remains; both existing importers continue to work unchanged. If a default ever becomes necessary (e.g., for `React.lazy`), add it at the point of need.
- **Commit:** _(see git log for the round-3 fix commit)_

### 29. Bare shell glob in copy-pasteable ffmpeg one-liner silently misfires on multiple or zero matches

- **Source:** github-claude | PR #121 round 1 | 2026-05-01
- **Severity:** LOW
- **File:** `docs/media/CLAUDE.md`
- **Finding:** The capture-pipeline guide showed `ffmpeg -y -i docs/media/Kooha-*.webm \ ...` as the conversion step. Because the shell expands the glob in argument position, two failure modes are silent: (a) if multiple Kooha recordings exist (a re-record left behind), ffmpeg receives them all as separate `-i` inputs but the single-stream filter chain only reads the first — the contributor thinks they converted their latest take but the GIF comes from whichever WebM sorts first; (b) if no file matches, the literal pattern is passed through and ffmpeg fails opaquely with `No such file or directory`. Either way, no diagnostic surfaces "you have multiple takes" or "you have none."
- **Fix:** Replaced the glob with explicit selection of the newest file via `WEBM=$(ls -t docs/media/Kooha-*.webm 2>/dev/null | head -1)` and a guard `[ -z "$WEBM" ] && { echo "No Kooha WebM in docs/media/" >&2; exit 1; }`. The conversion uses `"$WEBM"` so the choice is unambiguous and the empty case fails loudly with a readable message.
- **Commit:** _(see git log for the round-1 fix commit)_

### 30. `<sub align="center">` is a no-op — caption renders left-aligned under centered image

- **Source:** github-claude | PR #121 round 1 | 2026-05-01
- **Severity:** LOW
- **File:** `README.md`, `README.zh-CN.md`
- **Finding:** Both READMEs centered the agent-status-sidebar caption with `<sub align="center">…</sub>`. `<sub>` is phrasing content; the `align` attribute has no effect on inline elements and GitHub's Markdown renderer ignores it. Result: the caption rendered left-aligned beneath a centered image, breaking the visual unit. The hero caption two sections higher rendered correctly only because it was wrapped in a `<div align="center">` block, not because of any attribute on `<sub>`.
- **Fix:** Wrapped the caption in `<p align="center">` so the centering applies at the block level: `<p align="center"><sub>…</sub></p>`. Mirror update applied to `README.zh-CN.md` for bilingual parity.
- **Commit:** _(see git log for the round-1 fix commit)_

### 31. `progress.yaml` step flipped to `done` but sibling `pr` field left `null`

- **Source:** github-claude | PR #121 round 2 | 2026-05-01
- **Severity:** LOW
- **File:** `docs/roadmap/progress.yaml`
- **Finding:** When `p4-d6` was promoted to `status: done` (manual end-to-end verification satisfied via the hero gif), the sibling `pr` field was left `null`. Every other completed step in Phase 4 records its closing PR (`p4-d3 → 63`, `p4-d4 → 57`, `p4-d5 → 49`), so the gap breaks the per-step traceability the schema was built for. Tooling that walks `pr` fields to auto-generate release notes or to cross-reference to GitHub silently skips the orphaned step. Same finding-class as #5 (phase dependency drift): a single edit to `progress.yaml` left adjacent fields out of sync with the new state.
- **Fix:** Set `pr: 121` on `p4-d6`. `commit` remains `null` until the PR squash-merges (matches the populate-on-merge pattern of D1-D5).
- **Commit:** _(see git log for the round-2 fix commit)_

### 32. Vacuous-truth guard `!items.is_empty() &&` before `Iterator::any` is dead code

- **Source:** github-claude | PR #122 round 1 | 2026-05-01
- **Severity:** LOW
- **File:** `src-tauri/src/agent/transcript.rs`
- **Finding:** `is_user_prompt` had `!items.is_empty() && items.iter().any(|item| !is_tool_result_block(item))`. Rust's `Iterator::any` returns `false` on an empty iterator (vacuous-truth short-circuit), so the explicit emptiness guard is logically redundant — both halves return the same bool for empty slices. The guard creates the misleading impression that there's a distinct empty-array code path; a future maintainer adding a parallel item-type predicate may copy the pattern, wonder why the empty check exists, and spend time verifying it's necessary. Same finding-class as #28 (unused `export default TokenCache` dead code) — surface area that does nothing.
- **Fix:** Removed `!items.is_empty() &&`. Expression is now `items.iter().any(|item| !is_tool_result_block(item))`, which still returns `false` for empty slices and all-`tool_result` slices.
- **Commit:** _(see git log for the round-1 fix commit)_

### 33. Asymmetric whitespace handling between paired user-prompt content paths

- **Source:** github-claude | PR #122 round 2 | 2026-05-01
- **Severity:** LOW
- **File:** `src-tauri/src/agent/transcript.rs`
- **Finding:** `is_user_prompt` had two content paths: a string-typed path that correctly checked `!text.trim().is_empty()`, and an array-typed path that returned `true` for ANY non-`tool_result` block — including `{"type":"text","text":"   "}` whitespace-only text blocks. A user message with whitespace-only text inside an array form would falsely emit an `agent-turn` event and increment `numTurns`, while the same whitespace as a plain string would not. The two paths were intended to be semantically equivalent but drifted: the string path predates the array path; when the array path was added it focused on the structural "is there a non-tool_result block?" question and skipped porting the content-emptiness guard. Same finding-class as #2 (broken design reference path): paired surfaces fall out of sync when one is edited without the other.
- **Fix:** Extracted a `is_non_empty_user_block(item)` helper that excludes `tool_result`, requires non-whitespace `text` content for `text` blocks, and accepts other types (image, document, etc.) by default. The array path now reads `items.iter().any(is_non_empty_user_block)`, producing symmetric whitespace handling with the string path.
- **Commit:** _(see git log for the round-2 fix commit)_

### 34. Stale fixture-shape comment after adding a sixth fixture line

- **Source:** github-claude | PR #122 round 3 | 2026-05-01
- **Severity:** LOW
- **File:** `src-tauri/tests/transcript_turns.rs`
- **Finding:** The round-2 fix added a 6th fixture line (a second `assistant tool_use` needed to seed the `in_flight` map for the mixed-content user message at line 6) but the fixture-header comment still read `"Five-line fixture covers four message shapes"` and enumerated five shape entries (1–5). The comment under-counted both lines (5 → 6) and shapes (4 → 5), leaving readers to count by hand and risking a future maintainer mis-deriving the expected event count. Same finding-class as #28 (unused default export drifts from active surface) and #1 (TerminalPane WebGL doc claim after addon removal): inline doc that doesn't track adjacent change.
- **Fix:** Updated the comment to `"Six-line fixture covers five message shapes:"` and added the 5th enumerated shape entry (the seeding `assistant tool_use`). Comment now matches the fixture line-by-line.
- **Commit:** _(see git log for the round-3 fix commit)_

### 35. `Number()` coercion miscommunicates u32 binding shape

- **Source:** github-claude | PR #122 round 3 | 2026-05-01
- **Severity:** LOW
- **File:** `src/features/agent-status/hooks/useAgentStatus.ts`
- **Finding:** `Number(event.payload.numTurns)` wrapped a value already typed `number` in the `AgentTurnEvent` ts-rs binding. Other `Number()` calls in this file are deliberate u64/i64 normalizations (where serde-json may emit values past `Number.MAX_SAFE_INTEGER`); applying the same pattern to a u32 field falsely implies the same hazard exists. A future reviewer might either (a) propagate the no-op pattern to other genuinely-`number` fields for "consistency" or (b) "fix" the apparent confusion by removing the legitimate u64 coercions elsewhere. Either path harms the codebase. Same finding-class as #6 (DRAWER_MAX comment claimed dynamic ratio but value was constant): a mechanism's adjacent doc/code suggests guarantees it doesn't actually provide.
- **Fix:** Removed the `Number()` wrapper and added an inline comment explaining why u32 fields don't need bigint coercion (`u32` tops out at ~4.3 billion, well within JS safe-integer space). Pattern now is: u64/i64 → coerce; u32/i32/smaller → use directly.
- **Commit:** _(see git log for the round-3 fix commit)_

### 36. Inline magic-number bound for shutdown latency had no name in a file with named timing peers

- **Source:** github-claude | PR #124 round 2 | 2026-05-02
- **Severity:** LOW
- **File:** `src-tauri/src/git/watcher.rs`
- **Finding:** `spawn_trailing_debounce_thread` used `Duration::from_millis(100)` inline for the outer-loop `recv_timeout` value. That 100ms knob bounds shutdown latency from `stop_flag` set → thread exit when no burst is in flight, but it sat unnamed next to two top-level constants (`DEBOUNCE_MS`, `POLL_INTERVAL_SECS`) that had explanatory comments documenting their role. A future maintainer changing `DEBOUNCE_MS` for tuning could easily wonder why shutdown latency didn't change, or pick an arbitrary tweak to this third value without realizing what it controls. Same finding-class as #6 (`DRAWER_MAX` comment claimed dynamic ratio for a hardcoded constant): the magnitude of the value is right but the surface around it doesn't communicate intent.
- **Fix:** Extracted `const IDLE_CHECK_MS: u64 = 100;` next to the existing constants with a comment explaining: "Outer-loop poll interval for the debounce thread — bounds the latency from `stop_flag` being set to thread exit when idle. 100 ms is roughly one Linux scheduler quantum." `recv_timeout` now reads `Duration::from_millis(IDLE_CHECK_MS)`. Same surface area, but the relationship between the value and its purpose is now explicit.
- **Commit:** _(see git log for the round-2 fix commit)_

### 37. Error-message count conflates two failure classes routed through the same accumulator

- **Source:** github-claude | PR #126 round 2 | 2026-05-02
- **Severity:** LOW
- **File:** `src-tauri/src/git/watcher.rs`
- **Finding:** `upgrade_to_repo_watcher`'s error accumulator `errors: Vec<String>` was the natural sink for two distinct failure classes: (a) per-subscriber upgrade failures inside the for-loop (subscribers that need restoring), and (b) the restore-path's own failure (a lock-poisoning state-level event that affects no specific subscriber). The combined Err message read `"{} subscriber(s) failed to upgrade"` with `errors.len()` — but that count includes both classes. If a state-level restore failure occurred, the count over-reports subscriber failures by one, misleading any tooling or human that parses the count as authoritative. The full text was always present in the trailing `errors.join("; ")`, so information wasn't lost — only the headline lied. Same finding-class as #6 (`DRAWER_MAX` comment claimed dynamic ratio for a constant): the surface around the value implies a guarantee the value doesn't actually provide.
- **Fix:** Added a dedicated `subscriber_failures: usize` counter, incremented only at the loop's `start_git_watcher_inner` failure site (the same site that pushes to `failed_subscribers`). Format string updated to `"{} subscriber(s) failed to upgrade ({} total error(s)): {}"` — headline reflects subscriber-level reality, parenthetical preserves the total-error context, full body keeps the unredacted error text. Restore-path errors continue to flow through the same `errors` vec but no longer inflate the headline.
- **Commit:** _(see git log for the round-2 fix commit)_

### 38. Restore-path entry leaks across pre-repo→repo transition because cleanup contract was unilateral

- **Source:** github-claude | PR #126 round 3 | 2026-05-02
- **Severity:** LOW (in production code) / HIGH transient (codex verify caught a refcount-loss bug in v1 of the fix)
- **File:** `src-tauri/src/git/watcher.rs` `start_git_watcher_inner` opportunistic cleanup
- **Finding:** PR #126's restore path inserted a new `pre_repo_watchers[safe_cwd].subscribers[missing_cwd]` row for terminally-stranded subscribers, but `start_git_watcher_inner`'s opportunistic cleanup block was unchanged from the pre-PR contract: it only removes `cwd_to_safe_pre_repo[cwd]`, not the matching `pre_repo_watchers[safe_cwd].subscribers[cwd]`. When a stranded subscriber's path eventually becomes a real repo and re-subscription routes through `start_git_watcher_inner` → repo path, the pre-repo entry is orphaned. Subsequent stop calls follow `cwd_to_toplevel` and never revisit `pre_repo_watchers`, so the bucket can't be GC'd. Same finding-class as #28 / #34 (paired surfaces drift when one is edited without the other) — the restore path added a new map row without extending the cleanup contract that consumes it.
- **Fix:** Captured `prior_pre_repo_safe_cwd` from the existing `cwd_to_safe_pre_repo.remove(cwd)`, then ran the matching `pre_repo_watchers` removal AFTER `resolve_toplevel(&safe_cwd).is_ok()` — i.e., only on the actual repo-transition path. **Codex verify v1 caught a HIGH refcount-loss regression in an earlier draft that ran the twin cleanup unconditionally:** on a still-pre-repo re-subscription (with duplicate subscriptions raising the refcount above 1), unconditional cleanup would drop the entry, then `start_pre_repo_watcher_inner` would see no existing bucket and recreate with `refcount=1`, silently losing N-1 subscriptions. Final fix gates the cleanup behind the repo-transition outcome so the still-pre-repo path is untouched.
- **Commit:** _(see git log for the round-3 fix commit; v1→v2 codex-verify retry documented in `.harness-github-review/cycle-3-verify-result-v{1,2}.json`)_

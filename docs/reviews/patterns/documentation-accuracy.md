---
id: documentation-accuracy
category: code-quality
created: 2026-04-09
last_updated: 2026-05-07
ref_count: 18
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

### 39. Eager `Arc<AtomicBool>` allocation hoisted before lock scope confuses ownership flow

- **Source:** github-claude | PR #126 round 4 | 2026-05-02
- **Severity:** LOW
- **File:** `src-tauri/src/git/watcher.rs` `restore_pre_repo_subscribers`
- **Finding:** `stop_flag = Arc::new(AtomicBool::new(false))` was hoisted before the `pre_repo_watchers` lock so the `else` branch could move it into the inserted watcher AND the later `spawn_pre_repo_poll_thread` call without cloning twice. But on the if-branch (existing watcher found), the local Arc was created, never stored, and silently dropped — dead allocation. Worse, a future maintainer reading the function would see a `stop_flag` in scope after the lock and might write code that observes it expecting it to match the watcher's flag — which is wrong on the if-branch where the watcher kept its own. Same finding-class as #6 / #36 — surface that suggests a guarantee the value doesn't actually provide.
- **Fix:** Replaced the eager `Arc::new(...)` with `let mut new_watcher_stop_flag: Option<Arc<AtomicBool>> = None;`. The `else` branch creates a fresh Arc, stores one clone in the inserted watcher, and saves the other in the Option. The poll-thread spawn block then uses `if let Some(stop_flag) = new_watcher_stop_flag` to act only when there's a new watcher to govern. No silent drops; the lifetime-and-ownership story is now explicit.
- **Commit:** _(see git log for the round-4 fix commit)_

### 40. `#[cfg(test)] fn` at module level is a rename artifact, not a test helper

- **Source:** github-claude | PR #128 round 1 | 2026-05-02
- **Severity:** LOW
- **File:** `src-tauri/src/agent/detector.rs`
- **Finding:** A rename of `read_cmdline` → `read_proc_cmdline` left a `#[cfg(test)] fn read_cmdline(pid) -> Option<Vec<String>> { ProcFsProcessSource.read_cmdline(pid) }` shim at MODULE level (outside `mod tests`) so two pre-existing tests (`reads_self_cmdline`, `handles_missing_pid_gracefully`) didn't need their call sites updated. Future readers see a `#[cfg(test)]` function alongside production code with no production callers and have to reason about whether it's a deprecated API, an internal-test seam, or a forgotten helper. Same finding-class as #28 (unused default export) — surface that does nothing in production but adds reader-overhead.
- **Fix:** Deleted the shim. Updated the two test call sites to call `read_proc_cmdline` directly. Production and test symbols are now cleanly separated; nothing at module level is gated on `#[cfg(test)]`.
- **Commit:** _(see git log for the round-1 fix commit)_

### 41. Truthy-check guard fires on `null` payload values, attributing the 400 to the wrong cause

- **Source:** github-claude | PR #130 round 3 | 2026-05-02
- **Severity:** LOW
- **File:** `vite.config.ts`
- **Finding:** Both stage and discard endpoints used `hunkIndex !== undefined && (typeof base === 'string' && base.trim() !== '')` to guard against the base+hunk mismatch. JSON `null` is `!== undefined`, so a payload `{ hunkIndex: null, base: 'main' }` triggered the rejection with "Hunk-level X not supported when a base= comparison is in effect" — blaming base-mode alignment when the actual problem is a malformed hunk index. The same payload without `base` falls through to `extractHunkPatch(..., null)` → returns `null` → 409 "Requested hunk no longer exists." Two paths, both meaning "no valid hunk index", surface as different errors. Same finding-class as #6 (DRAWER_MAX) — the message implies a guarantee the value doesn't actually provide.
- **Fix:** Tightened both guards from `hunkIndex !== undefined` to `typeof hunkIndex === 'number'`, matching `extractHunkPatch`'s own narrowing on the same value (it already returned `null` for non-numbers). The two endpoints now agree on what counts as "a hunk index is present", and the 400 only fires when there's actually a base-mode mismatch to flag.
- **Commit:** _(see git log for the round-3 fix commit)_

### 42. Pre-checks survive past their structural replacements, misrepresenting what downstream validation actually enforces

- **Source:** github-claude | PR #130 round 5 | 2026-05-02
- **Severity:** LOW
- **File:** `src/features/diff/services/gitPatch.ts`
- **Finding:** Round-1 added `!baseBranch.startsWith('-')` and `!baseBranch.includes('\0')` as defence-in-depth against git option injection and NUL-termination injection. Round-3 then narrowed `SAFE_BASE_BRANCH_REGEX` to `[a-zA-Z0-9_]` first-char + `[a-zA-Z0-9_/.-]*` trailing, which structurally excludes both vectors. The pre-checks survived as belt-and-braces but a reader scanning `isSafeBaseBranch` in isolation would conclude that the regex MUST permit `-`-prefix and NUL — the opposite of reality. Same finding-class as #6 / #36 — adjacent surface that misrepresents the downstream guarantee.
- **Fix:** Removed the redundant `!startsWith('-')` and `!includes('\0')` checks. Expanded the comment block above `SAFE_BASE_BRANCH_REGEX` to spell out exactly which vectors the first-character class blocks. Kept `!includes('..')` with a "NOT redundant" rationale: the regex's trailing class permits a single `.`, but two-dot and three-dot ranges are sequences of permitted characters that change `git diff` semantics, so the explicit check is load-bearing. The lesson: when defence-in-depth and structural enforcement converge on the same vector, drop the soft check and document the structural enforcement at the regex.
- **Commit:** _(see git log for the round-5 fix commit)_

---

### 43. "Test-only public surface" doc comment on production types misleads about lifecycle, risking silent gating breakage

- **Source:** github-claude | PR #152 round 7 (cycle 9) | 2026-05-03
- **Severity:** LOW
- **File:** `src-tauri/src/agent/adapter/base/transcript_state.rs`
- **Finding:** `TranscriptHandle` (the return type of the public `AgentAdapter::tail_transcript` trait method) and `TranscriptState` (the Tauri-managed singleton constructed once in `lib.rs:77` via `.manage(TranscriptState::new())`) both carried the doc comment `/// Test-only public surface. Production code must use AgentAdapter::start.` Both types are live in production. A future contributor reading "Test-only public surface" might gate them under `#[cfg(test)]`, silently breaking the `WatcherHandle::Drop` cascade and the managed-state registration. The damage would be silent at compile time (no test would fail; the wrong cfg would just remove the production paths). The first repair attempt collapsed both into the same comment claiming both were constructed through `AgentAdapter::start`, which was technically wrong for `TranscriptState` (it has its own `new()` registered with Tauri) — codex flagged this as a partial fix on the first verify pass.
- **Fix:** Two differentiated comments, each accurately describing its own type's lifecycle. `TranscriptHandle`'s doc cites `pub(crate) fn new` as the production construction gate and explains that the type itself must remain `pub` because it appears in the publicly-visible `AgentAdapter::tail_transcript` trait signature. `TranscriptState`'s doc cites `lib.rs`'s `.manage(TranscriptState::new())` and the access path via `app_handle.state::<TranscriptState>()`, and warns against constructing ad hoc instances since the managed-state contract requires exactly one. The lesson: when a `pub` doc-comment exists primarily to discourage misuse, name the actual construction path AND the actual reason `pub` is required (trait-signature visibility vs. cross-module access vs. test harness vs. Tauri managed-state) — the wrong reason misleads more than no reason at all.
- **Commit:** _(see git log for the cycle-9 fix commit)_

---

### 44. Block comment in ref-purpose section misdescribes a removed gate, risking re-introduction of the very bug just fixed

- **Source:** github-claude | PR #153 round 2 | 2026-05-03
- **Severity:** LOW
- **File:** `src/features/agent-status/hooks/useAgentStatus.ts`
- **Finding:** PR #153's cycle-1 fix removed the `watcherStartedRef.current` guard from all three `stopWatchers` cleanup paths (F2 fix — gating cleanup on a local ref that mirrored only the last LOCAL start outcome leaked the backend watcher whenever a prior stop failed). The cycle-1 fix updated each call-site's inline comment but missed the canonical ref-documentation block at L73-80 that ENUMERATES the ref's gating purposes — bullet (b) still said "calling stopWatchers on exit (skip the IPC if the watcher never started)." A future maintainer reading the canonical comment would conclude the ref still gates stop calls and might re-introduce `if (watcherStartedRef.current)` to "fix" duplicate IPCs, silently bringing back the watcher-leak. Same finding-class as #6 / #36 / #42 — adjacent surface that misrepresents what the actual code now enforces.
- **Fix:** Rewrote the bullet to describe purpose (a) only and explicitly note that "stop calls are NOT gated on this ref — every cleanup path invokes `stopWatchers` unconditionally (see F2 fix on PR #153)." Cited the LAST-local-start-outcome rationale inline so future readers see WHY the gate was removed, not just THAT it was. The lesson: when a fix changes a stated behaviour at multiple call sites, ALSO grep for the single canonical doc-block that originally established the behaviour. Three updated in-line comments are not a substitute for the one summary block; the summary block is what readers consult to understand intent. Code-review heuristic: any time you remove an `if (X)` guard, check whether `X` is documented anywhere as a gate — the doc must be updated atomically with the gate removal, not afterwards.
- **Commit:** _(see git log for the cycle-2 fix commit on PR #153)_

---

### 45. Redundant pre-cleanup state reset survives an un-gating fix, misleading readers about the consumer's contract

- **Source:** github-claude | PR #153 round 3 | 2026-05-03
- **Severity:** LOW
- **File:** `src/features/agent-status/hooks/useAgentStatus.ts`
- **Finding:** PR #153's cycle-1 fix dropped `watcherStartedRef.current` as a gate on `stopWatchers` invocation (F2). Inside the session-change `useEffect`, the cleanup block had `watcherStartedRef.current = false` BEFORE the `void stopWatchers(oldId)` call (line 107), AND another unconditional reset after the cleanup block (line 113) on the same execution path. Once stopWatchers became un-gated, the line-107 pre-reset added no safety: `stopWatchers` is fire-and-forget and reads no refs, and the line-113 reset always runs on this path. The redundancy was misleading — a future maintainer reading line 107 might infer the ref gates `stopWatchers` (which it explicitly no longer does after F2). Same finding-class as #44: leftover code from before a refactor that misrepresents what the consumer actually does now.
- **Fix:** Deleted the line-107 pre-stop reset; left the unconditional post-cleanup reset (line 113) as the authoritative ref-state owner. Added an inline comment noting that the unconditional reset below covers the ref state and that `stopWatchers` is fire-and-forget (reads no refs), so the order between "reset ref" and "invoke stop" doesn't affect correctness. The lesson: when a refactor removes a gate (cycle-1 F2: drop `if (watcherStartedRef.current)`), check the SURROUNDING lines for state mutations that were paired with the gate — they're often dead weight after the refactor and survive only as misleading legacy. Code-review heuristic: dual writes to the same ref on a single path almost always indicate one is redundant; if both come from different intents, one is paired with a now-dead consumer.
- **Commit:** _(see git log for the cycle-3 fix commit on PR #153)_

---

### 46. Triple variable shadowing in idiomatic condvar loop obscures which guard the maintenance hazard concerns

- **Source:** github-claude | PR #153 round 5 | 2026-05-03
- **Severity:** LOW
- **File:** `src-tauri/src/agent/adapter/base/watcher_runtime.rs`
- **Finding:** The polling thread's `Condvar`-based shutdown loop followed the canonical `wait_timeout_while` pattern from the Rust std::sync::Condvar docs, which conventionally re-binds the post-wait guard under the same name as the pre-wait guard. In this code path the convention produced THREE distinct bindings on adjacent lines — pre-wait `MutexGuard<bool>` (line 433), post-wait `MutexGuard<bool>` from tuple destructuring (line 434), `&mut bool` predicate-closure parameter (line 435) — all named `stopped`. The `if *stopped { break; }` and `drop(stopped)` operate on the post-wait guard, which is correct, but a future maintainer scanning the lifecycle could mis-identify which binding `drop(stopped)` was releasing. If they removed the explicit `drop` call thinking the pre-wait guard had already gone out of scope, the post-wait guard would silently survive across all the file I/O below, holding the mutex and preventing `WatcherHandle::Drop` from acquiring the lock to set the stop flag — defeating the entire point of the cycle-0 condvar fix (instant shutdown).
- **Fix:** Renamed each of the three bindings to its semantic role: `pre_wait_guard` (the lock taken before the wait, consumed by `wait_timeout_while`), `flag` (the predicate closure's `&mut bool` parameter), and `stop_guard` (the post-wait guard that is checked + explicitly dropped before file I/O). Added an inline comment listing all three roles so future readers can map each name to its place in the lifecycle. No behavioral change — purely a readability fix that makes the load-bearing `drop(stop_guard)` call's purpose self-evident.
- **Lesson:** Idiomatic patterns from std-lib docs are written for short examples where the variable carries no semantic meaning beyond "the guard." When the same pattern is used in production code where the guard's lifetime correctness is load-bearing (here: must-drop-before-IO so Drop-side notify can acquire the lock), renaming the bindings to their roles transforms a maintenance hazard into a self-documenting flow. Code-review heuristic for shadowing: when the same identifier is introduced 3+ times in <10 adjacent lines and at least one of the bindings has type-significant lifetime (MutexGuard, RwLockGuard, RAII handle), the shadowing should be broken with role-named bindings — even if the code is correct.
- **Commit:** _(see git log for the cycle-5 fix commit on PR #153)_

---

### 47. Multi-line PR-citation comments accumulate across iterative review cycles, eventually violating "one short line max" project rule

- **Source:** github-claude | PR #153 round 9 | 2026-05-03
- **Severity:** LOW
- **File:** `src-tauri/src/agent/adapter/base/watcher_runtime.rs`, `src-tauri/src/agent/adapter/claude_code/transcript.rs`, `src/features/agent-status/hooks/useAgentStatus.ts`
- **Finding:** Project CLAUDE.md is explicit: "Never write multi-paragraph docstrings or multi-line comment blocks — one short line max" and "Don't reference the current task, fix, or callers." Across PR #152 + PR #153's iterative review cycles (8 rounds × multiple findings each), inline comments accumulated `(Claude review on PR #152, F2)` / `(Codex cycle-8 retry-1 follow-up)` / "the cycle-7 implementation that..." rationales. Each individual citation seemed reasonable in isolation, but the cumulative effect was paragraphs of historical PR/cycle context inline in production code. Specifically: `watcher_runtime.rs` had a 10-line condvar-loop comment from F9; `transcript.rs` had ~22 lines of memory-bound rationale from F15 retries; `cap_with_head_and_tail` had ~18 lines of doc citing F15. Future readers see PR-citation noise that has no meaning outside the merged context.
- **Fix:** Trimmed each block to a single-line descriptive comment with no PR/cycle/finding citations. Variable names + the diff history carry the context that PR descriptions should explain. The first attempt (cycle-9 retry-0) trimmed the largest blocks but left several 2-3 line "F15"-citing fragments — codex flagged the residual blocks as still-violating the rule. Cycle-9 retry-1 collapsed every touched comment to a single declarative sentence: e.g., `// pre_wait_guard consumed by wait_timeout_while; stop_guard must drop before file I/O.` The lesson: comment-style discipline is binary — "one short line max" admits no edge cases, including review-fix attribution. Each fix-cycle comment that survives the merge becomes permanent rot. PR descriptions, commit messages, and the pattern KB are the right places for citation; inline comments are for explaining WHY the code is doing what it does, not WHO asked for it. Code-review heuristic: any inline comment with `PR #N`, `F<n>`, `cycle <n>`, or `retry-<n>` is a smell — collapse to a single line that describes the invariant, not the history.
- **Commit:** _(see git log for the cycle-9 fix commit on PR #153)_

---

### 48. Placeholder UI text drifts from authoritative spec sources (package.json version + design-system brand mark)

- **Source:** github-claude + github-human | PR #173 round 1 | 2026-05-06
- **Severity:** LOW (Claude × 2) + MEDIUM (human inline)
- **File:** `src/features/workspace/components/StatusBar.tsx`
- **Finding:** Step 2 of the UI handoff migration mounted a placeholder `StatusBar` with two stand-in strings: brand mark `obsidian-cli` (an internal codename for "The Obsidian Lens" design system) and version `v0.9.4` (a fabricated number unrelated to `package.json`'s actual `0.1.0`). Both diverged from authoritative sources — `UNIFIED.md` line 51 specifies `vimeflow` as the brand, and `package.json` is the version source of truth. A developer or QA tester running the app between step 2 and step 9's real-content landing would see fabricated text that looks intentional. The human reviewer flagged the same lines: "use the app name and actual version in this case." Same finding-class as #2 (broken design-reference path) and #3 (wrong dev server port) — placeholder text that _looks_ plausible is more dangerous than text that _looks_ placeholder, because nobody hunts it down.
- **Fix:** Replaced `obsidian-cli` → `vimeflow` (matches `UNIFIED.md`). Wired the version slot to `__APP_VERSION__`, a Vite-/Vitest-injected build-time constant sourced from `package.json` via `define` in both `vite.config.ts` and `vitest.config.ts`; declared the global in `src/vite-env.d.ts`. Updated the test to assert the v-prefixed semver shape with a regex (`/^v\d+\.\d+\.\d+$/`) so it survives version bumps without churn. The lesson: a placeholder that exists for ~7 PRs is long enough that "looks plausible" is the same as "is wrong" — wire even temporary slots to their real source when the source is one line of build config away. Code-review heuristic: any UI string that mirrors a value already present in `package.json` / `Cargo.toml` / a design spec MD file should be sourced from that file at build time, not retyped.
- **Commit:** _(see git log for the cycle-1 fix commit on PR #173)_

---

### 49. Multi-line explanatory comments in test files violate the "one short line max" rule (recurrence of #47)

- **Source:** github-claude | PR #173 round 3 | 2026-05-06
- **Severity:** LOW
- **File:** `src/features/workspace/components/StatusBar.test.tsx`, `src/features/workspace/WorkspaceView.test.tsx`, `src/features/workspace/WorkspaceView.visual.test.tsx`
- **Finding:** Cycle-2's StatusBar test additions and the cycle-1 grid-template assertions shipped with 2-line and 4-line `//` comment blocks explaining test rationale (e.g. four lines on `__APP_VERSION__` injection, three on `<footer>` landmark resolution, two on grid columns matching handoff §3). Project CLAUDE.md and `rules/CLAUDE.md` are explicit: "Never write multi-paragraph docstrings or multi-line comment blocks — one short line max." Each block was accurate, but the rule is binary — no exception for "the rationale is genuinely complicated." Same recurrence pattern as #47: explanatory blocks accumulate during review-fix cycles, each individually defensible, and harden into permanent rot if not collapsed before merge.
- **Fix:** Collapsed each block to a single one-liner that names the WHY (e.g. `// Anchored regex survives package.json version bumps without test churn.` and `// <footer> outside sectioning element → implicit role="contentinfo".`); deleted comments that merely restated the assertion (the §3 grid columns are visible in the assertion line itself). Code-review heuristic: when committing a test, scan every `//` comment block — if it spans ≥2 lines, either collapse to one line that captures the load-bearing WHY, or delete it entirely if the assertion line already self-documents the WHAT.
- **Commit:** _(see git log for the cycle-3 fix commit on PR #173)_

---

### 50. Test name drifts from the actual CSS units it asserts (and a JSX comment with "step 3" task reference)

- **Source:** github-claude | PR #173 round 4 | 2026-05-06
- **Severity:** LOW × 2
- **File:** `src/features/workspace/WorkspaceView.test.tsx`, `src/features/workspace/WorkspaceView.tsx`
- **Finding:** Two related drift findings: (a) the grid-proportions test's title was `(48 / 272 / flex / auto)` but the body asserted `1fr` (not `flex`) and never asserted `auto` at all — a name that claims four columns of coverage while only verifying three is a silent gap that any future reader scanning test names treats as load-bearing; (b) a JSX comment on the session-tabs strip placeholder cited `step 3 (handoff §4.3)`, naming the next migration step inline. CLAUDE.md is explicit: "Don't reference the current task, fix, or callers… those belong in the PR description and rot as the codebase evolves." Step 3 might wrap rather than replace the div, leaving the "placeholder for step 3" label as misleading rot. Same finding-class as #47 / #49 (multi-line comment rot) — the rule is binary; the carve-out for "but it's helpful right now" is exactly the failure mode.
- **Fix:** (a) Renamed the test to use exact CSS units `(48px / 272px / 1fr / auto)` and added the missing `expect(...).toContain('auto')` so the fourth column is actually under test. (b) Removed the JSX comment entirely — `data-testid="session-tabs-strip"` plus the `h-[38px]` Tailwind class self-document the placeholder, and the placeholder height is asserted in the test suite. Code-review heuristic for test names: a `expect(...).toContain('X')` line for every name segment that names a value, OR a name that cites only what is actually asserted. Heuristic for inline comments: any token like `step <n>`, `handoff §<n>`, `PR #<n>`, `cycle <n>` is a smell — move to PR description, commit message, or pattern KB; not inline source.
- **Commit:** _(see git log for the cycle-4 fix commit on PR #173)_

---

### 51. Pattern #50 violations slipped through the same PR that codified the pattern (three surviving `handoff §<n>` tokens)

- **Source:** github-claude | PR #173 round 5 | 2026-05-06
- **Severity:** LOW
- **File:** `src/features/workspace/WorkspaceView.test.tsx`, `src/features/workspace/components/StatusBar.test.tsx`, `src/features/workspace/components/IconRail.test.tsx`
- **Finding:** Cycle 4 added pattern #50 explicitly naming `handoff §<n>` as a task-reference smell. Three other instances of the same token survived the four prior fix cycles because the regex in each fix was scoped narrowly to the lines flagged by that cycle's review: (a) `WorkspaceView.test.tsx:343` test name `'uses handoff §3 grid proportions ...'`, (b) `StatusBar.test.tsx:13` test name `'uses surface-container-lowest background per handoff §4.9'`, (c) `IconRail.test.tsx:14` inline comment `// 48px (12 * 4 = 48) — handoff §3`. The cleanest possible repro of pattern #50 is having an instance of it in the same PR that adds the pattern to the KB.
- **Fix:** Renamed each call site to a self-documenting alternative that drops the spec coordinate: (a) `'grid columns: icon-rail 48px, sidebar 272px, main 1fr, activity auto'`, (b) `'uses surface-container-lowest background'`, (c) `// 48px (12 * 4 = 48)`. The lesson: when adding a rule to the pattern KB, **`grep` the diff being shipped** for the smell token immediately, not just the lines a reviewer flagged. Code-review heuristic: every commit that touches `docs/reviews/patterns/` should be preceded by a `rg <smell-token>` over the staged diff to catch other violations the reviewer hasn't seen yet.
- **Commit:** _(see git log for the cycle-5 fix commit on PR #173)_

---

### 52. Roadmap phase renumbering updated summary surfaces but missed body headings

- **Source:** github-claude | PR #183 round 1 | 2026-05-07
- **Severity:** LOW
- **File:** `docs/roadmap/tauri-migration-roadmap.md`
- **Finding:** The docs-sync PR added Agent Status Sidebar as completed Phase 4 and renumbered the dependency graph plus timeline table, but the body section headers still named Session Management as Phase 4 through Desktop Polish as Phase 9. The footer also still referenced "Phase 7–9 parallel work." A reader following the table to Phase 8 Context Panels would land on a `## Phase 7` heading.
- **Fix:** Added a brief Phase 4 Agent Status Sidebar section, renumbered the remaining body headings to Phase 5–10, updated Desktop Polish's parallel-phase note, and corrected the footer to "Phase 9–10 parallel work." Lesson: when a numbered roadmap table changes, grep every `^## Phase` heading and footer/cross-reference in the same file before committing.
- **Commit:** same commit as this entry

### 53. Completed-step roadmap note retained a planned test path after Files list was corrected

- **Source:** github-claude | PR #183 round 1 | 2026-05-07
- **Severity:** LOW
- **File:** `docs/roadmap/ui-update-roadmap.md`
- **Finding:** The Step 1 Files list was updated to the actual landed locations (`tailwind.config.test.js`, `src/agents/registry.test.ts`), but the Risks paragraph still justified the original planned `src/lib/` test location. The contradiction made a completed step look as if it expected a different file layout.
- **Fix:** Replaced the obsolete `src/lib/` risk note with the actual landed test locations. Lesson: once a planned roadmap step is marked done, prospective "Risks" text should be rewritten as implemented-state evidence or removed.
- **Commit:** same commit as this entry

### 54. Module-level cache comment claimed tab-switch persistence; tab-switch never unmounts the consumer so the cache is not the persistence mechanism

- **Source:** github-claude | PR #190 cycle 5 | 2026-05-09
- **Severity:** LOW
- **File:** `src/features/terminal/components/TerminalPane/Body.tsx`
- **Finding:** `terminalCache` (module-level Map) was originally documented as "allows terminals to persist when switching between sessions". That claim predates `TerminalZone`'s always-render-with-CSS-hidden design — Body never unmounts on a tab switch (it's just `display: none`-d), so the cache hit/miss branch in the mount effect never fires. The cache's actual current consumers are: (a) the imperative `focusTerminal()` handle, (b) tests, and (c) the public `clearTerminalCache` / `disposeTerminalSession` API surface preserved per the step-4 migration spec. The misleading comment risked future contributors assuming Body could be unmounted/remounted mid-session with the cache preserving state, leading to incorrect refactors. The original behavioral claim was simply stale.
- **Fix:** Updated the comment to accurately describe what the cache serves now: focusTerminal + public API + tests. Documented that "Body's stable mount" is what makes tab switching work, NOT the cache. Did NOT refactor the Map to a useRef (Claude's "Alternative") because tests, integration tests, and external imports of the cache symbols would all break — the code-shape is preserved for backwards compat. Code-review heuristic: when a "P2 Fix" or similar comment names a defense for a class of bug that no longer applies (because the surrounding architecture changed), updating the comment to match current reality is a valid (and often preferable) fix — the underlying code may be doing useful work for different reasons. Don't refactor away code whose only sin is an outdated comment.
- **Commit:** _(see git log for the cycle-5 fix commit on PR #190)_

---
id: 2026-04-30-harness-github-review-rewrite-session
type: retrospective
status: shipped — PR #112 merged as e9b6bdc, 7 dogfood cycles, 0 follow-ups filed
date: 2026-04-30
---

# Retrospective: /harness-plugin:github-review Connector-Aware Rewrite — Self-Dogfooded Across 7 Cycles

## Context

**Goal:** fix issue [#111](https://github.com/winoooops/vimeflow/issues/111) — the
missed-Codex-comments incident from the [PR #109 retrospective](2026-04-29-tests-panel-bridge-session.md)
revealed `/harness-plugin:github-review` polled only `/issues/{pr}/comments`
filtered for the `## Codex Code Review` header. That filter caught the older
aggregated Codex GitHub Action surface (which had hit OpenAI quota for two PRs
running) but missed every `chatgpt-codex-connector[bot]` inline finding
entirely. The skill silently returned empty, the loop reported "no findings",
and 5 P1/P2 findings went unprocessed for 4 review rounds before the user
asked me to look wider.

The fix: rewrite the skill to consume three reviewer surfaces — Claude
(aggregated `/issues/{pr}/comments`, no thread), Codex connector (PR reviews +
inline comments via GraphQL `reviewThreads`), and humans (mixed: issue
comments + inline, with a self-reply marker filter so the skill's own replies
don't re-classify as findings). Then dogfood the new skill on its own PR.

**Outcome shipped:** [PR #112](https://github.com/winoooops/vimeflow/pull/112),
31 commits squash-merged into [`e9b6bdc`](https://github.com/winoooops/vimeflow/commit/e9b6bdc).
Final cycle ([`26334ce`](https://github.com/winoooops/vimeflow/commit/26334ce))
Claude verdict: ✅ patch is correct. All connector + human inline threads
resolved on GitHub. 0 follow-up issues filed.

**Scale:** 7 dogfood cycles processed ~30 findings end-to-end (23 in cycles 1–4
under subagent-driven mode while plugin-mode was blocked by a loader-cache
issue, plus 7 in cycles 5–7 via real plugin-mode invocation through the Skill
tool). 16 of those findings were self-discovered regressions caught by the
dogfood loop itself — bugs the original spec/plan didn't anticipate. One
retrospective (this file) and 0 follow-up issues filed at merge.

This retrospective focuses on what made the dogfood loop self-improve, the
plugin-mode loader-cache trap that ate cycle 5's first attempt, and the
asymmetries that 16 self-discovered bugs all turned out to be — so the next
agent rewriting a skill in this style doesn't re-learn the same things.

## Architecture decisions that earned their cost

### 1. Brainstorming → spec → plan → multi-round codex review BEFORE first code

- **What happened:** ~6 rounds of `superpowers:brainstorming` on the design
  before any spec text was written, then 5 rounds of local codex-verifying the
  spec before any implementation. Each verify round caught real issues that
  would otherwise have been multi-cycle dogfood findings: the §0 PR-head
  branch-safety guard (so explicit-PR mode can never write to the wrong
  branch); §2.2 `gh api | jq` pipe vs `--argjson` flag confusion; the
  paginated `reviewThreads` helper requirement; the §7 fresh-verdict gate that
  later turned out to be impossible per actual connector behavior (cycle 5
  dropped it — see process hiccup #6).
- **Why it earned its cost:** the implementation rolled cleanly through 12
  feature commits (`6a060bf` through `1ff26c8`) before the first push. Once
  reviews started, the per-cycle commit loop ran without any architectural
  rework — every cycle's fix was localized to a function or a step.
- **Lesson:** for a rewrite that depends on multiple GitHub APIs (REST +
  GraphQL) and a moving target (the connector's exact bot suffix, what it
  posts where), front-loading codex-verify of the spec is cheaper than
  discovering the same issues round 1, round 2, round 3 of the dogfood loop.
  Even so, 16 bugs slipped past — the dogfood loop is the safety net, not the
  primary defense.

### 2. Trailer-based state persistence (no JSON state file)

- **What happened:** Per-cycle state lives in git commit-message trailers
  (`GitHub-Review-Processed-Claude`, `Processed-Codex-Reviews`,
  `Processed-Codex-Inline`, `Processed-Human-Issue`, `Processed-Human-Inline`,
  `Closes-Codex-Threads`, `Pattern-Files-Touched`). Cycle start derives
  processed sets via `git log "$PR_BASE..HEAD"`, no JSON file to keep in sync,
  no separate cleanup path. Aligns with the auto-memory entries
  `lazy_reconciliation_over_shutdown_hooks` and `filesystem_cache_for_pty` —
  state lives where the runtime that owns the side-effect can read it.
- **Why it earned its cost:** the dogfood loop survived plugin-cache wipes,
  branch switches, and several mid-cycle aborts without ever losing state. Git
  history doubles as an audit log for "which finding was processed in which
  cycle." Cycle 2 added reconciliation against live GraphQL state so a
  push-but-reply-failed sequence self-heals on the next cycle's Step 1
  (commits `20317f5`, `a81c99d`); cycle 4 made reconciliation symmetric across
  reviewer surfaces (`PROCESSED_HUMAN_INLINE_IDS` was being checked but never
  cleared — see `error-surfacing.md` finding #15); cycle 7 extended the same
  pattern to threadless human-issue comments via a sidecar file because
  `LIVE_THREAD_STATE` from GraphQL has no view into them
  (`error-surfacing.md` finding #19).
- **Lesson:** the "trailer + reconciliation" pattern is now load-bearing.
  Three independent regressions across cycles 2 / 4 / 7 all fit the same
  shape: a side-effect (push, reply, resolve) succeeds but a follow-up step
  fails; the trailer says "done" but the world says "not done"; next cycle's
  reconciliation must compare them and drop stale entries. Future skills that
  persist state in commit messages need this pattern from day one, not bolted
  on per-surface as failures appear.

### 3. Three reviewer surfaces, unified pipeline

- **What happened:** Claude (aggregated, no thread) + Codex connector (inline,
  GraphQL thread) + humans (mixed, with skill-self-reply marker filter) — the
  same Step 2 → 7 flow handles all three with per-source filter logic. Humans
  were added as the third source mid-PR (commit `6095be1`, between cycles in
  the implementation phase) precisely because human-reviewer feedback was
  arriving on this PR via inline + issue comments and the skill needed to
  process it on the same path.
- **Why it earned its cost:** by cycle 5 (post-Progressive-Disclosure
  refactor), the Step 2A/2B/2D structure was identical-shape across reviewers,
  with only the filter predicates differing. Cycle 7's threadless-human fix
  slotted into the existing Step 6.8 issue-comment branch with a sidecar file
  for retry — no new pipeline.
- **Lesson:** when you add a reviewer surface, do it before you've cycled the
  loop more than twice — late additions are where the asymmetries land
  (cycle 4's `PROCESSED_HUMAN_INLINE_IDS` reconciliation hole and cycle 7's
  threadless-issue retry hole both came from this).

### 4. Codex-verified react+resolve chain

- **What happened:** Reply + GraphQL `resolveReviewThread` only fire if local
  `codex exec --sandbox read-only` agrees the staged fix actually addressed
  the upstream finding. The reply body cites the verify status, the trailer
  records `Closes-Codex-Threads`, and Step 1 of the next cycle reconciles the
  trailer against live `isResolved` state. This was specifically requested by
  the user during cycle 1 ("have you laid out the actions to react to
  comments and resolve once fixed via local codex?") and was made explicit in
  commit [`226bf20`](https://github.com/winoooops/vimeflow/commit/226bf20)
  with an ASCII-tree diagram in `SKILL.md`'s Step 6 preamble.
- **Why it earned its cost:** verify-gating prevents the skill from declaring
  "fixed" when the fix only renamed a variable. By cycle 7 the verify gate had
  caught two would-be-shipped regressions — cycle 6's reply-loop word-split
  bug almost passed because `RESULT_JSON` was missing but `codex exec` exited
  0 (see process hiccup #2 and `error-surfacing.md` finding #16).
- **Lesson:** the explicit ASCII diagram in `SKILL.md` is the kind of
  documentation that costs ~30 lines and saves a future agent from
  re-deriving the order-of-operations. Document the contract at the
  orchestrator level, not inside individual step references.

### 5. Progressive Disclosure refactor (after the user pushed back)

- **What happened:** SKILL.md was 1456 lines monolithic by cycle 4. The user
  pointed at `github.com/winoooops/wskills` as the target style — orchestrator
  - per-step references + sourceable scripts. Refactor in commit
    [`b09d5fa`](https://github.com/winoooops/vimeflow/commit/b09d5fa) split the
    file into a ~700-line orchestrator + 7 reference files
    (`parsing.md`, `empty-state-classification.md`, `verify-prompt.md`,
    `pattern-kb.md`, `commit-trailers.md`, `cleanup-recovery.md`,
    `input-resolution.md`) + 2 scripts (`scripts/helpers.sh`, `scripts/verify.sh`).
- **Why it earned its cost:** cycles 5/6/7 ran from the post-refactor
  structure under real plugin-mode invocation. The helpers-as-sourceable-file
  pattern caught a class of bugs on its own — finding #11 (`Bootstrap
script-path derivation breaks under interactive-shell $0`) and finding #17
  (`Bootstrap calls loop_start_scan not defined in the only sourced file`)
  were both refactor-introduced and caught immediately by cycle 2 + cycle 3.
- **Lesson:** if a SKILL.md grows past ~800 lines, refactor at the next
  natural seam. Bash code blocks >10 lines belong in a reference; sourceable
  helpers belong in `scripts/`. The refactor itself is review-bait — expect
  cycle N+1 / N+2 to find at least one stale cross-reference (cycle 5
  findings #20 and #21 in `documentation-accuracy.md` are both
  refactor-stale-cross-reference cases).

## The dogfood experience

### Cycle-by-cycle summary

| Cycle | Mode            | Commit    | Findings (severity)              | Highlights                                                                                                                                                                                                                                                                                                                                       |
| ----- | --------------- | --------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Subagent-driven | `ebd7eff` | HIGH×1, MEDIUM×2                 | First push exposed `LATEST_CLAUDE_ID` never assigned; `git diff --name-only` enumerating wrong files; bash function exits 0 despite inner failures                                                                                                                                                                                               |
| 2     | Subagent-driven | `3c5efc3` | HIGH×4, MEDIUM×4, LOW×2, HUMAN×2 | Big cycle: `grep -vxFf` strict-mode abort, Bootstrap `$0` interactive-shell bug, helpers.sh strict-mode propagation, skill-self-reply re-classification, INDEX_TOUCHED missed for existing-pattern updates, plus user requested Progressive Disclosure refactor + Q&A section                                                                    |
| 3     | Subagent-driven | `f478258` | HIGH×1, MEDIUM×1, LOW×1          | GraphQL HTTP-200-with-`errors` envelope bypass; `loop_start_scan` defined-but-not-sourced; `extract_trailer` missing `sort -u`                                                                                                                                                                                                                   |
| 4     | Subagent-driven | `2ea0d07` | MEDIUM×2                         | `2>/dev/null \|\| echo "[]"` deafening the loud-fail signal cycle 3 had just installed; reconciliation only subtracting connector inline IDs, never human inline ones                                                                                                                                                                            |
| 5     | **Plugin-mode** | `d52b2ee` | MEDIUM×2, LOW×2                  | First plugin-mode attempt aborted (loader cache served stale SKILL.md — see process hiccup #1). Second attempt: `codex exec` exits 0 without writing `RESULT_JSON`, `classify_cycle` only declared two states while prose mandated three (after humans were added), refactor-stale cross-references in cleanup-recovery.md and helpers.sh header |
| 6     | **Plugin-mode** | `1e1342c` | MEDIUM×1, LOW×1                  | Step 6.8 reply-loop missing `\|\| { warn; continue; }` while 6.9 had it (asymmetric hardening); human self-reply substring filter dropping legit comments that quoted prior replies                                                                                                                                                              |
| 7     | **Plugin-mode** | `26334ce` | HIGH×1                           | Failed human-issue replies marked as processed because the threadless surface has no GraphQL reconciliation. Sidecar file `.harness-github-review/replies-failed-human-issue.txt` solves it. Final cycle Claude verdict: ✅ patch is correct                                                                                                     |

### Plugin-mode loader-cache discovery

- **What happened:** Cycle 5's first attempt invoked the skill via the Skill
  tool (`/harness-plugin:github-review`). The skill ran the OLD pre-rewrite
  body — the one that polls only `/issues/{pr}/comments` for the `## Codex
Code Review` header. The on-disk file at
  `plugins/harness/skills/github-review/SKILL.md` was the new rewrite from
  `b09d5fa`. The plugin loader had snapshotted the previous body at
  session-start and was serving the snapshot for the rest of the session, even
  after `cp -r` to the cache directory at
  `~/.claude/plugins/cache/harness/harness-plugin/0.0.1/skills/github-review/`.
- **Recovery:** required a Claude Code session restart to invalidate the
  loader's snapshot. After restart, cycles 5/6/7 ran cleanly via real
  plugin-mode invocation.
- **Lesson:** captured in the new `SKILL.md` Q&A section #5/#7 and again as
  process hiccup #1 below. **Anyone rewriting a skill that depends on the
  plugin loader must restart Claude Code before validating in plugin-mode.**
  Subagent-driven mode (where the agent reads SKILL.md directly via the Read
  tool, then executes the steps) is a useful intermediate but is NOT a
  substitute for plugin-mode validation — it bypasses the loader entirely.

### Self-discovered regressions (the 16 bugs the spec didn't anticipate)

Cycle-numbered, severity-tagged. Each bullet is a 1-line summary; full
analysis is in the linked pattern file entry.

1. **Cycle 1, HIGH** — `LATEST_CLAUDE_ID` never assigned despite Step 6.6's
   commit-trailer template referencing it; trailer always empty so next cycle
   re-processes the same Claude comment forever
   (`documentation-accuracy.md` #11).
2. **Cycle 1, MEDIUM** — `git diff --name-only` in Step 6.5 enumerates
   working-tree-vs-index, not staged files; sweeps unrelated unstaged edits
   into the review-fix commit (`git-operations.md` #11).
3. **Cycle 1, MEDIUM** — `paginated_review_threads_query` ends with `echo
"$result"`, propagating the echo's exit code (always 0) and silently
   swallowing inner `gh api graphql` failures (`error-surfacing.md` #8).
4. **Cycle 2, HIGH** — `grep -vxFf <(...)` exits 1 when every input line is
   suppressed; under `set -euo pipefail` (which `helpers.sh` propagates when
   sourced) this aborts the script in the exact reconciliation scenario the
   block guards against (`error-surfacing.md` #9).
5. **Cycle 2, LOW** — `helpers.sh` calls `set -euo pipefail` unconditionally;
   sourcing it propagates strict mode into the calling skill session, making
   non-fatal non-zero exits abort the run (`error-surfacing.md` #10).
6. **Cycle 2, HIGH** — `SCRIPT_DIR="$(dirname "$(realpath "$0")")"` resolves
   to `/usr/bin` when SKILL.md runs from an interactive shell — `$0` is the
   shell name, not the SKILL.md path (`error-surfacing.md` #11).
7. **Cycle 2, HIGH** — Step 2D filters human findings by `user.type ==
"User"`, but the skill itself authenticates as a human GitHub user; its own
   Step 6.8 replies re-classify as new human findings on the next cycle
   (`error-surfacing.md` #12).
8. **Cycle 2, MEDIUM** — `INDEX_TOUCHED=1` flag set when Step 6.3 created a
   new pattern but NOT when Step 6.2 appended to an existing one; `Findings`
   counts and `Last Updated` dates in the index drift after every cycle
   (`git-operations.md` #12).
9. **Cycle 2, MEDIUM** — Step 6.9 used `for thread_id in $(list_thread_ids_to_close)`,
   the exact pattern Step 6.8 prohibited two steps earlier (`documentation-accuracy.md` #12).
10. **Cycle 3, HIGH** — `gh api graphql` returns HTTP 200 with `{"errors":
[...], "data": null}` on auth/rate-limit/malformed-query/stale-node-id
    cases; the `|| return 1` guards catch subprocess exit but never the
    error envelope. `_assert_graphql_response_ok` helper added; applied to
    every GraphQL call site (`error-surfacing.md` #13).
11. **Cycle 3, MEDIUM** — Bootstrap calls `loop_start_scan` with comment
    "defined in references/cleanup-recovery.md" but the function lives only
    inside a markdown code block there, never sourced. Moved to `helpers.sh`
    as canonical (`documentation-accuracy.md` #17).
12. **Cycle 4, MEDIUM** — `2>/dev/null || echo "[]"` wrapping the cycle-3
    hardened helper deafens the loud-fail signal cycle 3 had just installed;
    Step 1 reconciliation continues with empty `LIVE_THREAD_STATE`, trailers
    never get corrected, the loop poll-times-out with zero stderr explaining
    why (`error-surfacing.md` #14).
13. **Cycle 4, MEDIUM** — Reconciliation only subtracts stale connector-inline
    IDs from `PROCESSED_CODEX_INLINE_IDS`, never the symmetric
    `PROCESSED_HUMAN_INLINE_IDS`; a transient human-inline reply failure
    permanently strands the comment in the trailer
    (`error-surfacing.md` #15).
14. **Cycle 5, MEDIUM** — `verify.sh` propagates `$CODEX_EXIT` directly
    without checking whether `$RESULT_JSON` was actually written; `codex
exec` exiting 0 without a result file makes downstream `jq` crash with
    no `incident.md` written, bypassing the structured Step 5G recovery
    (`error-surfacing.md` #16).
15. **Cycle 5, MEDIUM** — `classify_cycle` pseudocode declared only
    `claude_state` and `codex_state` while the prose above mandated three
    states (humans added as Step 2D after the original pseudocode was
    authored); a cycle with new human findings would silently fall through
    to POLL_NEXT (`documentation-accuracy.md` #19).
16. **Cycle 6, MEDIUM** — Step 6.8 reply loop had no `|| { warn; continue; }`
    guard while Step 6.9 (added two cycles earlier) did; a transient reply
    failure silently let Step 6.9 still resolve the thread, leaving the human
    reading a closed thread with no explanation (`error-surfacing.md` #17).

A 17th finding was discovered AND fixed in cycle 7: **failed human-issue
replies marked as processed because the threadless surface has no GraphQL
reconciliation** (`error-surfacing.md` #19). The sidecar-file fix is the only
non-trailer state in the skill — accepted because the threadless
`/issues/{pr}/comments` surface genuinely cannot be queried for
"is-this-resolved" state.

## Recurring patterns the reviewers kept finding

The 16 self-discovered regressions cluster into a small number of families.
Most cycles produced findings in the same families because the spec/refactor
discipline that prevents a class of bug needs to be applied uniformly across
all call sites — and incomplete propagation is itself the recurring shape.

| Theme                                                                                                                             | Pattern file                                                                                               | Findings added during cycles 1–7                         |
| --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Silent-fallback / loud-fail discipline (`\|\| return 1`, GraphQL error envelope, RESULT_JSON guard, `2>/dev/null \|\| echo "[]"`) | [`error-surfacing.md`](../patterns/error-surfacing.md) (now 19 entries, 12 added this cycle)               | #8, #9, #10, #11, #12, #13, #14, #15, #16, #17, #18, #19 |
| Documentation-accuracy / refactor-stale cross-references                                                                          | [`documentation-accuracy.md`](../patterns/documentation-accuracy.md) (now 21 entries, 11 added this cycle) | #11, #12, #13, #14, #15, #16, #17, #18, #19, #20, #21    |
| Git operations on the wrong working-set                                                                                           | [`git-operations.md`](../patterns/git-operations.md) (now 12 entries, 2 added this cycle)                  | #11, #12                                                 |

The error-surfacing additions (`#8` through `#19`) are remarkably uniform: a
function or wrapper exits 0 (or fires a side-effect) when a logical operation
failed, and a downstream caller treats the success signal as truth. Three
shapes recur — bash exit-code propagation, GraphQL HTTP-200 with errors, and
asymmetric pair-hardening (cycle N hardens half a pair, cycle N+1 finds the
other half). Future skills that wrap external APIs with error envelopes
should add an `_assert_response_ok` helper and apply it at every call site
from day one.

The documentation-accuracy additions (`#11` through `#21`) are dominated by
"this comment / pseudocode / cross-reference was right when written but was
not updated when X moved" — the refactor-stale family. The
Progressive-Disclosure refactor in cycle 4 (`b09d5fa`) is a primary source;
the Step 2D human-reviewer addition (`6095be1`) is the other.

## Process hiccups — by cost

### 1. Plugin loader cache (cost: ~30 min wall-clock, 1 forced restart)

- **What happened:** Cycle 5's first plugin-mode attempt ran the OLD
  pre-rewrite skill body even after the new SKILL.md was on disk and
  `cp -r`'d to the cache. The plugin loader had snapshotted the body at
  session-start and was serving the snapshot for the rest of the session.
- **Recovery:** required a Claude Code session restart to invalidate.
- **Cost:** ~30 minutes wall-clock for diagnosis + restart + cycle redo.
- **Captured:** SKILL.md Q&A entry #5 (skill-cache sync) and #7 (post-rewrite
  validation requires restart). Could be automated via post-commit hook to
  `cp -r` the skill into the cache, but the loader-snapshot still requires a
  restart so the hook only solves part of the problem.

### 2. Codex CLI stdin hang (cost: 1 retry per cycle on cycles 5–6, fixed in cycle 7)

- **What happened:** `codex exec` invocations in `verify.sh` would
  occasionally hang waiting on stdin when invoked from the skill's bash
  context (the parent shell's stdin was a TTY but `codex` apparently
  attempted to read from it).
- **Fix:** `verify.sh` now redirects `</dev/null` on every `codex` invocation.
  Documented as a side-fix in cycle 7's commit (`26334ce`) under "two follow-ups
  noticed during cycle 6" alongside the Pattern-Append-Decisions footer-line
  fix.
- **Cost:** 1 retry per affected cycle.

### 3. Commitlint footer-max-line-length on Pattern-Append-Decisions (cost: 1 retry on cycle 6)

- **What happened:** Cycles 1–5 didn't hit the 100-char footer line limit
  because the Pattern-Append-Decisions rationales were shorter. Cycle 6
  tipped over and the commit was rejected.
- **Fix:** Multi-line wrap convention added to
  `references/commit-trailers.md` § 1b — wrap rationale lines at the
  100-char boundary, indenting continuation lines by 2 spaces. Documented in
  cycle 7's commit message as the second of the two follow-ups.
- **Cost:** 1 commit retry.

### 4. Plugin cache resync after every iteration (cost: ~30 sec/cycle)

- **What happened:** The plugin cache lives at
  `~/.claude/plugins/cache/harness/harness-plugin/0.0.1/skills/github-review/`.
  After every commit that touched SKILL.md / references / scripts, we
  manually `cp -r`'d the skill directory into the cache before the next
  invocation.
- **Cost:** ~30 seconds per cycle, 7 cycles.
- **Out of scope for this PR:** could be automated via post-commit hook, but
  doesn't solve the loader-snapshot problem (#1) so the saving is partial.
- **Captured:** SKILL.md Q&A entry #5.

### 5. Claude Code Review action latency (cost: 5–30 min per cycle)

- **What happened:** Every push triggered the Claude Code Review GitHub
  Action, which consistently took 6–30 minutes to post its review. The
  poll loop in Step 7's POLL_NEXT path waited for either Claude or
  connector to produce new content; on cycles where Claude was the slow
  reviewer, the wait dominated cycle wall-clock time.
- **Cost:** 5–30 min per cycle, sometimes serialized across cycles when the
  next push couldn't start until the previous review landed.
- **Out of scope to fix.** Action latency is GitHub-side. Possible future
  optimization: parallelize the next-cycle's "fix" preparation while the poll
  is running.

### 6. Spec's "fresh-verdict gate" turned out to be impossible (cost: cycle 5 dropped a feature)

- **What happened:** Spec §7 originally required Step 7's clean-exit to wait
  for a connector review whose `submitted_at > pushed_commit_at` AND whose
  summary was `is_summary_clean`. In practice the connector doesn't always
  re-review after every push (it samples), so the gate could wait forever.
- **Recovery:** commit `bc91096` dropped the gate; clean-exit now keys off
  `UNRESOLVED_*_THREADS == 0` AND `cycle_findings_count == 0` for the latest
  poll. Documented as a known-limitation in SKILL.md § Step 7.
- **Cost:** ~1 cycle of confused poll-timeouts before the gate was identified
  as the cause.
- **Lesson:** spec-time codex-verify caught most issues but couldn't catch
  this one because it required real connector behavior to validate. Some
  spec assumptions are only falsifiable with the real third party in the
  loop — flag those for "validate during dogfood, not during spec-verify."

## What worked well

- **Brainstorming → spec → codex-verify gate.** Six brainstorming rounds
  plus five spec-verify rounds caught issues that would have been multi-cycle
  findings (PR-head guard, paginated helper, jq pipe vs --argjson) before
  any code shipped.
- **Trailer + reconciliation as the only state.** Survived plugin-cache
  wipes, branch switches, and 3 mid-cycle aborts without ever losing state.
  Three independent regressions across cycles 2 / 4 / 7 fit the same
  reconciliation-extension shape, so the pattern grew uniformly.
- **Codex-verified react+resolve chain.** The verify gate caught two
  would-be-shipped regressions mid-cycle (cycle 5 missing-RESULT_JSON,
  cycle 6 reply-loop word-split). The ASCII diagram in SKILL.md is the
  documentation that makes the chain re-derivable by future agents.
- **Per-cycle pattern KB appends.** Every cycle's commit included a
  `Pattern-Append-Decisions` trailer block listing which findings landed in
  which pattern files; commitlint enforced the body, and the pattern files
  themselves grew in atomic step with the fix. No drift between
  "fix-shipped" and "pattern-recorded."
- **Subagent-driven mode as fallback when plugin-mode was blocked.** Cycles
  1–4 ran via subagent dispatch with the agent reading SKILL.md directly via
  Read; not a substitute for real plugin-mode validation, but kept the loop
  moving while #1 was diagnosed.
- **Stopping at 7 cycles when verdict was ✅.** Cycle 7's only finding was a
  threadless-retry sidecar fix; Claude verified ✅ "patch is correct."
  Per `agents/code-reviewer.md`'s anti-rabbit-hole guidance, no cycle 8.

## Recommendations for the next agent-led PR

For the next agent-led PR that uses or rewrites a plugin skill:

1. **Read the new SKILL.md before invoking the skill.** It is the
   orchestrator; the references are read on-demand. Q&A section near the
   end has the "stuck cycle → likely cause → fastest fix" lookup table.
2. **Remember the plugin loader cache.** If you rewrite a skill, you MUST
   restart Claude Code before validating in plugin-mode. `cp -r` to the
   cache is necessary but not sufficient. SKILL.md Q&A #5/#7 documents this.
3. **Validate spec assumptions about third-party behavior during dogfood,
   not during spec-verify.** The fresh-verdict gate (process hiccup #6)
   would have been impossible to catch in spec-verify because it required
   real connector behavior.
4. **When you add a reviewer surface or extend a reconciliation block, do
   it symmetrically across all sibling surfaces in the same commit.** The
   3 cycles of reconciliation-completeness fixes (cycles 2 / 4 / 7) all
   came from incomplete propagation of an earlier fix.
5. **For external API wrappers, add an `_assert_response_ok` helper and
   apply it at every call site from day one.** Both `paginated_review_threads_query`
   (cycle 3) and the `resolveReviewThread` mutation (cycle 3 same finding)
   needed this; the GraphQL HTTP-200-with-errors envelope is not a `gh`-only
   issue, it's the standard GraphQL error model.
6. **For bash helpers shipped as sourceable files, guard `set -euo pipefail`
   with `[ "${BASH_SOURCE[0]}" = "${0}" ]`** so strict mode applies only on
   direct execution. Otherwise `grep -v` no-match exits and similar
   non-fatal-but-non-zero patterns will silently abort callers.
7. **Cycle commit messages should embed the trailer set + Pattern-Append-Decisions**
   so the next cycle's reconciliation has everything it needs from `git log
"$PR_BASE..HEAD"`. No JSON state files.
8. **Stop the loop at the first cycle with verdict ✅ AND no new findings.**
   The 7-cycle budget here was about right; the value-curve flattens after
   cycle 5 once the loud-fail discipline is uniform.

## Auto-memory captured during this cycle

No new auto-memories were added this cycle — the existing memory base
covered the patterns this PR surfaced (lazy reconciliation, filesystem
cache for runtime-owned state, codex CLI model flag, IDEA-per-option,
worktree rule).

The items worth adding for future agent rewrites of plugin skills:

- **plugin loader cache requires session restart for skill body changes.**
  The plugin loader snapshots SKILL.md body at session-start and serves the
  snapshot for the rest of the session, even after `cp -r` to
  `~/.claude/plugins/cache/.../`. Any skill rewrite under dogfood validation
  must restart Claude Code before plugin-mode invocation. Subagent-driven
  mode (Read tool reading SKILL.md directly) bypasses this and can be used
  as an intermediate but is not a substitute.
- **`_assert_graphql_response_ok` pattern: HTTP-200-with-`errors` envelopes.**
  Every `gh api graphql` call needs an explicit errors-array check;
  subprocess exit code is not sufficient. Apply at every call site, not
  selectively, and at the level of the helper that wraps the API — not at
  the consumer.
- **Trailer + reconciliation completeness: when adding a reviewer surface,
  extend reconciliation in the same commit.** Three independent regressions
  across PR #112 cycles 2 / 4 / 7 came from incomplete propagation of an
  earlier reconciliation pattern when a new surface was added.
- **`set -euo pipefail` in sourceable bash helpers must be guarded by
  `[ "${BASH_SOURCE[0]}" = "${0}" ]`.** Otherwise sourcing the helper
  weaponizes strict mode against callers using legitimate non-zero-exit
  idioms (`grep -v` no-match, `diff` differences, `cmp` mismatch).

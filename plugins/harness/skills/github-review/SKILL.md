---
name: github-review
description: Fetch review findings from the current PR (Claude Code Review aggregated comments + chatgpt-codex-connector inline comments) and fix them in atomic per-cycle batches. Each cycle polls both reviewers, fixes findings, runs codex verify on the staged diff, commits with watermark trailers, pushes, replies + resolves connector threads, then polls for the next review. Mandates pattern-file appends in the same commit as the fix.
tools: Read, Write, Edit, Bash, Grep, Glob
---

# /harness-plugin:github-review — Fix PR Review Findings (Connector-Aware Self-Driving Loop)

Fetch the latest reviews from the current branch's PR (or a user-specified
PR), fix every finding, push, then poll for the next review and repeat —
until both reviewers come back clean or the loop hits the max-rounds cap.

This skill consumes three reviewer surfaces:

1. **Claude Code Review** — `github-actions[bot]` issue comments with `##
Claude Code Review` header. Aggregated, no threads.
2. **chatgpt-codex-connector** — `chatgpt-codex-connector[bot]` PR-level
   review summaries (`### 💡 Codex Review`) + inline file-level comments
   (`**P1/P2 Badge** Title`). Inline comments are the actionable units;
   threads resolved via GraphQL `resolveReviewThread`.
3. **Human reviewers** — issue comments + inline review comments from
   non-bot authors. Unstructured prose; default severity MEDIUM with
   heuristic overrides.

The old aggregated `openai/codex-action@v1` workflow
(`.github/workflows/codex-review.yml`) was disabled in the same PR that
introduced this rewrite (issue #111).

## File structure

```
plugins/harness/skills/github-review/
├── SKILL.md                              # this file — thin orchestrator
├── references/
│   ├── input-resolution.md               # Step 0: PR + branch resolution + worktree recipe
│   ├── parsing.md                        # Step 2A/2B/2D parse rules + regexes + Finding type
│   ├── empty-state-classification.md     # Step 3: 5-case table + classify_cycle pseudocode
│   ├── verify-prompt.md                  # Step 5: prompt template + matrix + retry budget + abort
│   ├── pattern-kb.md                     # Step 6.1-6.4: matching, append, new pattern, index
│   ├── commit-trailers.md                # Step 1 reconciliation + Step 6.6 trailer schema + Step 6.8 reply
│   └── cleanup-recovery.md               # Cleanup: lifecycle table + 3 recovery paths
└── scripts/
    ├── helpers.sh                        # paginated_review_threads_query + extract_trailer (sourceable)
    └── verify.sh                         # codex exec wrapper for the verify gate (executable)
```

**Where to look for what.** SKILL.md is the orchestrator entry point — it
describes WHAT each step does and the contract between steps. Implementation
details (long bash, regex tables, GraphQL queries, the trailer schema, the
classification matrix) live in `references/`. The `scripts/` directory holds
only sourceable / executable shell scripts; one-off bash for a single step
goes into the matching `references/` file, NOT a new `scripts/` file.

Read references on-demand from the per-step "see" links — none of them are
required to start a run, but they carry the load-bearing protocol details.

## Pipeline

```
Step 0 — Resolve PR + assert branch matches PR head
Step 1 — PR_BASE + watermark trailers (Step 6 reconciliation lives here)
Step 1.5 — Non-review CI gate (block until green)
Step 2 — Poll Claude + Codex + Humans → parsed Finding table
Step 3 — Classify cycle: FIX / EXIT_CLEAN / POLL_NEXT / LOUD_FAIL
Step 4 — Fix (or skip-with-rationale) every finding; stage; do NOT commit
Step 5 — Codex verify on staged diff (retry budget 3; docs-only escape)
Step 6 — Pattern KB append → stage → commit → push → reply → resolve threads
Step 7 — Exit check + retro prompt; or poll-next sub-flow
```

## Loop control

- **Max rounds:** 10 (hard cap to prevent runaway loops)
- **Per-round verify retry budget:** 3 (codex-verify re-entries to fix; exceed → cycle abort)
- **Inter-round poll interval:** 60 seconds
- **Inter-round poll timeout:** 10 minutes per round
- **State persistence:** Git commit-message trailers (no `.json` state file). Cycle start derives processed sets via `git log "$PR_BASE..HEAD"`.
- **Per-cycle artifacts:** under `.harness-github-review/` (gitignored). See `references/cleanup-recovery.md`.

## Key invariants

1. **Branch guard:** `git branch --show-current == HEAD_REF` before any
   write op. Step 0 asserts this and aborts otherwise.
2. **No silent-empty path:** Step 3's classification has cases 4 and 5 that
   loud-fail when a reviewer emits a malformed comment. We never treat
   "couldn't parse" as "clean".
3. **No auto-`git stash`:** working-tree visibility is mandatory.
   `references/cleanup-recovery.md` documents the three explicit
   user-driven recovery paths.
4. **Pattern KB appends are ATOMIC with the code fix:** same commit. If
   the commit aborts, the pattern appends discard with it.
5. **Reply + thread-resolve only after codex-verify passes** AND only
   after `git push` succeeds (so the cited commit SHA exists on origin).
6. **State persistence is via commit-message trailers** — no `.json` state
   file. See `references/commit-trailers.md`.

## Codex-verified react + resolve chain

The fate of each comment-thread on a PR is tied to an explicit
codex-verified chain. Reply + thread-resolve only happen if local codex
agrees the fix addressed the upstream finding without introducing new
HIGH/CRITICAL/MEDIUM issues. The reply body cites both the commit SHA
and the codex-verify status so the human reading the resolved thread
sees the fix was independently verified before resolution.

```text
finding (Step 2)
   │
   ▼
fix in working tree (Step 4)  ◀──── retry (≤3) ──── unaddressed / new MEDIUM+
   │                                                       ▲
   ▼                                                       │
stage diff (no commit yet)                                 │
   │                                                       │
   ▼                                                       │
codex exec verify on staged diff (Step 5) ─────────────────┘
   │ pass / pass_with_deferred_LOW
   ▼
commit with watermark trailers (Step 6.6)
   │
   ▼
git push (Step 6.7)
   │
   ▼
reply on comment (Step 6.8)
   │   body cites: COMMIT_SHA + (codex-verify cycle N: pass | pass_with_deferred_LOW | skipped: docs-only)
   ▼
resolveReviewThread mutation (Step 6.9)
```

If codex verify fails (`unaddressed_upstream`, `new_medium`, `new_high`,
`verify_timeout`, `verify_error`, `contradiction`, retry-exhausted) the
chain ABORTS before commit. No reply, no thread-resolve, no trailer
update. The cycle exits with the abort directory preserved per
`references/cleanup-recovery.md`.

References:

- `references/verify-prompt.md` — codex prompt template + result-classification matrix.
- `references/commit-trailers.md` — reply-body template (with the verify-status citation).

## Bootstrap

Source the helper functions used across multiple steps. SKILL.md is loaded
by the Claude Code plugin runner — there is no `$0` invocation context, and
the orchestrator runs from the **repo root** (the runner's CWD when a skill
fires). The helpers live at a known relative path under the working tree
(or under the plugin cache, depending on whether the local working tree is
authoritative for the skill).

```bash
# Skill source lives at a stable path relative to the repo root.
# Prefer the working-tree copy if it exists (lets local edits to helpers.sh
# take effect immediately during dogfood); otherwise fall back to the
# git-toplevel join for safety on detached worktrees.
SKILL_DIR="plugins/harness/skills/github-review"
[ -d "$SKILL_DIR" ] || SKILL_DIR="$(git rev-parse --show-toplevel 2>/dev/null)/plugins/harness/skills/github-review"

if [ ! -f "$SKILL_DIR/scripts/helpers.sh" ]; then
  echo "ERROR: helpers.sh not found at $SKILL_DIR/scripts/helpers.sh" >&2
  echo "The skill must be invoked from the repo root (or a worktree of it)." >&2
  exit 1
fi
source "$SKILL_DIR/scripts/helpers.sh"
```

Why not `dirname "$(realpath "$0")"`? In an interactive shell `$0` is the
shell name (e.g. `bash`), so `realpath "$0"` returns `/usr/bin/bash` and
the source path resolves to `/usr/bin/scripts/helpers.sh` — a spurious
file-not-found that masks every subsequent step. Hard-coding the
repo-relative path is more predictable for a skill whose entry point is
always the repo root.

`scripts/helpers.sh` defines `paginated_review_threads_query` (used in
Steps 1, 2B, and 7.1) and `extract_trailer` (used in Step 1).

Run the loop-start scan to handle prior aborted artifacts before
anything else:

```bash
loop_start_scan   # defined in references/cleanup-recovery.md
```

## Step 0 — Input resolution

The skill supports both current-branch operation and explicit PR
targeting. **Explicit PR targeting only changes which PR is _read_ from —
write operations (commit, push) still happen on the current `git`
checkout.** This step enforces that the current branch matches the PR's
head ref so fixes can never accidentally land on the wrong branch.

Resolve `PR_NUMBER` from `USER_SUPPLIED_PR_NUMBER` (env var or `$1`) or
fall back to `gh pr view --json number`. Then derive `REPO` / `OWNER` /
`NAME` / `BASE_REF` / `HEAD_REF`. Abort if the current branch does not
match `HEAD_REF` — fixes would otherwise land on the wrong branch.

See `references/input-resolution.md` for the full bash, the worktree
recipe, and the per-error-case prompts.

## Step 1 — Resolve `PR_BASE` and derive watermarks from commit trailers

The processed-set watermarks live in commit-message trailers on prior fix
commits in this PR. We need `PR_BASE` (the commit where this PR's branch
diverged from `BASE_REF`) so we can scope `git log` correctly across
base-branch renames and stacked PRs. This step also reconciles the
`Closes-Codex-Threads` trailer against live GraphQL state — see
`references/commit-trailers.md` for the trailer schema and the
reconciliation rationale.

Operations:

1. `git fetch origin "$BASE_REF" --no-tags`; `PR_BASE=$(git merge-base
HEAD "origin/$BASE_REF")`.
2. Read each watermark via `extract_trailer "<key>"` (helper in
   `scripts/helpers.sh`). Keys are listed in `references/commit-trailers.md`
   § Trailer schema.
3. Compute `CLAUDE_HANDLED_IDS = PROCESSED_CLAUDE_IDS ∪ SUPERSEDED_CLAUDE_IDS`.
4. Reconcile `CLOSED_CODEX_THREADS` against live GraphQL state — drops
   stale entries (push succeeded but reply/resolve failed).

See `references/commit-trailers.md` § Step 1 — Reading trailers back via
`extract_trailer` for the bash invocation, the full trailer schema, the
multi-line `Pattern-Files-Touched` continuation form, and § Step 1 —
Reconciliation against live GitHub state for the awk-based set-difference
logic.

## Step 1.5 — Non-review CI gate

Before looking at review comments, ensure the PR's non-review CI checks
are green. Failing review-side checks (the disabled `Codex Code Review`
job, or the Claude review job mid-flight) are NOT blockers; we don't gate
on them.

```bash
gh pr checks "$PR_NUMBER"
```

If any checks **other than `Codex Code Review` and `Claude Code Review`**
are failing (e.g., Code Quality Check, Unit Tests, Tauri Build):

1. Read the failing check's log: `gh run view <run_id> --log-failed`
2. Fix the issue (formatting, lint, type errors, test failures)
3. Commit and push the fix in a separate non-review-fix commit (does NOT
   use the trailer schema)
4. Re-run `gh pr checks` until non-review CI is green

Common CI failure recipes:

- **Code Quality Check (Prettier):** `npx prettier --write <flagged files>`
- **Code Quality Check (ESLint):** `npm run lint:fix`
- **Unit Tests:** `npm run test` to reproduce, then fix
- **Type-check:** `npm run type-check` to reproduce

Only proceed to Step 2 once all non-review CI is passing.

## Step 2 — Poll both reviewers + parse findings

Step 2 polls three reviewer surfaces, parses each into a uniform `Finding`
shape, and aggregates into the per-cycle finding table that Step 3
classifies and Step 4 fixes.

- **Step 2A** — Claude reviewer (issue comments, aggregated, no threads).
  Take the latest unprocessed comment; mark older unprocessed as
  superseded.
- **Step 2B** — Codex connector reviewer. Two-step poll: review summaries
  then inline comments scoped to unprocessed review IDs. Race-retry when
  summary appears before inline (6 × 5s). Build inline-id → thread-id map
  via `paginated_review_threads_query` (loud-fail on GraphQL failure).
- **Step 2D** — Human reviewers (issue + inline). Unstructured prose;
  default severity MEDIUM with heuristic overrides for `nit:` /
  `wontfix` / explicit `[SEV]` tags.
- **Step 2C** — Aggregate into the `Finding` table; assign sequential
  `cycle_id` strings (`F1`, `F2`, ...).

```bash
# Brief operational gist — full poll, parse, race-retry logic in
# references/parsing.md.

# 2A — Claude (latest aggregated comment).
CLAUDE_COMMENTS_JSON=$(gh api "repos/$REPO/issues/$PR_NUMBER/comments" --paginate \
  | jq -s 'add | [.[] | select(
           .user.login == "github-actions[bot]"
           and (.body | startswith("## Claude Code Review"))
         )]')
# ... compute LATEST_CLAUDE / LATEST_CLAUDE_ID / SUPERSEDED_THIS_CYCLE

# 2B — Connector (reviews → inline, scoped to unprocessed review IDs).
NEW_REVIEWS_JSON=$(gh api "repos/$REPO/pulls/$PR_NUMBER/reviews" --paginate \
  | jq -s 'add | [.[] | select(.user.login == "chatgpt-codex-connector[bot]")]')
# ... NEW_INLINE_JSON, race-retry, build INLINE_TO_THREAD_MAP

# 2D — Humans (issue + inline).
# 2C — Aggregate into FINDINGS_JSON with cycle_id F1..FN.
```

See `references/parsing.md` for the full poll-and-parse implementation —
regex tables, GraphQL query usage, race-retry loop, path normalization,
verdict patterns, and the `Finding` TypeScript type.

## Step 3 — Empty-state classification

Classify the cycle into exactly one of five cases:

| Case | Outcome                                                               |
| ---- | --------------------------------------------------------------------- |
| 1    | No new content — `POLL_NEXT` (Step 7 sub-flow)                        |
| 2    | At least one new finding — `FIX` (Step 4)                             |
| 3    | Both reviewers explicitly clean — `EXIT_CLEAN` (Step 7 retro prompt)  |
| 4    | Reviewer comment present but unparseable — **loud-fail**, abort cycle |
| 5    | Reviewer says "issues" but lists none — **loud-fail**, abort cycle    |

**No silent-empty path** — every empty result is either case 3 (explicit
clean) or case 4/5 (loud-fail). On `LOUD_FAIL`, write the offending raw
body to `.harness-github-review/cycle-${ROUND}-loud-fail-<source>.txt` and
`exit 1`.

See `references/empty-state-classification.md` for the full case table and
the `classify_cycle` pseudocode.

## Step 4 — Fix all findings

For each finding in the cycle's finding table, in order:

1. **Read the file** at the specified `file` path and `line_range`. Use
   the `Read` tool with `offset` and `limit` parameters.
2. **Understand the issue** — the finding's `body` describes what's wrong
   and (often) suggests a fix. Cross-reference with the IDEA block if
   present (Claude reviewer always includes it; connector typically does
   not).
3. **Decide:**
   - **FIX** — make the minimal change to resolve the issue. Use `Edit`
     for surgical changes; `Write` only for whole-file replacements.
   - **SKIP** — explain why in the finding's `fix_summary` field. Valid
     reasons: false positive, intentional pattern with rationale, out of
     scope (the finding flagged adjacent untouched code in violation of
     the SCOPE BOUNDARY RULE).
4. After the change, set `finding.status = 'fixed'` (or `'skipped'`) and
   `finding.fix_summary = <one-sentence description>`.

**Rules:**

- Fix **only** what the review identified. No drive-by refactoring.
- Never introduce new issues while fixing existing ones — Step 5's codex
  verify catches this if it slips through, but the discipline is to think
  about new-issue risk at fix time.
- Run quick local validation as you go (`npm run lint -- <file>`, `cargo
check`, etc.) — but **do not** run the full test suite per finding. The
  full validation runs in Step 5.
- For each finding, also consult
  `docs/reviews/patterns/<matching-pattern>.md` BEFORE fixing if the
  pattern is relevant — it may carry prior fixes for the same finding
  class. If you read a pattern file, bump its `ref_count` in frontmatter
  by 1 (consumer-bumps-on-read protocol from `docs/reviews/CLAUDE.md`).

**Do NOT commit yet.** Stage all changes (`git add`) but defer commit
until after Step 5 (codex verify) passes.

After the loop, every finding has `status` ∈ {`fixed`, `skipped`}.
Findings still `pending` after the loop = a bug in the loop logic;
loud-fail.

## Step 5 — Codex verify on staged diff

Run `codex exec` against the staged diff to verify (a) every upstream
finding is addressed and (b) no new MEDIUM/HIGH/CRITICAL issues introduced.
New LOW issues are deferred (allowed; recorded in commit message).

Brief invariant: **codex verifies before reply or thread-resolve runs.**
The verify gate is the only thing standing between staged fixes and the
commit; all reply/resolve actions in Step 6 are downstream of a passing
verify.

```bash
mkdir -p .harness-github-review
DIFF_PATCH=".harness-github-review/cycle-${ROUND}-diff.patch"
PROMPT_FILE=".harness-github-review/cycle-${ROUND}-verify-prompt.md"
RESULT_JSON=".harness-github-review/cycle-${ROUND}-verify-result.json"
EVENTS_LOG=".harness-github-review/cycle-${ROUND}-verify-events.log"
STDERR_LOG=".harness-github-review/cycle-${ROUND}-verify-stderr.log"

# Build the prompt (template in references/verify-prompt.md § Step 5B).
git diff --staged > "$DIFF_PATCH"
# ... render findings table + diff into PROMPT_FILE

# Invoke codex via the verify wrapper.
"$SKILL_DIR/scripts/verify.sh" "$PROMPT_FILE" "$RESULT_JSON" "$EVENTS_LOG" "$STDERR_LOG"
CODEX_EXIT=$?

# Classify result via the matrix (Step 5D).
# Re-enter Step 4 if unaddressed_upstream / new_medium / new_high
# (retry budget ≤ 3). Continue Step 6 if pass / pass_with_deferred.
# Abort on verify_timeout / verify_error / contradiction / retry-exhausted.
```

See `references/verify-prompt.md` for the prompt template, the 5D
classification matrix, the retry budget semantics, the docs-only escape
(5F), and the abort path (5G — `incident.md` schema).

## Step 6 — Pattern KB → stage → commit → push → reply → resolve threads

This step lands the cycle's work atomically. **Order matters** — pattern
files must be written BEFORE the commit (so they're part of the same
commit as the code fix), and reply + thread resolution must come AFTER
push (so the cited commit SHA exists on origin).

1. **6.1 Match** each fixed finding to a pattern file
   (`docs/reviews/patterns/<slug>.md`). See `references/pattern-kb.md`
   § Step 6.1.
2. **6.2 Append** entries to existing patterns under `## Findings` (next
   `### N.` index). See `references/pattern-kb.md` § Step 6.2.
3. **6.3 Create** new patterns when fallback rules require. See
   `references/pattern-kb.md` § Step 6.3.
4. **6.4 Update** the pattern index (`docs/reviews/CLAUDE.md` table). See
   `references/pattern-kb.md` § Step 6.4.
5. **6.5 Stage** pattern files + index explicitly (no `git add -A`). Code
   fixes are already staged from Step 4.
6. **6.6 Commit** with the watermark-trailer template. See
   `references/commit-trailers.md` for the full template (including the
   cycle-1 commitlint fixes for `Pattern-Files-Touched` and
   footer-leading-blank).
7. **6.7 Push.**
8. **6.8 Reply** to each connector inline finding, each human inline
   finding, and each human issue comment.
9. **6.9 Resolve** connector + human-inline threads via GraphQL
   `resolveReviewThread`.

```bash
# 6.5 Stage explicitly.
STAGED_FILES=()
for f in "${TOUCHED_PATTERN_FILES[@]}"; do STAGED_FILES+=("$f"); done
# INDEX_TOUCHED must be set whenever Step 6.4 updates docs/reviews/CLAUDE.md
# — either appending a row for a new pattern (Step 6.3) OR rewriting an
# existing row's Findings count / Last Updated (Step 6.2). See
# references/pattern-kb.md § Step 6.4 for the invariant.
[ "${INDEX_TOUCHED:-0}" -eq 1 ] && STAGED_FILES+=("docs/reviews/CLAUDE.md")
[ "${#STAGED_FILES[@]}" -gt 0 ] && git add "${STAGED_FILES[@]}"
git status --short

# 6.6 Commit using the trailer template (references/commit-trailers.md).
git commit -F "$COMMIT_MSG_FILE"
COMMIT_SHA=$(git rev-parse HEAD)

# 6.7 Push.
git push
```

NOTE on 6.5: do **not** use `git diff --name-only` to enumerate code-fix
files. It reports working-tree-vs-index, which is empty for files Step 4
already staged — and would instead pick up unrelated unstaged edits
(debug files, half-finished work) and sweep them into the review-fix
commit.

### 6.8 — Reply

Reply to every fixed AND skipped connector + human finding so reviewers
see the disposition before 6.9 resolves threads. Both states need a
reply — skipped findings need a rationale on the thread before resolve;
otherwise Step 7's unresolved-threads check would never reach exit-clean.

Three branches: connector inline + human inline use thread-reply (`POST
/pulls/$PR/comments/$ID/replies`); human issue comments use a new
issue-level comment (`POST /issues/$PR/comments`) that quotes the
original body — there is no thread-reply endpoint for issue comments.
Iterate via `while IFS= read -r finding; do ...; done < <(jq -c '...')`
(process substitution) — NOT `for finding in $(jq -c ...)`, which
word-splits JSON containing spaces.

See `references/commit-trailers.md` § Step 6.8 for the full unified
implementation, the body-shape spec, and the 3-branch routing table.

### 6.9 — Resolve threads via GraphQL

Resolve threads for fixed AND skipped connector AND human-inline findings.
Issue-comment-level human findings have no thread; the reply in 6.8 is
sufficient.

```bash
# Use process-substitution + while read for consistency with Step 6.8.
# PRRT_ IDs have no embedded spaces today, but the for-in-$() form would
# silently corrupt iteration if the format ever changed.
#
# Capture the full response and validate via _assert_graphql_response_ok
# (see scripts/helpers.sh). `gh api graphql` exits 0 even when GitHub returns
# `{"errors": [...], "data": null}` (auth, rate-limit, stale node ID); the
# `--jq '...'` shorthand would silently emit `null` and the loop would mark
# the thread as "resolved" in the trailer when GitHub never resolved it.
# Same bug class as paginated_review_threads_query — see references/commit-trailers.md
# § Reconciliation for the symptom this prevents.
while IFS= read -r thread_id; do
  [ -z "$thread_id" ] && continue
  RESP=$(gh api graphql -f query='
    mutation($threadId:ID!) {
      resolveReviewThread(input:{threadId:$threadId}) {
        thread { id isResolved }
      }
    }' -F threadId="$thread_id") || {
    echo "ERROR: gh api graphql exited non-zero resolving thread $thread_id" >&2
    continue
  }
  if ! _assert_graphql_response_ok "$RESP" \
       '.data.resolveReviewThread.thread' \
       "resolveReviewThread $thread_id"; then
    continue
  fi
  jq '.data.resolveReviewThread.thread' <<< "$RESP"
done < <(list_thread_ids_to_close)
```

`list_thread_ids_to_close` returns thread IDs for all findings with
`thread_id != null` AND `(source == "codex-connector" OR source ==
"human")` AND `(status == "fixed" OR status == "skipped")`. After 6.8 +
6.9, the cycle is done. Proceed to Step 7.

## Step 7 — Exit check + retro prompt

After Step 6 commits + pushes (or after Step 3 returned `EXIT_CLEAN` /
`POLL_NEXT`), determine if the loop continues or exits.

### 7.1 — Check unresolved threads (connector + human)

Reuse `paginated_review_threads_query`. Two parallel counts: connector
unresolved threads and human unresolved threads.

```bash
ALL_THREADS=$(paginated_review_threads_query) || {
  echo "ERROR: paginated_review_threads_query failed in Step 7.1." >&2
  exit 1
}

UNRESOLVED_CONNECTOR_THREADS=$(jq '[.[] | select(
  .comment_author_login == "chatgpt-codex-connector"
  and .isResolved == false
)] | length' <<< "$ALL_THREADS")

UNRESOLVED_HUMAN_THREADS=$(jq '[.[] | select(
  .comment_author_type == "User"
  and .isResolved == false
)] | length' <<< "$ALL_THREADS")
```

**Why no fresh-verdict gate?** Earlier iterations tried to require a
"fresh clean summary review" from the connector before exiting clean.
That doesn't work — the connector posts a fixed informational summary
only when it has suggestions; on a clean run, it emits a 👍 reaction with
no summary review at all. There's no programmatic clean-summary signal.
The freshness gate is provided instead by Step 7.4's 10-minute poll-next
window: if no new connector activity (review summary OR inline comment)
appears during that window and Claude is clean, the loop legitimately
exits clean.

### 7.2 — Check Claude verdict on the latest comment

After Step 6's push, the Claude reviewer will re-run on the new commit.
The verdict on its NEW comment determines if Claude is satisfied. If we're
at this step right after a fresh commit, the new Claude review hasn't run
yet — that's the "poll-next" case.

### 7.3 — Decide

- **All clean** = `UNRESOLVED_CONNECTOR_THREADS == 0` AND
  `UNRESOLVED_HUMAN_THREADS == 0` AND latest Claude comment verdict is
  `is_claude_clean` → **exit clean** (regardless of round number).
- **More expected** = either reviewer hasn't reported on the new commit
  yet (Claude not clean OR connector posted new review/inline content
  this cycle) → **poll next** (if `ROUND < MAX_ROUNDS`) or fall through.
- **Max rounds reached** = `ROUND == MAX_ROUNDS` AND clean condition NOT
  met → exit "max rounds" (abnormal — print warning).

### 7.4 — Poll-next sub-flow

```bash
echo "Round $ROUND committed — polling for next review (60s × 10 rounds)."

for poll_attempt in $(seq 1 10); do
  sleep 60
  # Re-poll Claude and connector exactly as Step 2.
  if step_2_yields_new_content; then
    ROUND=$((ROUND + 1))
    goto_step_2
  fi
done

# Poll timeout → abnormal exit. Reviewers haven't produced a clean verdict
# within the 10-minute window after the last push; we must NOT report clean.
REASON="poll-timeout"
goto_step_7_abnormal_exit_message
```

### 7.5 — Clean exit message + retro prompt

Print a ✅ banner with totals (fixed / skipped / pattern files touched /
threads resolved), offer the user a retro option, then run
`cleanup_on_clean_exit`. The skill **does NOT auto-write retros** —
synthesis needs hindsight. See `references/cleanup-recovery.md` § Step
7.5 for the verbatim message HEREDOC.

### 7.6 — Abnormal exit

Three `REASON` values:

- `"poll-timeout"` — Step 7.4's 10×60s window elapsed.
- `"max-rounds"` — `ROUND == MAX_ROUNDS` and clean condition not met.
- `"abort"` — a cycle hit a loud-fail abort (verify failure, push
  failure) and bubbled up.

In all three cases artifacts under `.harness-github-review/` are
**preserved** — `cleanup_on_clean_exit` is **never** called on this
path. Print a ⚠️ banner with `$ROUND`, `$REASON`, the path to
`incident.md`, the latest `verify-result.json` path, and a
`human_guidance_for_reason "$REASON"` recommendation. Then `exit 1`. See
`references/cleanup-recovery.md` § Step 7.6 for the verbatim message
HEREDOC and the per-`REASON` guidance strings.

## Troubleshooting / Q&A

When things break mid-loop, consult these quick recipes before reaching
for `incident.md`. Each entry is "symptom → likely cause → fastest fix."

1. **"Step 0 aborts: Current branch is X but PR #N head is Y."** Either
   `git switch '<Y>'` (if no in-progress work blocks it), or create a
   worktree at `.claude/worktrees/<Y>` and re-run from there. See
   `references/input-resolution.md` § "Why explicit PR targeting still
   requires a matching checkout" for the rationale.

2. **"Codex verify aborts with `verify_timeout`."** External `timeout 300`
   fired. Re-run; if recurrent, the staged diff may be too large (split
   the cycle by reverting some fixes) or the codex CLI itself is hung
   (`codex --version` to check). The abort directory at
   `.harness-github-review/cycle-N-aborted/incident.md` records the
   prompt and partial output.

3. **"Codex verify aborts with `verify_error`."** Non-zero exit from
   `codex exec` (not 124). Common cause: ChatGPT-account auth + explicit
   `--model` flag (rejected). Verify wrapper omits `--model` per
   auto-memory `feedback_codex_model_for_chatgpt_auth`. Read
   `.harness-github-review/cycle-N-verify-stderr.log` for the exact
   error string.

4. **"Reconciliation says `STALE_THREAD_IDS` but threads look resolved on
   GitHub."** GitHub API caching can lag a few seconds — re-run. If the
   trailer keeps re-claiming closed threads, manually resolve via
   `gh api graphql -f query='mutation { resolveReviewThread(input:{threadId:"PRRT_..."}) { thread { isResolved } } }'`
   then re-run.

5. **"Pre-commit hook keeps rejecting commitlint."** See
   `references/commit-trailers.md` § Cycle-1 commitlint fixes. Common
   nits: subject case (lowercase only), `Pattern-Files-Touched` line
   length (use multi-line continuation), missing blank line before the
   trailer block.

6. **"Plugin cache out of sync with working tree."** After editing
   SKILL.md or any `references/*.md`, re-sync the cache:
   `cp -r plugins/harness/skills/github-review ~/.claude/plugins/cache/harness/harness-plugin/0.0.1/skills/`.
   Skills are loaded from cache, not the working tree (when invoked via
   `/harness-plugin:github-review`).

7. **"Loop hits `max-rounds`."** 10 fix-cycles didn't reach clean. Either
   reviewers found a class of bug the agent can't fix (escalate to human
   review on the PR) or the verify gate is rejecting fixes spuriously
   (read `cycle-N-verify-result.json` — look for `[UNADDRESSED Fk]`
   findings to identify which finding never converged).

8. **"Connector author shows as `chatgpt-codex-connector` not
   `chatgpt-codex-connector[bot]`."** GraphQL strips the `[bot]` suffix,
   REST keeps it. Filters consuming `paginated_review_threads_query`
   output (Step 2B INLINE_TO_THREAD_MAP and Step 7.1's connector check)
   match the bare login. See `scripts/helpers.sh` header for the full
   table.

9. **"Step 6.4 didn't update the index, even though pattern files
   changed."** `INDEX_TOUCHED=1` must be set whenever any pattern entry
   is appended (Step 6.2) or any new pattern is created (Step 6.3) — see
   `references/pattern-kb.md` § Step 6.4. If the flag is unset,
   Step 6.5's stage list excludes `docs/reviews/CLAUDE.md`.

## Cleanup, recovery & failsafe

Per-cycle artifacts under `.harness-github-review/` follow a strict
lifecycle (keep across rounds, wipe on clean exit, preserve on abort).
The skill never auto-`git stash`es; three explicit user-driven recovery
paths are documented for the abort case.

See `references/cleanup-recovery.md` for the full lifecycle table, the
three recovery paths, the `loop_start_scan` / `cleanup_on_clean_exit`
helpers, the rationale for no-auto-stash, and the manual-full-reset
escape hatch.

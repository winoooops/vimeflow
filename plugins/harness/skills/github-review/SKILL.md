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
│   ├── parsing.md                        # Step 2A/2B/2D parse rules + regexes + Finding type
│   ├── empty-state-classification.md     # Step 3: 5-case table + classify_cycle pseudocode
│   ├── verify-prompt.md                  # Step 5: prompt template + matrix + retry budget + abort
│   ├── pattern-kb.md                     # Step 6.1-6.4: matching, append, new pattern, index
│   ├── commit-trailers.md                # Step 6.6: full trailer schema + commit-message template
│   └── cleanup-recovery.md               # Cleanup: lifecycle table + 3 recovery paths
└── scripts/
    ├── helpers.sh                        # paginated_review_threads_query + extract_trailer
    └── verify.sh                         # codex exec wrapper for the verify gate
```

Read references on-demand from the per-step "see" links — none of them are
required to start a run, but they carry the load-bearing protocol details
(GraphQL queries, regexes, classification table, trailer schema).

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

## Bootstrap

Source the helper functions used across multiple steps:

```bash
SCRIPT_DIR="$(dirname "$(realpath "$0")")"
source "$SCRIPT_DIR/scripts/helpers.sh"
```

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

```bash
USER_SUPPLIED_PR_NUMBER="${USER_SUPPLIED_PR_NUMBER:-${1:-}}"

if [ -n "$USER_SUPPLIED_PR_NUMBER" ]; then
  PR_NUMBER="$USER_SUPPLIED_PR_NUMBER"
else
  PR_NUMBER=$(gh pr view --json number --jq .number 2>/dev/null)
fi

if [ -z "${PR_NUMBER:-}" ]; then
  echo "ERROR: No PR found. Either:" >&2
  echo "  1) Run from a branch that has an open PR, or" >&2
  echo "  2) Set USER_SUPPLIED_PR_NUMBER=<number> AND check out the PR's head branch" >&2
  echo "     (or use a worktree on that branch)." >&2
  exit 1
fi

REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
OWNER=${REPO%%/*}
NAME=${REPO#*/}
BASE_REF=$(gh pr view "$PR_NUMBER" --json baseRefName --jq .baseRefName)
HEAD_REF=$(gh pr view "$PR_NUMBER" --json headRefName --jq .headRefName)

# Safety guard — current branch MUST match the PR's head ref.
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "$HEAD_REF" ]; then
  echo "ERROR: Current branch is '$CURRENT_BRANCH' but PR #$PR_NUMBER head is '$HEAD_REF'." >&2
  echo "Fixes would commit + push to the wrong branch." >&2
  echo "Either:" >&2
  echo "  1) git switch '$HEAD_REF' (if no other in-progress work blocks it), or" >&2
  echo "  2) Create a worktree on the PR branch:" >&2
  echo "       git worktree add .claude/worktrees/$HEAD_REF '$HEAD_REF'" >&2
  echo "       cd .claude/worktrees/$HEAD_REF" >&2
  echo "     and re-run the skill from there." >&2
  exit 1
fi

echo "Working on PR #$PR_NUMBER (repo: $REPO, base: $BASE_REF, head: $HEAD_REF)"
```

## Step 1 — Resolve `PR_BASE` and derive watermarks from commit trailers

The processed-set watermarks live in commit-message trailers on prior fix
commits in this PR. We need `PR_BASE` (the commit where this PR's branch
diverged from `BASE_REF`) so we can scope `git log` correctly across
base-branch renames and stacked PRs. This step also reconciles the
`Closes-Codex-Threads` trailer against live GraphQL state — see
`references/commit-trailers.md` for the trailer schema and the
reconciliation rationale.

```bash
git fetch origin "$BASE_REF" --no-tags
PR_BASE=$(git merge-base HEAD "origin/$BASE_REF")

PROCESSED_CLAUDE_IDS=$(extract_trailer "GitHub-Review-Processed-Claude")
SUPERSEDED_CLAUDE_IDS=$(extract_trailer "GitHub-Review-Superseded-Claude")
PROCESSED_CODEX_REVIEW_IDS=$(extract_trailer "GitHub-Review-Processed-Codex-Reviews")
PROCESSED_CODEX_INLINE_IDS=$(extract_trailer "GitHub-Review-Processed-Codex-Inline")
CLOSED_CODEX_THREADS=$(extract_trailer "Closes-Codex-Threads")
PROCESSED_HUMAN_ISSUE_IDS=$(extract_trailer "GitHub-Review-Processed-Human-Issue")
PROCESSED_HUMAN_INLINE_IDS=$(extract_trailer "GitHub-Review-Processed-Human-Inline")

CLAUDE_HANDLED_IDS=$(printf '%s,%s' "$PROCESSED_CLAUDE_IDS" "$SUPERSEDED_CLAUDE_IDS" \
  | tr ',' '\n' | awk 'NF' | sort -u | tr '\n' ',' | sed 's/,$//')

# Reconcile CLOSED_CODEX_THREADS against live GraphQL state. Full logic +
# rationale in references/commit-trailers.md § Step 1 — Reconciliation.
```

See `references/commit-trailers.md` for the reconciliation block, the full
trailer schema, and the multi-line `Pattern-Files-Touched` continuation
form.

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
"$SCRIPT_DIR/scripts/verify.sh" "$PROMPT_FILE" "$RESULT_JSON" "$EVENTS_LOG" "$STDERR_LOG"
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
for thread_id in $(list_thread_ids_to_close); do
  gh api graphql -f query='
    mutation($threadId:ID!) {
      resolveReviewThread(input:{threadId:$threadId}) {
        thread { id isResolved }
      }
    }' -F threadId="$thread_id" \
    --jq '.data.resolveReviewThread.thread'
done
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
  .comment_author_login == "chatgpt-codex-connector[bot]"
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

## Cleanup, recovery & failsafe

Per-cycle artifacts under `.harness-github-review/` follow a strict
lifecycle (keep across rounds, wipe on clean exit, preserve on abort).
The skill never auto-`git stash`es; three explicit user-driven recovery
paths are documented for the abort case.

See `references/cleanup-recovery.md` for the full lifecycle table, the
three recovery paths, the `loop_start_scan` / `cleanup_on_clean_exit`
helpers, the rationale for no-auto-stash, and the manual-full-reset
escape hatch.

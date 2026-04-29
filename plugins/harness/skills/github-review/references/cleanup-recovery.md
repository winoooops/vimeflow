# Cleanup, Recovery & Failsafe

This file is the implementation reference for the **§ Cleanup** section of
`../SKILL.md`. The skill writes per-cycle artifacts under
`.harness-github-review/` (gitignored). This file documents:

- Per-cycle artifact lifecycle (when to keep, when to wipe)
- Why the skill does NOT auto-`git stash`
- Three explicit user-driven recovery paths on abort
- Pattern-file rollback semantics
- Watermark-trailer durability

## Per-cycle artifact lifecycle

The skill writes `cycle-${ROUND}-*` files to `.harness-github-review/`
(gitignored): `cycle-${ROUND}-diff.patch`,
`cycle-${ROUND}-verify-prompt.md`, `cycle-${ROUND}-verify-result.json`,
`cycle-${ROUND}-verify-events.log`, `cycle-${ROUND}-verify-stderr.log`. On
abort, also `cycle-${ROUND}-aborted/`.

| Event                                                                                               | Action                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Round N commits OK, loop continuing to N+1                                                          | **Keep** N's artifacts. Next round may compare.                                                                                                                                                                                                                                                              |
| Round N aborts → loop exits                                                                         | **Preserve everything** in `.harness-github-review/`. Print recovery instructions (below).                                                                                                                                                                                                                   |
| Loop exits cleanly (final round verdict clean)                                                      | `cleanup_on_clean_exit`: wipe non-aborted `cycle-*-{diff,verify-prompt,verify-result,verify-events,verify-stderr}.{patch,md,json,log}` files. **Preserve any `cycle-*-aborted/` dirs** from earlier rounds in this run. Print "cleaned N artifact files from this run".                                      |
| New `/harness-plugin:github-review` invocation, `.harness-github-review/` already has prior content | **Scan first.** If any `cycle-*-aborted/` dirs found from prior loops → **prompt user**: list paths, suggest inspecting, do NOT auto-delete. Skill exits without starting a new loop. If only orphaned `cycle-*` files exist → wipe with one-line "cleaned N stale files from prior run" notice and proceed. |

The "scan-on-loop-start, prompt-don't-delete" rule for prior aborted dirs
is the **load-bearing forensics guarantee**: aborted dirs are the evidence
we need when the loop failed in a confusing way. Auto-deleting violates
the loud-fail / preserve-forensics posture.

## Cleanup helpers

```bash
loop_start_scan() {
  if [ ! -d .harness-github-review ]; then return 0; fi

  local aborted_dirs
  aborted_dirs=$(find .harness-github-review -maxdepth 1 -type d -name 'cycle-*-aborted' 2>/dev/null)

  if [ -n "$aborted_dirs" ]; then
    echo "Found prior aborted cycle(s):" >&2
    echo "$aborted_dirs" | sed 's/^/  /' >&2
    echo "" >&2
    echo "Inspect each cycle-*-aborted/incident.md before continuing." >&2
    echo "Once resolved, remove them with: rm -rf .harness-github-review/cycle-*-aborted/" >&2
    echo "Then re-run /harness-plugin:github-review." >&2
    exit 1
  fi

  # Wipe orphan non-aborted artifacts.
  local orphans
  orphans=$(find .harness-github-review -maxdepth 1 -type f -name 'cycle-*' 2>/dev/null | wc -l)
  if [ "$orphans" -gt 0 ]; then
    find .harness-github-review -maxdepth 1 -type f -name 'cycle-*' -delete
    echo "Cleaned $orphans stale artifact files from prior run."
  fi
}

cleanup_on_clean_exit() {
  if [ ! -d .harness-github-review ]; then return 0; fi

  local count=0
  while IFS= read -r f; do
    rm -f "$f"
    count=$((count + 1))
  done < <(find .harness-github-review -maxdepth 1 -type f -name 'cycle-*')

  if [ "$count" -gt 0 ]; then
    echo "Cleaned $count artifact files from this run."
  fi

  # Aborted dirs (if any) are preserved.
}
```

`loop_start_scan` runs in the Bootstrap section, before Step 0 (input
resolution). It must execute before any step reads or writes PR state.
`cleanup_on_clean_exit` runs in Step 7.5.

## No `git stash`, by design

The skill does NOT auto-`git stash`. Reasons:

1. **Working-tree visibility.** Auto-hiding contradicts loud-fail
   discipline. (See SKILL.md key invariant: "no auto-`git stash` —
   working-tree visibility.")
2. **Loop state lives elsewhere.** Persistent state is GitHub +
   commit-message trailers (see `commit-trailers.md`). Abort artifacts are
   `.harness-github-review/cycle-*-aborted/`. Stash would be a third
   surface.
3. **Stash is user-controlled.** A parking lot for the user's own workflow
   needs.

Stash is documented as one of three explicit user-driven recovery paths
(below), not an automatic step.

## Three recovery paths on abort

The skill prints all three in the abort exit message (`verify-prompt.md`
§5G):

```
Cycle ${ROUND} aborted in verify after ${RETRY_COUNT} attempts.
See ${ABORT_DIR}/.

Working tree contains the last attempted fix.

  # Inspect first:
  git status
  git diff
  git diff --staged

Choose ONE recovery path:

  # 1. Discard the attempt entirely
  git restore --staged .
  git restore .
  # Then remove only the untracked paths listed in:
  #   ${ABORT_DIR}/untracked.txt
  # Review that file before any rm — do NOT run a blanket `git clean -fd`.

  # 2. Keep & finish manually
  # (edit files, then `git add` and `git commit` yourself)

  # 3. Snapshot the attempt as a stash for later
  git stash push -u -m "github-review cycle ${ROUND} aborted attempt"
  # Restore later with: git stash pop
```

Notes on path 1:

- `git restore --staged . && git restore .` reverts both index and
  working-tree mods, including staged deletions (which `git checkout -- .`
  misses).
- Untracked-file removal is **per-path from `untracked.txt`**, not blanket
  `git clean -fd`. Blanket clean risks deleting unrelated work.

## Pattern-file rollback is N/A

Pattern appends only happen if the cycle's commit succeeds (atomicity:
pattern files are staged in Step 6.5 alongside code-fix files; everything
lands in the single Step 6.6 commit). On abort, attempted appends are
still in the working tree alongside the code fix — discarded by recovery
path 1, kept by paths 2/3.

## Watermark trailers are durable

Trailers live in committed history; nothing to clean. If the entire fix
commit needs to be undone (`git reset HEAD~1`), the trailers vanish with
the commit and the next cycle re-derives a smaller processed set.
Self-healing.

See `commit-trailers.md` for the full trailer schema and reconciliation
behavior.

## Manual full reset

```bash
rm -rf .harness-github-review/
```

Safe because gitignored. Wipes all artifacts including aborted dirs. User
invokes only after resolving aborted dirs.

## Step 7.5 — Clean exit message (verbatim)

```bash
cat <<EOF
✅ Review loop complete after $ROUND rounds.

  Findings processed: $TOTAL_FIXED (fixed) / $TOTAL_SKIPPED (skipped)
  Pattern files touched: $TOTAL_PATTERN_FILES
  Connector threads resolved: $TOTAL_THREADS_RESOLVED

Want a retrospective written for this cycle?

  • If your environment has a /write-retro skill: run \`/write-retro PR$PR_NUMBER\`
  • Otherwise: write manually at
      docs/reviews/retrospectives/$(date -I)-<your-topic>.md
    using the format from prior retros (e.g.
    docs/reviews/retrospectives/2026-04-29-tests-panel-bridge-session.md)

Skip if the cycle was uneventful.
EOF

cleanup_on_clean_exit
```

The skill **does NOT auto-write retros**. Synthesis needs hindsight;
mandatory low-value retros pollute the directory.

## Step 7.6 — Abnormal exit message (verbatim)

```bash
cat <<EOF >&2
⚠️ Loop exited at round $ROUND because $REASON.

  Incident report: $ABORT_DIR/incident.md
  Last verify result: .harness-github-review/cycle-${ROUND}-verify-result.json

Recommended next step: $(human_guidance_for_reason "$REASON")

Once the cycle is unstuck, consider /write-retro (if available) or a
manual retrospective — incident retros are highest-signal entries in
docs/reviews/retrospectives/.
EOF

# DO NOT auto-cleanup on abnormal exit — preserve forensics.
exit 1
```

`human_guidance_for_reason` returns:

- `"poll-timeout"` → "check GitHub for new reviews; re-run the loop if
  reviewers are still iterating, or close out manually."
- `"max-rounds"` → "review the PR manually — reviewers may be stuck in a
  loop; consider intervening directly on the PR."
- `"abort"` → "inspect the incident report; choose one of the three
  recovery paths below before re-running the loop."

Then the abort message also prints the three recovery paths from above
(§ Three recovery paths on abort).

## Cross-references

- **Step 5G abort** — see `verify-prompt.md` § Step 5G (where the abort
  artifacts and `incident.md` get written).
- **Step 7.5 clean-exit** — see `../SKILL.md` § Step 7.5 (calls
  `cleanup_on_clean_exit`; full message verbatim above).
- **Step 7.6 abnormal exit** — see `../SKILL.md` § Step 7.6 (does NOT call
  cleanup; preserves forensics; full message verbatim above).
- **Trailer durability semantics** — see `commit-trailers.md`.

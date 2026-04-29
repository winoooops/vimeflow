# Empty-State Classification — Step 3

This file is the implementation reference for **Step 3** of `../SKILL.md`.
After Step 2 polls and parses both reviewers, Step 3 classifies the
per-cycle finding state into exactly one of five cases.

**Key invariant (asserted in SKILL.md):** there is **no silent-empty path**
— every empty result is either explicitly clean (case 3) or a loud-fail
(case 4/5). A reviewer that emits no signal is treated as "no new content"
(case 1), not "implicitly clean".

## The 5-case table

| Case | Claude side                                                                 | Codex side                                                                       | Action                                                  |
| ---- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1    | No new comment in unprocessed set                                           | No new review in unprocessed set; no unresolved threads                          | **Step 7 poll-next**                                    |
| 2    | New comment with ≥1 successfully-parsed finding **OR** unchanged            | New review with ≥1 inline finding, all parseable **OR** unchanged                | **Step 4 fix**                                          |
| 3    | New comment, 0 findings, verdict explicitly clean (per `is_claude_clean`)   | No new unresolved findings (all reviews `is_summary_clean` or already processed) | **Loop exit (clean)**                                   |
| 4    | New comment, parser failed (no `### [SEV]` blocks AND no parseable verdict) | New review, after race-retry inline still empty AND summary not explicitly clean | **loud-fail**, dump raw body to user                    |
| 5    | New comment, verdict says ⚠️ but 0 findings parseable                       | (case-4-equivalent on Codex side)                                                | **loud-fail** (reviewer claims problems but lists none) |

**Mixed-state rule:** if at least one reviewer is case 2, the cycle proceeds
with whatever findings were parsed from that reviewer (the other may be case
1 — that's fine; we just have nothing new from that side). Cases 4 and 5
abort the cycle BEFORE any code changes.

**Human-comment exception:** human findings (Step 2D) only have cases 1, 2,
or 3. Cases 4/5 don't apply because humans aren't required to follow a
parser format — an "unparseable" human comment is just "treat the body
verbatim as MEDIUM".

## Pseudocode for `classify_cycle`

```bash
classify_cycle() {
  local claude_state codex_state

  # Determine claude_state from Step 2A outputs:
  if [ "$LATEST_CLAUDE" = "null" ]; then
    claude_state="case_1"
  elif claude_parse_succeeded && [ "$CLAUDE_FINDINGS_COUNT" -gt 0 ]; then
    claude_state="case_2"
  elif claude_parse_succeeded && [ "$CLAUDE_FINDINGS_COUNT" -eq 0 ] && is_claude_clean; then
    claude_state="case_3"
  elif claude_parse_succeeded && [ "$CLAUDE_FINDINGS_COUNT" -eq 0 ] && claude_verdict_says_dirty; then
    claude_state="case_5"
  else
    claude_state="case_4"
  fi

  # Determine codex_state from Step 2B outputs (similar logic).
  # ...

  # Combined disposition:
  if [ "$claude_state" = "case_4" ] || [ "$claude_state" = "case_5" ] \
     || [ "$codex_state" = "case_4" ] || [ "$codex_state" = "case_5" ]; then
    echo "LOUD_FAIL"
    return 1
  fi

  if [ "$claude_state" = "case_2" ] || [ "$codex_state" = "case_2" ]; then
    echo "FIX"
    return 0
  fi

  if [ "$claude_state" = "case_3" ] && [ "$codex_state" = "case_3" ]; then
    echo "EXIT_CLEAN"
    return 0
  fi

  # Mixed case 1 / case 3 → still nothing actionable from either side.
  echo "POLL_NEXT"
  return 0
}
```

## Disposition outcomes

- **LOUD_FAIL** — write the offending raw body to
  `.harness-github-review/cycle-${ROUND}-loud-fail-<source>.txt` and
  `exit 1`. Do **NOT** proceed to fix or commit.
- **EXIT_CLEAN** — continue to Step 7 (loop exit + retro prompt).
- **FIX** — proceed to Step 4 (fix all findings).
- **POLL_NEXT** — continue to Step 7 (poll-next sub-flow).

## Why no silent-empty path

If we accept "case 4 means treat as clean", a reviewer that briefly fails
to render its body (transient bug) would silently pass the loop, declaring
exit-clean while real findings exist on GitHub. The loud-fail path forces
the user to investigate before proceeding — preserving forensics
(`.harness-github-review/cycle-${ROUND}-loud-fail-<source>.txt`) and
preventing false-positive clean exits.

## Cross-references

- **Step 2 parsing rules** — see `parsing.md` (defines `is_claude_clean`,
  `is_summary_clean`, the per-source body shape and the
  `CLAUDE_FINDINGS_COUNT` derivation).
- **Step 7 exit logic** — see `../SKILL.md` § Step 7 (consumes
  `EXIT_CLEAN` / `POLL_NEXT` outcomes).
- **Cleanup on loud-fail** — see `cleanup-recovery.md` (the
  `cycle-${ROUND}-loud-fail-*.txt` artifact is preserved on abort).

# Codex Verify Gate — Step 5

This file is the implementation reference for **Step 5** of `../SKILL.md`.
After Step 4 stages all fixes (no commit yet), Step 5 runs `codex exec`
against the staged diff to verify two things:

1. Every upstream finding from this cycle is **addressed** by the diff.
2. The diff does **NOT** introduce new MEDIUM/HIGH/CRITICAL issues. New LOW
   issues are allowed and will be deferred.

If verify passes (or only finds new-LOW issues), Step 6 commits. If verify
finds new MEDIUM/HIGH/CRITICAL issues OR any unaddressed upstream finding,
the cycle re-enters Step 4 (retry budget ≤ 3). The result-classification
matrix below is authoritative on which severity triggers what behavior.

The actual `codex exec` invocation is wrapped in
`../scripts/verify.sh` — this file documents the prompt builder, the
matrix, the retry budget, the docs-only escape, and the abort path.

## Step 5A — Setup: gitignored artifact directory

```bash
mkdir -p .harness-github-review

DIFF_PATCH=".harness-github-review/cycle-${ROUND}-diff.patch"
PROMPT_FILE=".harness-github-review/cycle-${ROUND}-verify-prompt.md"
RESULT_JSON=".harness-github-review/cycle-${ROUND}-verify-result.json"
EVENTS_LOG=".harness-github-review/cycle-${ROUND}-verify-events.log"
STDERR_LOG=".harness-github-review/cycle-${ROUND}-verify-stderr.log"
```

The directory is gitignored. Step 6's commit explicitly enumerates files
(no `git add -A`) so these artifacts can never accidentally land in a
commit. See `cleanup-recovery.md` for lifecycle rules.

## Step 5B — Build the verify prompt

````bash
git diff --staged > "$DIFF_PATCH"
DIFF_LINES=$(wc -l < "$DIFF_PATCH")

# render_findings_table: emit each finding as a markdown bullet referencing
# its cycle_id, source, severity, file, line_range, title, body.
render_findings_table() {
  jq -r '.[] | "
- **\(.cycle_id)** [\(.source) | \(.severity_label_original)] **\(.title)**
  - File: `\(.file)` L\(.line_range.start)-\(.line_range.end)
  - \(.body | gsub("\n"; "\n  "))
"' <<< "$FINDINGS_JSON"
}

cat > "$PROMPT_FILE" <<'EOF'
You are verifying a review-fix cycle. The agent has staged code changes intended to address the upstream findings listed below. Your job is to verify the staged diff resolves every upstream finding without introducing new MEDIUM/HIGH/CRITICAL issues. New LOW-severity issues may be reported and will be deferred (not blocking).

## Upstream findings addressed in this cycle

EOF

render_findings_table >> "$PROMPT_FILE"

cat >> "$PROMPT_FILE" <<EOF

## Staged diff to verify

EOF

if [ "$DIFF_LINES" -le 500 ]; then
  printf '\n```diff\n' >> "$PROMPT_FILE"
  cat "$DIFF_PATCH" >> "$PROMPT_FILE"
  printf '\n```\n' >> "$PROMPT_FILE"
else
  printf '\nThe full staged diff is at `%s`. Read that file. Do NOT run `git diff` — staged changes may diverge from HEAD until commit.\n' "$DIFF_PATCH" >> "$PROMPT_FILE"
fi

cat >> "$PROMPT_FILE" <<'EOF'

## Verification rules

1. For each upstream finding F1..FN, decide ADDRESSED or NOT_ADDRESSED.
   - If NOT_ADDRESSED: emit a finding with `title` PREFIXED `[UNADDRESSED Fk] <original title>` and `severity` matching the upstream's original severity.
2. Beyond upstream coverage, scan the diff for NEW issues introduced by the fix. Emit those normally (no [UNADDRESSED] prefix).
3. SCOPE BOUNDARY RULE — review ONLY lines in this staged diff. Do NOT cascade into untouched files.
4. Confidence-based filtering: only report >80% confidence issues.

Output JSON conforming to the codex-output-schema. An empty `findings` array means: every upstream finding ADDRESSED and no new issues found.
EOF
````

The 500-line threshold for inline-vs-file is heuristic. Larger diffs would
inflate the prompt past codex's effective context window; the file-pointer
fallback lets codex use its own read tool to ingest progressively.

## Step 5C — Call `codex exec` (wrapped in `scripts/verify.sh`)

The orchestrator invokes:

```bash
./scripts/verify.sh "$PROMPT_FILE" "$RESULT_JSON" "$EVENTS_LOG" "$STDERR_LOG"
CODEX_EXIT=$?
```

The wrapper runs:

```bash
timeout 300 codex exec \
  --sandbox read-only \
  --output-schema .github/codex/codex-output-schema.json \
  --output-last-message "$RESULT_JSON" \
  -- "$(cat "$PROMPT_FILE")" \
  > "$EVENTS_LOG" \
  2> "$STDERR_LOG"
```

Important flag notes:

- `--output-schema` (not `--output-schema-file` — that flag does not exist).
- `--output-last-message` writes the final structured JSON; stdout is
  event-stream noise (events log).
- **No `--model` flag.** Per auto-memory
  `feedback_codex_model_for_chatgpt_auth`: omitting lets `codex` pick the
  auth-mode-correct default (ChatGPT-account auth rejects explicit model
  selection).
- External GNU `timeout 300` — `codex exec` has no built-in timeout flag.
- `--sandbox read-only`: codex is verifying, not modifying. Read-only
  ensures it can't alter the staged diff during verification.
- If `timeout` is unavailable on the platform: `verify.sh` falls back to
  invoking codex directly; the harness/agent timeout (typically 5–10 min)
  applies. Acceptable degradation; codex normally finishes in 30–90s on a
  small staged diff.

## Step 5D — Result classification matrix

```bash
HAS_UNADDRESSED=$(jq '[.findings[].title | select(startswith("[UNADDRESSED"))] | length' "$RESULT_JSON")
HIGHEST_NEW_SEV=$(jq -r '
  [.findings[] | select((.title // "") | startswith("[UNADDRESSED") | not) | .severity]
  | (if length==0 then "NONE"
     else (sort_by({"CRITICAL":4,"HIGH":3,"MEDIUM":2,"LOW":1}[.]) | last)
     end)
' "$RESULT_JSON")
VERDICT=$(jq -r '.overall_correctness' "$RESULT_JSON")
FINDINGS_COUNT=$(jq '.findings | length' "$RESULT_JSON")
```

| Condition                                                               | State                  | Action                                                                      |
| ----------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------- |
| `CODEX_EXIT == 124`                                                     | `verify_timeout`       | Abort cycle (Step 5G)                                                       |
| `CODEX_EXIT != 0` (and not 124)                                         | `verify_error`         | Abort cycle                                                                 |
| `FINDINGS_COUNT == 0 && VERDICT == "patch is correct"`                  | `pass`                 | Continue Step 6                                                             |
| `FINDINGS_COUNT == 0 && VERDICT == "patch has issues"`                  | `contradiction`        | **loud-fail**, abort cycle                                                  |
| `HAS_UNADDRESSED > 0` (any sev)                                         | `unaddressed_upstream` | Re-enter Step 4 with the unaddressed Fk findings re-added; retry counter +1 |
| `HIGHEST_NEW_SEV == "LOW"` AND `HAS_UNADDRESSED == 0`                   | `pass_with_deferred`   | Continue Step 6; commit message `Verify-Deferred-LOW:` lists each           |
| `HIGHEST_NEW_SEV == "MEDIUM"` AND `HAS_UNADDRESSED == 0`                | `new_medium`           | Re-enter Step 4 to fix; retry counter +1                                    |
| `HIGHEST_NEW_SEV == "HIGH"` OR `"CRITICAL"`, AND `HAS_UNADDRESSED == 0` | `new_high`             | Re-enter Step 4; retry counter +1; if counter reaches 3 → abort             |

`overall_correctness` enum is `"patch is correct" | "patch has issues"` per
`.github/codex/codex-output-schema.json`. The matrix uses these exact
strings.

## Step 5E — Verify retry budget

`VERIFY_RETRY_COUNTER` starts at 0 at cycle start. Each
`unaddressed_upstream` / `new_medium` / `new_high` re-entry to Step 4
increments it.

```bash
if [ "$VERIFY_RETRY_COUNTER" -ge 3 ]; then
  echo "Verify retry budget exhausted (3 attempts) — aborting cycle." >&2
  goto_step_5g_abort
fi

VERIFY_RETRY_COUNTER=$((VERIFY_RETRY_COUNTER + 1))
goto_step_4
```

## Step 5F — Docs-only escape (narrow)

Verify is skipped only when **all three** are true:

1. Every Finding in the cycle is severity LOW
2. Every staged path matches `^docs/` OR `^[^/]*\.md$` OR `^[^/]*\.txt$`
3. **No** staged path matches `^\.github/`, `^package(-lock)?\.json$`,
   `^src-tauri/`, `^src/`, `^vite\.config\.`, `^tailwind\.config\.`,
   `^eslint\.config\.`, `^tsconfig\.`, `^\.husky/`

```bash
should_skip_verify_docs_only() {
  # Condition 1
  local non_low_count
  non_low_count=$(jq '[.[] | select(.severity_internal != "LOW")] | length' <<< "$FINDINGS_JSON")
  [ "$non_low_count" -eq 0 ] || return 1

  # Condition 2 + 3 (combined: any path that doesn't match the docs-only allowlist OR matches the forbidden list)
  local violations
  violations=$(git diff --staged --name-only \
    | awk '
      /^docs\// { next }
      /^[^\/]*\.md$/ { next }
      /^[^\/]*\.txt$/ { next }
      /^\.github\// { print "FORBIDDEN:" $0; next }
      /^package(-lock)?\.json$/ { print "FORBIDDEN:" $0; next }
      /^src-tauri\// { print "FORBIDDEN:" $0; next }
      /^src\// { print "FORBIDDEN:" $0; next }
      /^vite\.config\./ { print "FORBIDDEN:" $0; next }
      /^tailwind\.config\./ { print "FORBIDDEN:" $0; next }
      /^eslint\.config\./ { print "FORBIDDEN:" $0; next }
      /^tsconfig\./ { print "FORBIDDEN:" $0; next }
      /^\.husky\// { print "FORBIDDEN:" $0; next }
      { print "NOT_DOCS:" $0 }
    ')
  [ -z "$violations" ] || return 1

  return 0
}

if should_skip_verify_docs_only; then
  echo "Verify skipped: docs-only diff (all LOW findings, allowed paths)." >&2
  VERIFY_SKIPPED=1
  # Step 6 will add Verify-Skipped: docs-only to the commit message.
  goto_step_6
fi
```

## Step 5G — Abort

On `verify_timeout` / `verify_error` / `contradiction` / retry-exhausted:

```bash
ABORT_DIR=".harness-github-review/cycle-${ROUND}-aborted"
mkdir -p "$ABORT_DIR"

git diff --staged > "$ABORT_DIR/staged.patch"
git diff > "$ABORT_DIR/unstaged.patch"
git status --porcelain > "$ABORT_DIR/status.txt"
git ls-files --others --exclude-standard > "$ABORT_DIR/untracked.txt"

# Build incident report (per spec §3.7).
write_incident_report > "$ABORT_DIR/incident.md"
```

`incident.md` contains, in order:

1. Cycle metadata: round number, abort reason, retry counter at abort,
   started/aborted timestamps.
2. The cycle's full Finding table (the `$FINDINGS_JSON`), each finding's
   `status` and `fix_summary`.
3. For each verify attempt 1..N: the prompt sent, raw `findings[]` from the
   result JSON, which findings caused retry/abort.
4. The watermark trailers that **would have been** committed for this cycle
   (so the user can re-run after manual fixup without losing the watermark
   progression).
5. A "Recommended next steps" section enumerating the recovery paths from
   `cleanup-recovery.md`.

The skill **does not** auto-`git stash`. Working tree is left visible. The
skill exits the entire loop (not just this cycle):

```bash
echo "Cycle ${ROUND} aborted in verify after ${VERIFY_RETRY_COUNTER} attempts."
echo "See $ABORT_DIR/."
echo ""
echo "Working tree contains the last attempted fix — inspect with 'git status' / 'git diff'."
echo "See § Cleanup → recovery paths for next steps."
exit 1
```

## Cross-references

- **Step 2 finding-table schema** — see `parsing.md` § Step 2C
  (`Finding` type definition consumed here).
- **Step 6 commit trailers** — see `commit-trailers.md` (consumes
  `VERIFY_DEFERRED_LOW` and `VERIFY_SKIPPED` outputs from this step).
- **Recovery paths on abort** — see `cleanup-recovery.md`.

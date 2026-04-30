# `/harness-plugin:github-review` Connector Rewrite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `plugins/harness/skills/github-review/SKILL.md` to consume the chatgpt-codex-connector inline review surface plus the surviving Claude Code Review aggregated comments, gate fixes with a post-fix `codex exec` verify, and atomically append findings to the review knowledge base in the same commit as the code fix. Also disable the quota-blocked aggregated `codex-review.yml` workflow. Closes issue [#111](https://github.com/winoooops/vimeflow/issues/111).

**Architecture:** Monolithic `SKILL.md` (single file, the existing layout), reorganized into Steps 0–7 + a Cleanup section. State persistence is in-memory finding tables + Git commit-message trailers (no JSON state file). All transient artifacts under `.harness-github-review/` (gitignored). The `chatgpt-codex-connector[bot]` integration is a GitHub App we don't manage — we just consume its surfaces.

**Tech Stack:** Bash + `jq` + `gh api` (REST + GraphQL) + `codex exec` for post-fix verify. Pseudo-code samples in the spec are Python; engineers translate those to inline-bash in the skill prompt or call out to a small embedded helper as needed (still all inside `SKILL.md`).

**Spec:** [`docs/superpowers/specs/2026-04-29-harness-github-review-connector-design.md`](../specs/2026-04-29-harness-github-review-connector-design.md) (committed as `ecd2a7c` on `main`).

**Branch:** `fix/111-github-review-connector`. The Phase 0 preflight task (Task 0 below) ensures this branch exists and is checked out before any other task runs; the original spec commit lives on `main`, so this branch's PR diff will exclude the spec (only the spec-fix commits made on this branch will appear in the diff).

**Issue:** [#111](https://github.com/winoooops/vimeflow/issues/111)

---

## File Structure

### Modified

| Path                                            | Responsibility                                                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `plugins/harness/skills/github-review/SKILL.md` | Single-file skill, full rewrite. Frontmatter unchanged (`tools: Read, Write, Edit, Bash, Grep, Glob`). Body becomes Steps 0–7 + § "Cleanup, recovery & failsafe". Estimated 500–700 lines. |
| `.gitignore`                                    | Add one line: `.harness-github-review/`. Belongs alongside other build/test ignores near the top of the file.                                                                              |
| `CHANGELOG.md`                                  | Add one bullet under the current dated section noting the workflow disable, cross-linking PR #109 retro and issue #111.                                                                    |
| `CHANGELOG.zh-CN.md`                            | Mirror entry in Chinese matching the existing translation style.                                                                                                                           |
| `docs/reviews/CLAUDE.md`                        | Add a new "Source labels" subsection documenting `github-codex` (historical, do not relabel), `github-codex-connector`, `github-claude`, `local-codex`.                                    |

### Renamed

| From → To                                                                            | Why                                                                                                                          |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/codex-review.yml` → `.github/workflows/codex-review.yml.disabled` | Disables the workflow (GitHub Actions ignores non-`.yml`/`.yaml` extensions) without deleting it. Single-commit revert path. |

### Created

| Path   | Responsibility                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------ |
| (none) | The skill stays monolithic. No helper-script extraction (`lib/*.sh`) per spec §"File structure". |

### Pre-existing files used as references (read-only during implementation)

- `.github/codex/codex-output-schema.json` — verify gate's structured output schema. Engineer reads to understand allowed values.
- `.github/workflows/claude-review.yml` — to confirm Claude reviewer's `github-actions[bot]` identity and `## Claude Code Review` header.
- `docs/reviews/patterns/*.md` — existing pattern files; format reference for §4 of the spec.
- `docs/reviews/retrospectives/2026-04-29-tests-panel-bridge-session.md` — incident retrospective; cross-linked from CHANGELOG.

---

## Important guardrails for the implementing engineer

1. **The spec is authoritative.** When this plan summarizes a section, the spec's exact wording wins. Cross-references like "spec §3.4" point to specific subsections in the design doc.
2. **No silent-empty.** The original bug was a silent `select() | last` that returned empty without telling the user. Every empty-state branch in the new skill must be one of: case 1 "nothing new, poll again", case 3 "explicitly clean, exit", or case 4/5 "loud-fail". There is no fourth option.
3. **No auto-`git stash`.** Even on abort. The user needs visibility. Document stash as one of three recovery paths the user picks (spec §6.3); never invoke it.
4. **No `--model` flag on `codex exec`.** Per auto-memory `feedback_codex_model_for_chatgpt_auth` the ChatGPT-account auth path rejects `--model gpt-5.2-codex`. Omit the flag entirely and let codex pick the auth-mode default.
5. **`--output-schema` not `--output-schema-file`.** Verified against `codex exec --help`. Pair with `--output-last-message $RESULT_JSON` for the structured JSON output.
6. **Pattern entries do not contain the in-flight commit SHA.** A self-referential SHA can't exist before the commit lands. Use `Commit: same commit as this entry (see git blame / git log on this line)`. Spec §4.2.
7. **Commit trailers only — no `.json` state file.** Watermarks live in commit-message trailers (`GitHub-Review-Processed-Claude:`, etc.). Cycle start derives them by `git log "$PR_BASE..HEAD" --pretty=%B` and parsing.
8. **Membership tests in `jq` use string conversion.** `(.id | tostring) as $cid | $set | index($cid)` not `IN($set[])`. REST endpoints can mix number/string ID types; jq's `IN()` is finicky across versions. Spec §2.2.
9. **GraphQL `reviewThreads` lookup must page.** The first 100 threads × first 20 comments per thread is not unbounded. If a target inline comment isn't found, page through `pageInfo.endCursor` before loud-failing. Spec §2.2 user-patched paragraph.
10. **`PR_BASE` is derived, not hardcoded.** `BASE_REF` from `gh pr view --json baseRefName`, then `git fetch origin "$BASE_REF" --no-tags`, then `PR_BASE=$(git merge-base HEAD "origin/$BASE_REF")`. Spec §1.

---

## Task list (overview)

**Phase 0: Foundation (Tasks 0–2)** — branch preflight + small mechanical changes that establish state.
**Phase 1: SKILL.md rewrite (Tasks 3–11)** — incremental construction of the new skill, one spec section at a time.
**Phase 2: Acceptance gate (Tasks 13–15)** — pre-merge self-test on a throwaway PR, then open this PR.

Each task is committed individually so review can happen incrementally.

---

## Phase 0: Foundation

### Task 0: Preflight — ensure `fix/111-github-review-connector` branch exists and is checked out

**Files:** None (git-state only).

**Why this task exists:** the rest of the plan assumes commits land on `fix/111-github-review-connector`. If a fresh contributor (or an agent in a clean clone) starts the plan, there's no guarantee the branch already exists. Failing to verify here can cause Task 1's commit to land on `main`. Run before any other task.

- [ ] **Step 1: Ensure the working tree is clean**

```bash
git diff --quiet && git diff --staged --quiet || (
  echo "ERROR: working tree has uncommitted tracked changes." >&2
  echo "Commit or discard before starting this plan." >&2
  exit 1
)
```

Untracked files are fine — the plan does not depend on them. The check is for **tracked** modifications that would conflict with branch ops.

- [ ] **Step 2: Switch to (or create) the feature branch**

```bash
# If the branch already exists locally, switch. Otherwise, create it from
# the current main (after fetching latest origin/main).
git fetch origin main --no-tags
git switch fix/111-github-review-connector \
  || git switch -c fix/111-github-review-connector origin/main
```

- [ ] **Step 3: Verify the current branch**

```bash
CURRENT=$(git branch --show-current)
if [ "$CURRENT" != "fix/111-github-review-connector" ]; then
  echo "ERROR: expected fix/111-github-review-connector but on $CURRENT — abort." >&2
  exit 1
fi
echo "On branch $CURRENT — proceed to Task 1."
```

The output must read `On branch fix/111-github-review-connector` before any subsequent task runs.

**No commit for this task** — it leaves git state correctly oriented. Tasks 1+ make commits.

---

### Task 1: Disable workflow + add `.gitignore` entry + CHANGELOG entries

**Files:**

- Rename: `.github/workflows/codex-review.yml` → `.github/workflows/codex-review.yml.disabled`
- Modify: `.gitignore` (add `.harness-github-review/` line near top, alongside existing ignores)
- Modify: `CHANGELOG.md` (add a bullet under the current dated section)
- Modify: `CHANGELOG.zh-CN.md` (mirror in Chinese)

**Spec reference:** §"Workflow disable & related changes" (file table + CHANGELOG note text).

- [ ] **Step 1: Rename the workflow file**

```bash
git mv .github/workflows/codex-review.yml .github/workflows/codex-review.yml.disabled
```

- [ ] **Step 2: Verify the rename took effect**

```bash
ls -la .github/workflows/codex-review.yml.disabled
ls .github/workflows/codex-review.yml 2>&1 | grep -q "No such file" && echo "OK: old path absent"
```

Expected: `.disabled` file is present; old path returns "No such file".

- [ ] **Step 3: Read the current `.gitignore` to find the right insertion point**

```bash
head -30 .gitignore
```

Look for the existing "Build outputs" or "Testing" section. The new entry belongs adjacent to other transient-artifact ignores. The exact location doesn't change behavior — just place near the top, not buried.

- [ ] **Step 4: Add `.harness-github-review/` to `.gitignore`**

Use Edit to insert the line under the most appropriate existing comment block (e.g., after `# Testing` block):

```gitignore
# Harness review-loop artifacts
.harness-github-review/
```

- [ ] **Step 5: Verify `.gitignore` works**

```bash
mkdir -p .harness-github-review/sentinel
echo "test" > .harness-github-review/sentinel/test.txt
git status --short .harness-github-review/
```

Expected: empty output (the dir is ignored). Cleanup after:

```bash
rm -rf .harness-github-review
```

- [ ] **Step 6: Read both CHANGELOGs to find the current dated section**

```bash
head -50 CHANGELOG.md
head -50 CHANGELOG.zh-CN.md
```

Identify the most recent date heading (likely `## 2026-04-29` from PR #110). The new entry goes under that heading. If there is no heading for today, add one matching the existing style.

- [ ] **Step 7: Add the EN entry to `CHANGELOG.md`**

Append (or insert under today's heading) the bullet:

```markdown
- Disabled `.github/workflows/codex-review.yml` (renamed to `.disabled`).
  The aggregated Codex Action hit OpenAI quota every push for two PRs running
  ([PR #109 retrospective](docs/reviews/retrospectives/2026-04-29-tests-panel-bridge-session.md)).
  Inline review continues via the `chatgpt-codex-connector` GitHub App
  integration; `/harness-plugin:github-review` now consumes that surface
  ([#111](https://github.com/winoooops/vimeflow/issues/111)).
```

- [ ] **Step 8: Add the zh-CN mirror entry to `CHANGELOG.zh-CN.md`**

Use the same anchor (today's date heading), same link targets, translated body. Keep the link labels in English where they reference English-named files (`docs/reviews/...`). Match the translation style of the file's existing entries (read 2–3 prior bullets first to calibrate).

- [ ] **Step 9: Verify the markdown still renders cleanly**

```bash
npx prettier --check CHANGELOG.md CHANGELOG.zh-CN.md
```

Expected: pass. If Prettier rewraps lines, accept its output.

- [ ] **Step 10: Stage explicitly (not `-A`) and commit**

```bash
git add .github/workflows/codex-review.yml.disabled .gitignore CHANGELOG.md CHANGELOG.zh-CN.md
git status --short  # double-check exactly these four files staged
git commit -m "$(cat <<'EOF'
chore(#111): disable aggregated codex-review workflow

The openai/codex-action@v1 step in codex-review.yml has been hitting
'Quota exceeded' on every push for two PRs running (PR #109 retro).
Inline review continues via chatgpt-codex-connector GitHub App; the
github-review skill rewrite (subsequent commits in this branch) will
consume that surface.

- Renamed codex-review.yml → codex-review.yml.disabled (reversible)
- Added .harness-github-review/ to .gitignore for skill artifacts
- CHANGELOG entries (EN + zh-CN) cross-linking #111 and PR #109 retro
EOF
)"
```

- [ ] **Step 11: Confirm commit landed cleanly**

```bash
git log -1 --stat
```

Expected: 4 files changed (1 rename, 3 modifications). Commit message includes the `Co-Authored-By` trailer if the harness adds it; do not add one manually.

---

### Task 2: Add source-label documentation to `docs/reviews/CLAUDE.md`

**Files:**

- Modify: `docs/reviews/CLAUDE.md` (add a new subsection)

**Spec reference:** §4.4 (the source-label documentation block).

- [ ] **Step 1: Read `docs/reviews/CLAUDE.md` to find the right insertion point**

```bash
cat docs/reviews/CLAUDE.md
```

The new subsection goes after the existing intro paragraphs and before the pattern index table. If a section like "## Source labels" already exists (it doesn't currently), update it; otherwise add a new H2 immediately preceding the table.

- [ ] **Step 2: Insert the source-label subsection**

Use Edit to add the following block at the chosen position (typically right after the "After a review-fix cycle" paragraph and before the table):

```markdown
## Source labels

When appending findings to a pattern file, label the source so future readers can trace which reviewer caught it:

- `github-codex` — the old aggregated Codex GitHub Action (`.github/workflows/codex-review.yml`,
  disabled as of [#111](https://github.com/winoooops/vimeflow/issues/111)). Existing entries with
  this label remain as historical record; do **NOT** rewrite or relabel them.
- `github-codex-connector` — the `chatgpt-codex-connector[bot]` GitHub App integration. Posts
  inline review comments on PR diffs. New entries from `/harness-plugin:github-review` cycles use
  this label.
- `github-claude` — the Claude Code Review GitHub Action (`.github/workflows/claude-review.yml`).
  Posts an aggregated `## Claude Code Review` issue comment per push.
- `local-codex` — local `codex exec` runs (e.g. `npm run review` or post-fix verify in the
  github-review skill).
```

- [ ] **Step 3: Verify the markdown still renders cleanly**

```bash
npx prettier --check docs/reviews/CLAUDE.md
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add docs/reviews/CLAUDE.md
git commit -m "$(cat <<'EOF'
docs(#111): document review-pattern source labels

Adds a Source labels subsection to docs/reviews/CLAUDE.md enumerating
the four sources the review knowledge base accepts:
- github-codex (historical, do not relabel)
- github-codex-connector (the chatgpt-codex-connector GitHub App)
- github-claude (the Claude Code Review GitHub Action)
- local-codex (local codex exec runs)

Future github-review cycles will reference this list when appending to
docs/reviews/patterns/*.md.
EOF
)"
```

---

## Phase 1: SKILL.md rewrite

The remaining tasks construct the new `SKILL.md` incrementally. Each task replaces or appends a specific section. After Task 11 the file is complete and ready for self-test.

**Strategy:** rather than a single monolithic rewrite, we build the file step-by-step. Each task's output is a coherent partial that still includes the original frontmatter and reads as a (partial) skill. After Task 3 establishes the scaffold, Tasks 4–11 fill in each Step with content drawn from the spec.

The engineer should keep the **current** `plugins/harness/skills/github-review/SKILL.md` open as a reference for what's being replaced. The new file will be substantially larger but uses the same conceptual layout (Step 1, Step 2, ..., with bash blocks per step).

### Task 3: SKILL.md scaffold — frontmatter, title, Loop Control, step headers

**Files:**

- Modify: `plugins/harness/skills/github-review/SKILL.md` (replace entire body, keep frontmatter)

**Spec reference:** §"Architecture / File structure", §"Architecture / Loop flow".

- [ ] **Step 1: Read the current SKILL.md to capture the frontmatter**

```bash
sed -n '1,5p' plugins/harness/skills/github-review/SKILL.md
```

The frontmatter block (lines 1–5 in the current file) is:

```markdown
---
name: github-review
description: Fetch Codex review findings from the current PR and fix them. Polls gh for the latest Codex comment, parses findings, fixes each issue, runs tests, commits, and pushes. Automatically loops — polls for the next review after each push.
tools: Read, Write, Edit, Bash, Grep, Glob
---
```

The frontmatter description should be updated to reflect the rewrite. New description:

```yaml
description: Fetch review findings from the current PR (Claude Code Review aggregated comments + chatgpt-codex-connector inline comments) and fix them in atomic per-cycle batches. Each cycle polls both reviewers, fixes findings, runs codex verify on the staged diff, commits with watermark trailers, pushes, replies + resolves connector threads, then polls for the next review. Mandates pattern-file appends in the same commit as the fix.
```

- [ ] **Step 2: Write the new SKILL.md scaffold**

Replace the entire file body (everything after the closing `---` of frontmatter) with the scaffold below. The scaffold contains the title, Loop Control, and **placeholder** sections for each Step (just headers + a one-line summary). Subsequent tasks fill in each Step.

Use Write (full overwrite) since this is a complete replacement:

```markdown
---
name: github-review
description: Fetch review findings from the current PR (Claude Code Review aggregated comments + chatgpt-codex-connector inline comments) and fix them in atomic per-cycle batches. Each cycle polls both reviewers, fixes findings, runs codex verify on the staged diff, commits with watermark trailers, pushes, replies + resolves connector threads, then polls for the next review. Mandates pattern-file appends in the same commit as the fix.
tools: Read, Write, Edit, Bash, Grep, Glob
---

# /harness-plugin:github-review — Fix PR Review Findings (Connector-Aware Self-Driving Loop)

Fetch the latest reviews from the current branch's PR (or a user-specified PR), fix every finding, push, then poll for the next review and repeat — until both reviewers come back clean or the loop hits the max-rounds cap.

This skill consumes two reviewers:

1. **Claude Code Review** — `github-actions[bot]` issue comments with `## Claude Code Review` header. Aggregated, no threads.
2. **chatgpt-codex-connector** — `chatgpt-codex-connector[bot]` PR-level review summaries (`### 💡 Codex Review`) + inline file-level comments (`**P1/P2 Badge** Title`). Inline comments are the actionable units; threads resolved via GraphQL `resolveReviewThread`.

The old aggregated `openai/codex-action@v1` workflow (`.github/workflows/codex-review.yml`) was disabled in the same PR that introduced this rewrite (issue #111).

## Loop Control

- **Max rounds:** 10 (hard cap to prevent runaway loops)
- **Per-round verify retry budget:** 3 (codex-verify re-entries to fix; exceed → cycle abort)
- **Inter-round poll interval:** 60 seconds
- **Inter-round poll timeout:** 10 minutes per round
- **State persistence:** Git commit-message trailers (no `.json` state file). Cycle start derives processed sets via `git log "$PR_BASE..HEAD"`.
- **Per-cycle artifacts:** under `.harness-github-review/` (gitignored). See § Cleanup.

## Step 0: Input resolution

(Filled in Task 4.)

## Step 1: Get PR + repo context

(Filled in Task 4.)

## Step 1.5: Check non-review CI status

(Filled in Task 4.)

## Step 2: Poll both reviewers + parse findings

(Filled in Tasks 5–6.)

## Step 3: Empty-state classification

(Filled in Task 7.)

## Step 4: Fix all findings

(Filled in Task 8.)

## Step 5: Codex verify on staged diff

(Filled in Tasks 9–10.)

## Step 6: Write patterns → stage all → commit → push → reply + resolve threads

(Filled in Task 11.)

## Step 7: Exit check + retro prompt

(Filled in Task 12.)

## Cleanup, recovery & failsafe

(Filled in Task 12.)
```

- [ ] **Step 3: Verify the file parses as a valid skill**

```bash
head -5 plugins/harness/skills/github-review/SKILL.md   # frontmatter intact
grep -c '^## Step' plugins/harness/skills/github-review/SKILL.md
```

Expected: frontmatter shows correctly. Step header count: 8 (`Step 0`, `Step 1`, `Step 1.5`, `Step 2`, `Step 3`, `Step 4`, `Step 5`, `Step 6`, `Step 7` — `grep -c '^## Step'` returns 9 because Step 1.5 also matches; that's fine).

- [ ] **Step 4: Commit the scaffold**

```bash
git add plugins/harness/skills/github-review/SKILL.md
git commit -m "$(cat <<'EOF'
refactor(#111): SKILL.md scaffold for connector-aware rewrite

Replace the current github-review skill body with a step-headed scaffold.
Each Step header is a placeholder; subsequent commits in this branch fill
them in following the spec at
docs/superpowers/specs/2026-04-29-harness-github-review-connector-design.md.

Updated description to reflect the new dual-reviewer surface and trailer-
based state persistence. Frontmatter tools list unchanged.
EOF
)"
```

---

### Task 4: Step 0 + Step 1 + Step 1.5 (input resolution, repo context, CI gate)

**Files:**

- Modify: `plugins/harness/skills/github-review/SKILL.md` (replace `## Step 0` through `## Step 1.5` placeholders with full content)

**Spec reference:** §0 "Input resolution", §1 "State persistence" for `PR_BASE` derivation, retain the existing CI-status logic from the old skill (it works as-is and the spec doesn't change it).

- [ ] **Step 1: Replace the Step 0 placeholder with the full input-resolution block**

Use Edit to replace the entire Step 0 placeholder section (just the header + "Filled in Task 4." line) with:

````markdown
## Step 0: Input resolution

The skill supports both current-branch operation and explicit PR targeting. **Explicit PR targeting only changes which PR is _read_ from — write operations (commit, push) still happen on the current `git` checkout.** This step enforces that the current branch matches the PR's head ref so fixes can never accidentally land on the wrong branch.

```bash
# If the user supplied a PR number (env var or first argument), use it.
# Otherwise resolve the current branch's PR.
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
````

````

- [ ] **Step 2: Replace the Step 1 placeholder with the `PR_BASE` derivation**

```markdown
## Step 1: Resolve `PR_BASE` and derive processed-set watermarks from commit trailers

The processed-set watermarks live in commit-message trailers on prior fix commits in this PR. We need `PR_BASE` (the commit where this PR's branch diverged from `BASE_REF`) so we can scope `git log` correctly across base-branch renames and stacked PRs.

```bash
# Fetch the base ref so origin/$BASE_REF exists locally.
git fetch origin "$BASE_REF" --no-tags

# Use merge-base so we count only commits unique to this branch — robust
# against upstream advancing while the PR is open.
PR_BASE=$(git merge-base HEAD "origin/$BASE_REF")

# Extract trailer values for each watermark key. Each var holds a comma-separated
# list of integer or string IDs (empty if no prior fix commits).
extract_trailer() {
  local key="$1"
  git log "$PR_BASE..HEAD" --pretty=%B \
    | awk -v k="^${key}:" '$0 ~ k { sub(k, ""); gsub(/^ +| +$/, ""); print }' \
    | tr ',' '\n' \
    | awk 'NF' \
    | tr '\n' ',' \
    | sed 's/,$//'
}

PROCESSED_CLAUDE_IDS=$(extract_trailer "GitHub-Review-Processed-Claude")
SUPERSEDED_CLAUDE_IDS=$(extract_trailer "GitHub-Review-Superseded-Claude")
PROCESSED_CODEX_REVIEW_IDS=$(extract_trailer "GitHub-Review-Processed-Codex-Reviews")
PROCESSED_CODEX_INLINE_IDS=$(extract_trailer "GitHub-Review-Processed-Codex-Inline")
CLOSED_CODEX_THREADS=$(extract_trailer "Closes-Codex-Threads")

# Claude side: union of processed and superseded.
CLAUDE_HANDLED_IDS=$(printf '%s,%s' "$PROCESSED_CLAUDE_IDS" "$SUPERSEDED_CLAUDE_IDS" | tr ',' '\n' | awk 'NF' | sort -u | tr '\n' ',' | sed 's/,$//')

echo "PR_BASE=$PR_BASE"
echo "Claude handled count:    $(echo "$CLAUDE_HANDLED_IDS" | tr ',' '\n' | awk 'NF' | wc -l)"
echo "Codex review handled:    $(echo "$PROCESSED_CODEX_REVIEW_IDS" | tr ',' '\n' | awk 'NF' | wc -l)"
echo "Codex inline handled:    $(echo "$PROCESSED_CODEX_INLINE_IDS" | tr ',' '\n' | awk 'NF' | wc -l)"
echo "Closed Codex threads:    $(echo "$CLOSED_CODEX_THREADS" | tr ',' '\n' | awk 'NF' | wc -l)"
````

The four `*_IDS` variables become inputs to Step 2's poll filtering. They feed `jq --argjson` calls as JSON arrays — convert via `jq -R 'split(",") | map(select(length > 0))' <<< "$VAR"` at the call site.

````

- [ ] **Step 3: Replace the Step 1.5 placeholder with the CI-status block**

The CI gate logic from the old skill works correctly — preserve it, just under the new step number. Edit the placeholder to:

```markdown
## Step 1.5: Check non-review CI status

Before looking at review comments, ensure the PR's non-review CI checks are green. Failing review-side checks (the disabled `Codex Code Review` job, or the Claude review job mid-flight) are NOT blockers; we don't gate on them.

```bash
gh pr checks "$PR_NUMBER"
````

If any checks **other than `Codex Code Review` and `Claude Code Review`** are failing (e.g., Code Quality Check, Unit Tests, Tauri Build):

1. Read the failing check's log: `gh run view <run_id> --log-failed`
2. Fix the issue (formatting, lint, type errors, test failures)
3. Commit and push the fix in a separate non-review-fix commit (does NOT use the trailer schema)
4. Re-run `gh pr checks` until non-review CI is green

Common CI failure recipes:

- **Code Quality Check (Prettier):** `npx prettier --write <flagged files>`
- **Code Quality Check (ESLint):** `npm run lint:fix`
- **Unit Tests:** `npm run test` to reproduce, then fix
- **Type-check:** `npm run type-check` to reproduce

Only proceed to Step 2 once all non-review CI is passing.

````

- [ ] **Step 4: Verify the file is well-formed**

```bash
grep -c '^## Step' plugins/harness/skills/github-review/SKILL.md
wc -l plugins/harness/skills/github-review/SKILL.md
````

Expected: still 9 step matches (counting `Step 1.5`). Line count grew from ~80 to ~150.

- [ ] **Step 5: Run shellcheck on extracted bash blocks (optional but recommended)**

Skip if shellcheck isn't installed (`command -v shellcheck` returns nothing). Otherwise:

````bash
# Extract all bash code blocks from the file and pipe to shellcheck for sanity.
awk '/^```bash$/,/^```$/' plugins/harness/skills/github-review/SKILL.md \
  | grep -v '^```' \
  | shellcheck -s bash - || echo "(shellcheck reported issues — review and fix shell-quote/syntax problems before commit)"
````

Resolve any errors/warnings. Most likely findings: unquoted `$VAR` in arguments to commands that may receive empty values; we want explicit double-quotes to avoid argv splitting.

- [ ] **Step 6: Commit Step 0 + Step 1 + Step 1.5**

```bash
git add plugins/harness/skills/github-review/SKILL.md
git commit -m "$(cat <<'EOF'
feat(#111): SKILL.md Steps 0-1.5 — input resolution + watermark derivation

- Step 0: USER_SUPPLIED_PR_NUMBER fallback to gh pr view; resolves
  REPO/OWNER/NAME/BASE_REF deterministically; loud error if no PR found.
- Step 1: PR_BASE via git merge-base HEAD origin/$BASE_REF (after fetch),
  then extract_trailer() helper that pulls per-key watermark IDs out of
  prior commit messages between PR_BASE and HEAD.
- Step 1.5: preserved the existing non-review-CI gate from the old skill,
  scoped explicitly to non-review checks (Codex/Claude review jobs are
  ignored).

Spec sections: §0, §1.
EOF
)"
```

---

### Task 5: Step 2A — Claude reviewer poll + parse

**Files:**

- Modify: `plugins/harness/skills/github-review/SKILL.md` (begin filling Step 2; this task adds the Claude half)

**Spec reference:** §2.1 "Claude reviewer".

- [ ] **Step 1: Replace the Step 2 placeholder with the Step 2 header + 2A subheader content**

Use Edit to replace `(Filled in Tasks 5–6.)` under `## Step 2: Poll both reviewers + parse findings` with:

````markdown
This step polls both reviewers, parses their findings, and prepares the per-cycle finding table that Step 3 will classify and Step 4 will fix.

### Step 2A: Claude reviewer (issue comments, aggregated, no threads)

**Poll:**

```bash
CLAUDE_COMMENTS_JSON=$(gh api "repos/$REPO/issues/$PR_NUMBER/comments" --paginate \
  --jq '[.[] | select(
           .user.login == "github-actions[bot]"
           and (.body | startswith("## Claude Code Review"))
         )]')

# Convert handled IDs to a jq-compatible JSON array.
CLAUDE_HANDLED_JSON=$(jq -R 'split(",") | map(select(length > 0) | tonumber)' <<< "$CLAUDE_HANDLED_IDS")

# Filter out already-handled comments. Take the latest by created_at — Claude
# reviews are aggregated current-state, so older unprocessed comments are
# stale-by-construction and should be marked superseded (Step 6 trailer).
LATEST_CLAUDE=$(jq --argjson handled "$CLAUDE_HANDLED_JSON" '
  [.[] | select(.id as $id | ($handled | index($id) | not))]
  | sort_by(.created_at)
  | last
  | if . then . else null end
' <<< "$CLAUDE_COMMENTS_JSON")

# Compute superseded set: any unhandled Claude comment with created_at strictly
# less than LATEST_CLAUDE.created_at. These will be added to the
# GitHub-Review-Superseded-Claude trailer in Step 6.
SUPERSEDED_THIS_CYCLE=$(jq --argjson handled "$CLAUDE_HANDLED_JSON" \
  --argjson latest "$LATEST_CLAUDE" '
  if $latest == null then []
  else
    [.[] | select(.id as $id | ($handled | index($id) | not))
         | select(.created_at < $latest.created_at)
         | .id]
  end
' <<< "$CLAUDE_COMMENTS_JSON")
```
````

Note `startswith` (not `contains`) — avoids matching human comments that quote the header.

**Parse format** (verified on PR #109):

```
## Claude Code Review

### 🟠 [HIGH] match_command recurses infinitely on cyclic npm script aliases

📍 `/home/runner/work/vimeflow/vimeflow/src-tauri/src/agent/test_runners/matcher.rs` L103-108
🎯 Confidence: 93%

<finding body, possibly multi-paragraph, may include code blocks>

<details><summary>💡 IDEA</summary>
- **I — Intent:** ...
- **D — Danger:** ...
- **E — Explain:** ...
- **A — Alternatives:** ...
</details>

---
```

Per finding, extracted from the body split on `---`:

- `severity`: regex `### .* \[(\w+)\]` → group 1
- `title`: same line, after `]`, trimmed to end-of-line
- `file`: regex `` 📍 `([^`]+)` `` → resolve via path normalization (below)
- `line_range`: regex `L(\d+)-(\d+)` (start, end)
- `body`: text between the `🎯 Confidence` line and `<details>` (or `---` if no IDEA block)

**Path normalization** must be deterministic and verify file existence:

```python
def resolve_claude_path(reported: str, repo_root: Path) -> str:
    # Case 1: relative path that exists at repo_root
    if not reported.startswith('/'):
        if (repo_root / reported).exists():
            return reported
        # fall through to suffix-search

    # Case 2 & 3: absolute path — try progressively shorter suffixes
    parts = reported.lstrip('/').split('/')
    for i in range(len(parts)):
        suffix = '/'.join(parts[i:])
        if (repo_root / suffix).exists():
            return suffix

    raise SkillError(f"path normalization failed: {reported!r} not found in {repo_root}")
```

Any unresolvable path = loud error. The skill must NOT silently fall back to e.g. `parts[-1]`.

**Verdict regex** (at end of body, used for "review is clean" exit detection):

```python
CLAUDE_VERDICT_PATTERNS = [
    r'(?im)^\s*\*\*Overall:\s*✅\s*patch is correct\*\*',
    r'(?im)^\s*Overall:\s*✅\s*patch is correct\b',
]
def is_claude_clean(body: str) -> bool:
    return any(re.search(p, body) for p in CLAUDE_VERDICT_PATTERNS)
```

Anchored to start-of-line; refuses to match quoted/embedded references inside finding bodies.

````

- [ ] **Step 2: Verify file structure**

```bash
grep -c '^### Step 2' plugins/harness/skills/github-review/SKILL.md
````

Expected: 1 (only Step 2A added so far; 2B and 2C come in Task 6).

- [ ] **Step 3: Commit**

```bash
git add plugins/harness/skills/github-review/SKILL.md
git commit -m "$(cat <<'EOF'
feat(#111): SKILL.md Step 2A — Claude reviewer poll + parse

- Polls /issues/{pr}/comments, filters by github-actions[bot] +
  startswith("## Claude Code Review") (not contains, to avoid quote-trap)
- Subtracts CLAUDE_HANDLED_IDS (Processed ∪ Superseded from trailers)
- Picks latest by created_at; older unprocessed → SUPERSEDED_THIS_CYCLE
- Documents per-finding regex extraction (severity, title, file, range, body)
- resolve_claude_path() function: deterministic, suffix-search,
  loud-fail if no suffix exists in repo_root
- is_claude_clean() verdict regex: line-anchored, refuses substring matches

Spec section: §2.1.
EOF
)"
```

---

### Task 6: Step 2B + Step 2C — Codex connector poll, parse, thread lookup, finding-table aggregation

**Files:**

- Modify: `plugins/harness/skills/github-review/SKILL.md` (continue Step 2)

**Spec reference:** §2.2 "Codex connector reviewer", §2.3 "Finding-table aggregation". Note: §2.2 has a user-patched paragraph requiring page-aware GraphQL `reviewThreads` lookup.

- [ ] **Step 1: Append Step 2B (connector poll/parse) and Step 2C (table aggregation)**

Use Edit to add after the Step 2A content block:

````markdown
### Step 2B: Codex connector reviewer (PR review summary + inline comments)

The connector posts on two surfaces:

1. `/pulls/{pr}/reviews` — summary review with body `### 💡 Codex Review`
2. `/pulls/{pr}/comments` — inline file-level comments with `**P1/P2 Badge** Title` body

Inline comments are the actionable findings. Summary reviews are used only for the "is this run clean" verdict signal.

**Two-step poll:**

```bash
# Step 1: connector reviews (summary level).
NEW_REVIEWS_JSON=$(gh api "repos/$REPO/pulls/$PR_NUMBER/reviews" --paginate \
  --jq '[.[] | select(.user.login == "chatgpt-codex-connector[bot]")]')

# Subtract Processed-Codex-Reviews trailer set.
PROCESSED_REVIEWS_JSON=$(jq -R 'split(",") | map(select(length > 0) | tonumber)' <<< "$PROCESSED_CODEX_REVIEW_IDS")
UNPROCESSED_REVIEWS_JSON=$(jq --argjson done "$PROCESSED_REVIEWS_JSON" '
  [.[] | select(.id as $id | ($done | index($id) | not))]
' <<< "$NEW_REVIEWS_JSON")
UNPROCESSED_REVIEW_IDS_JSON=$(jq '[.[].id]' <<< "$UNPROCESSED_REVIEWS_JSON")
```
````

```bash
# Step 2: connector inline comments scoped to unprocessed review IDs,
# also subtracting Processed-Codex-Inline. Use string-membership index()
# to dodge jq's number-vs-string typing across REST endpoints.
#
# IMPORTANT: gh api's --jq accepts ONLY the filter expression, not other jq
# flags like --argjson. Pipe gh api raw output to a separate jq invocation.
PROCESSED_INLINE_JSON=$(jq -R 'split(",") | map(select(length > 0))' <<< "$PROCESSED_CODEX_INLINE_IDS")

NEW_INLINE_JSON=$(gh api "repos/$REPO/pulls/$PR_NUMBER/comments" --paginate \
  | jq --argjson rids "$UNPROCESSED_REVIEW_IDS_JSON" \
       --argjson done_inline "$PROCESSED_INLINE_JSON" '
    ($rids | map(tostring)) as $ridset |
    ($done_inline | map(tostring)) as $doneset |
    [.[] | select(
      .user.login == "chatgpt-codex-connector[bot]"
      and ((.pull_request_review_id // empty | tostring) as $rid | $ridset | index($rid))
      and ((.id | tostring) as $cid | $doneset | index($cid) | not)
    )]')
```

**Race retry — review summary appears before inline comments are queryable:**

Per unprocessed review, fetch its inline comments. If empty:

```python
def is_summary_clean(body: str) -> bool:
    CLEAN_PATTERNS = [
        r'(?im)^\s*(?:✅\s*)?No issues found\.?\s*$',
        r'(?im)^\s*\*\*Overall:\s*✅\s*patch is correct\*\*',
        r'(?im)^\s*Overall:\s*✅\s*patch is correct\b',
    ]
    return any(re.search(p, body) for p in CLEAN_PATTERNS)

# Per review:
if not inline_for_this_review:
    if is_summary_clean(review.body):
        # Summary explicitly clean — no inline expected. Skip retry.
        continue
    # Race: summary suggests findings but inline not yet visible.
    for attempt in range(1, 7):  # 6 attempts × 5s = 30s max
        time.sleep(5)
        re_fetch_inline()
        if non_empty:
            break
    else:
        raise SkillError(
          f"connector review {review.id} summary suggests findings but inline "
          "comments still empty after 6×5s retries — refusing to silently exit"
        )
```

**Inline comment parse** — body shape (verified on PR #109):

```
**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  <Title>**

<Description>

Useful? React with 👍 / 👎.
```

Top-level fields (no body parsing required for these): `id`, `path`, `original_line`, `pull_request_review_id`.

Body parsing:

- `severity`: regex `!\[(P\d) Badge\]` → P1 maps to internal HIGH, P2 to internal MEDIUM. Original `P1` / `P2` label preserved in pattern entry's `Severity:` field as `P1 / HIGH` / `P2 / MEDIUM`.
- `title`: regex `\*\*<sub>.*?</sub>\s+(.+?)\*\*` → group 1, trimmed
- `body`: text between the title line and `Useful? React with 👍 / 👎.`

**Thread ID lookup** for connector inline comments — REST does not return thread IDs, so we query GraphQL. Implementation **must be page-aware**. Define a single named helper, `paginated_review_threads_query`, that handles pagination once. Both Step 2 (thread-id lookup) and Step 7.1 (unresolved-thread exit check) reuse it:

```bash
# Returns a flat JSON array of {thread_id, comment_databaseId,
# comment_author_login, isResolved} entries across ALL review threads and
# ALL comments per thread. Caller filters by author / by ID set as needed.
paginated_review_threads_query() {
  local cursor=""
  local result="[]"

  while :; do
    local page_json
    if [ -z "$cursor" ]; then
      page_json=$(gh api graphql -f query='
        query($owner:String!, $name:String!, $pr:Int!) {
          repository(owner:$owner, name:$name) {
            pullRequest(number:$pr) {
              reviewThreads(first:100) {
                pageInfo { hasNextPage endCursor }
                nodes {
                  id
                  isResolved
                  comments(first:50) {
                    pageInfo { hasNextPage endCursor }
                    nodes { databaseId author { login } }
                  }
                }
              }
            }
          }' -F owner="$OWNER" -F name="$NAME" -F pr="$PR_NUMBER")
    else
      page_json=$(gh api graphql -f query='
        query($owner:String!, $name:String!, $pr:Int!, $cursor:String!) {
          repository(owner:$owner, name:$name) {
            pullRequest(number:$pr) {
              reviewThreads(first:100, after:$cursor) {
                pageInfo { hasNextPage endCursor }
                nodes {
                  id
                  isResolved
                  comments(first:50) {
                    pageInfo { hasNextPage endCursor }
                    nodes { databaseId author { login } }
                  }
                }
              }
            }
          }' -F owner="$OWNER" -F name="$NAME" -F pr="$PR_NUMBER" -F cursor="$cursor")
    fi

    # Detect any thread whose comments page itself overflowed.
    local overflow
    overflow=$(jq '[.data.repository.pullRequest.reviewThreads.nodes[]
                    | select(.comments.pageInfo.hasNextPage == true)
                    | .id]' <<< "$page_json")
    if [ "$(jq 'length' <<< "$overflow")" -gt 0 ]; then
      echo "ERROR: review thread(s) $overflow exceed 50-comment first page; per-thread pagination required but not yet implemented." >&2
      return 1
    fi

    # Append flattened entries from this page.
    result=$(jq -s '.[0] + .[1]' \
      <(echo "$result") \
      <(jq '[.data.repository.pullRequest.reviewThreads.nodes
              | .[] as $thread
              | .comments.nodes[]
              | {thread_id: $thread.id, comment_databaseId: .databaseId,
                 comment_author_login: .author.login, isResolved: $thread.isResolved}]' \
            <<< "$page_json"))

    # Advance cursor or exit.
    local has_next
    has_next=$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage' <<< "$page_json")
    if [ "$has_next" != "true" ]; then break; fi
    cursor=$(jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor' <<< "$page_json")
  done

  echo "$result"
}

# Step 2 usage: build inline-comment-id → thread-id map.
ALL_THREAD_COMMENTS=$(paginated_review_threads_query)
INLINE_TO_THREAD_MAP=$(jq '[.[] | select(.comment_author_login == "chatgpt-codex-connector[bot]")
                            | {thread_id, comment_id: .comment_databaseId, isResolved}]' \
                          <<< "$ALL_THREAD_COMMENTS")
```

After all pages exhausted: any connector inline-comment ID not present in `INLINE_TO_THREAD_MAP` is a loud error (`"connector inline comment {id} not found in any review thread — data state anomaly"`).

The mapping table is consumed in Step 6 (reply + resolve threads). Step 7.1 reuses `paginated_review_threads_query` for the unresolved-thread exit check.

### Step 2C: Finding-table aggregation

After Steps 2A + 2B, build the per-cycle finding table. The table is **transient** (in-memory only — not persisted; spec §1).

```typescript
type Finding = {
  cycle_id: string // "F1", "F2", ... — stable for this cycle, used in verify prompt
  source: 'claude' | 'codex-connector'
  source_comment_id: number // Claude: comment ID. Connector: inline comment ID.
  source_review_id: number | null // Connector only
  thread_id: string | null // Connector only (PRRT_xxx form)
  severity_internal: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  severity_label_original: string // e.g. "HIGH" or "P1 / HIGH" (preserved for pattern entry)
  title: string
  file: string // repo-relative
  line_range: { start: number; end: number }
  body: string
  status: 'pending' | 'fixed' | 'skipped' | 'verify_failed'
  fix_summary: string | null // populated after Step 4
}
```

Build the table by iterating Claude findings (if `LATEST_CLAUDE` is non-null and parsing succeeded) and connector inline findings (everything in the post-race-retry inline set), assigning sequential `cycle_id` strings (`F1`, `F2`, ...). The table is consumed by Step 3 (classification), Step 4 (fix loop), Step 5 (verify prompt), and Step 6 (commit message + pattern routing).

````

- [ ] **Step 2: Verify file structure**

```bash
grep -c '^### Step 2' plugins/harness/skills/github-review/SKILL.md
wc -l plugins/harness/skills/github-review/SKILL.md
````

Expected: 3 (Step 2A, 2B, 2C). Line count grew by ~150–180.

- [ ] **Step 3: Commit**

```bash
git add plugins/harness/skills/github-review/SKILL.md
git commit -m "$(cat <<'EOF'
feat(#111): SKILL.md Steps 2B + 2C — connector poll + finding-table

Step 2B (Codex connector):
- Two-step poll: /pulls/{pr}/reviews then /pulls/{pr}/comments
- Subtract Processed-Codex-Reviews and Processed-Codex-Inline trailer sets
- jq string-membership index() instead of IN() (cross-version stability)
- is_summary_clean() verdict regex for race-retry decision
- Race retry: 6×5s if summary suggests findings but inline empty
- Inline comment body parser (P1/P2 Badge regex, title, body)
- GraphQL reviewThreads lookup with explicit pagination on both
  reviewThreads and per-thread comments — loud-fail if comment id
  doesn't map after full pagination

Step 2C (finding-table aggregation):
- Per-cycle Finding type with cycle_id (F1, F2, ...) for verify prompt
- Transient (in-memory only); not persisted to .json

Spec sections: §2.2, §2.3.
EOF
)"
```

---

### Task 7: Step 3 — empty-state classification (5-case table)

**Files:**

- Modify: `plugins/harness/skills/github-review/SKILL.md` (replace Step 3 placeholder)

**Spec reference:** §2.4 "Empty-state classification (the loud-fail discipline)".

- [ ] **Step 1: Replace the Step 3 placeholder**

Use Edit to replace the Step 3 placeholder with:

````markdown
## Step 3: Empty-state classification

After Step 2 polls and parses, classify the per-cycle finding state into exactly one of five cases. **No silent-empty path** — every empty result is either explicitly clean (case 3) or a loud-fail (case 4/5).

| Case | Claude side                                                                 | Codex side                                                                       | Action                                                  |
| ---- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1    | No new comment in unprocessed set                                           | No new review in unprocessed set; no unresolved threads                          | **Step 7 poll-next**                                    |
| 2    | New comment with ≥1 successfully-parsed finding **OR** unchanged            | New review with ≥1 inline finding, all parseable **OR** unchanged                | **Step 4 fix**                                          |
| 3    | New comment, 0 findings, verdict explicitly clean (per `is_claude_clean`)   | No new unresolved findings (all reviews `is_summary_clean` or already processed) | **Loop exit (clean)**                                   |
| 4    | New comment, parser failed (no `### [SEV]` blocks AND no parseable verdict) | New review, after race-retry inline still empty AND summary not explicitly clean | **loud-fail**, dump raw body to user                    |
| 5    | New comment, verdict says ⚠️ but 0 findings parseable                       | (case-4-equivalent on Codex side)                                                | **loud-fail** (reviewer claims problems but lists none) |

If at least one reviewer is case 2, the cycle proceeds with whatever findings were parsed from that reviewer (the other may be case 1 — that's fine; we just have nothing new from that side). Cases 4 and 5 abort the cycle BEFORE any code changes.

```bash
# Pseudocode for the case selection. Implement as a function in the skill.
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
````

On `LOUD_FAIL`: write the offending raw body to `.harness-github-review/cycle-${ROUND}-loud-fail-<source>.txt` and `exit 1`. Do NOT proceed to fix or commit.

On `EXIT_CLEAN`: continue to Step 7 (loop exit + retro prompt).

On `FIX`: proceed to Step 4.

On `POLL_NEXT`: continue to Step 7 (poll-next sub-flow).

````

- [ ] **Step 2: Verify and commit**

```bash
grep -A2 '^## Step 3' plugins/harness/skills/github-review/SKILL.md | head -5

git add plugins/harness/skills/github-review/SKILL.md
git commit -m "$(cat <<'EOF'
feat(#111): SKILL.md Step 3 — 5-case empty-state classification

Replaces the original silent-empty failure mode (issue #111 root cause)
with an explicit case table:
- case 1: nothing new → poll-next
- case 2: ≥1 finding → fix
- case 3: explicitly clean → exit
- case 4: parser failed → loud-fail
- case 5: dirty verdict but 0 findings → loud-fail

Loud-fail dumps raw body to .harness-github-review/cycle-N-loud-fail-*
so the user can inspect what the parser couldn't handle.

Spec section: §2.4.
EOF
)"
````

---

### Task 8: Step 4 — fix all findings

**Files:**

- Modify: `plugins/harness/skills/github-review/SKILL.md` (replace Step 4 placeholder)

**Spec reference:** §"Loop flow" (Step 4 fix box). The fix step is largely judgment + bash; not heavily prescribed by the spec since the existing skill's fix flow already works. Preserve the existing rules from the old skill, adapted to the new finding-table model.

- [ ] **Step 1: Replace the Step 4 placeholder**

Use Edit to replace the placeholder with:

```markdown
## Step 4: Fix all findings

For each finding in the cycle's finding table, in order:

1. **Read the file** at the specified `file` path and `line_range`. Use the `Read` tool with `offset` and `limit` parameters.
2. **Understand the issue** — the finding's `body` describes what's wrong and (often) suggests a fix. Cross-reference with the IDEA block if present (Claude reviewer always includes it; connector typically does not).
3. **Decide:**
   - **FIX** — make the minimal change to resolve the issue. Use `Edit` for surgical changes; `Write` only for whole-file replacements.
   - **SKIP** — explain why in the finding's `fix_summary` field. Valid reasons: false positive, intentional pattern with rationale, out of scope (the finding flagged adjacent untouched code in violation of the SCOPE BOUNDARY RULE).
4. After the change, set `finding.status = 'fixed'` (or `'skipped'`) and `finding.fix_summary = <one-sentence description>`.

**Rules** (preserved from the old skill, still apply):

- Fix **only** what the review identified. No drive-by refactoring.
- Never introduce new issues while fixing existing ones — Step 5's codex verify catches this if it slips through, but the discipline is to think about new-issue risk at fix time.
- Run quick local validation as you go (`npm run lint -- <file>`, `cargo check`, etc.) — but **do not** run the full test suite per finding. The full validation runs in Step 5.
- For each finding, also consult `docs/reviews/patterns/<matching-pattern>.md` BEFORE fixing if the pattern is relevant — it may carry prior fixes for the same finding class. If you read a pattern file, bump its `ref_count` in frontmatter by 1 (this is the consumer-bumps-on-read protocol from `docs/reviews/CLAUDE.md`).

**Do NOT commit yet.** Stage all changes (`git add`) but defer commit until after Step 5 (codex verify) passes.

After the loop, every finding has `status` ∈ {`fixed`, `skipped`}. Findings still `pending` after the loop = a bug in the loop logic; loud-fail.
```

- [ ] **Step 2: Verify and commit**

```bash
grep -A2 '^## Step 4' plugins/harness/skills/github-review/SKILL.md | head -3

git add plugins/harness/skills/github-review/SKILL.md
git commit -m "$(cat <<'EOF'
feat(#111): SKILL.md Step 4 — fix all findings (deferred commit)

- Per-finding fix or skip with rationale recorded in fix_summary
- Defers commit until Step 5 codex verify passes
- Preserves old-skill rules (no drive-by refactor, scope boundary)
- Adds pattern-consultation step: bump ref_count if pattern read pre-fix
- Pending findings after loop = loud-fail (logic bug)

Spec section: §"Loop flow" Step 4.
EOF
)"
```

---

### Task 9: Step 5 (parts A–C) — codex verify setup, prompt, call

**Files:**

- Modify: `plugins/harness/skills/github-review/SKILL.md` (begin filling Step 5)

**Spec reference:** §3.1 "Setup", §3.2 "Build verify prompt", §3.3 "Call codex exec (verified flags)".

- [ ] **Step 1: Replace the Step 5 placeholder, adding sections 5A through 5C**

Use Edit to replace `(Filled in Tasks 9–10.)` under `## Step 5: Codex verify on staged diff` with:

````markdown
After Step 4 stages all fixes (no commit yet), this step runs `codex exec` against the staged diff to verify:

1. Every upstream finding from this cycle is **addressed** by the diff.
2. The diff does **NOT** introduce new MEDIUM/HIGH/CRITICAL issues. New LOW issues are allowed and will be deferred.

If verify passes (or only finds new-LOW issues), Step 6 commits. If verify finds new MEDIUM/HIGH/CRITICAL issues OR any unaddressed upstream finding, the cycle re-enters Step 4 (retry budget ≤ 3). The matrix in Step 5D below is authoritative on which severity triggers what behavior.

### Step 5A: Setup — gitignored artifact directory

```bash
mkdir -p .harness-github-review

DIFF_PATCH=".harness-github-review/cycle-${ROUND}-diff.patch"
PROMPT_FILE=".harness-github-review/cycle-${ROUND}-verify-prompt.md"
RESULT_JSON=".harness-github-review/cycle-${ROUND}-verify-result.json"
EVENTS_LOG=".harness-github-review/cycle-${ROUND}-verify-events.log"
STDERR_LOG=".harness-github-review/cycle-${ROUND}-verify-stderr.log"
```
````

The directory is gitignored (Task 1's `.gitignore` change). Step 6's commit will explicitly enumerate files (no `git add -A`) so these artifacts can never accidentally land in a commit.

### Step 5B: Build the verify prompt

````bash
git diff --staged > "$DIFF_PATCH"
DIFF_LINES=$(wc -l < "$DIFF_PATCH")

# render_findings_table_with_F_ids: emit each finding as a markdown bullet
# referencing its cycle_id, source, severity, file, line_range, title, body.
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

The 500-line threshold for inline-vs-file is heuristic. Larger diffs would inflate the prompt past codex's effective context window; the file-pointer fallback lets codex use its own read tool to ingest progressively.

### Step 5C: Call `codex exec` (verified CLI flags)

```bash
timeout 300 codex exec \
  --sandbox read-only \
  --output-schema .github/codex/codex-output-schema.json \
  --output-last-message "$RESULT_JSON" \
  -- "$(cat "$PROMPT_FILE")" \
  > "$EVENTS_LOG" \
  2> "$STDERR_LOG"

CODEX_EXIT=$?
```

Important flag notes:

- `--output-schema` (not `--output-schema-file` — that flag does not exist).
- `--output-last-message` writes the final structured JSON; stdout is event-stream noise (events log).
- **No `--model` flag.** Per auto-memory `feedback_codex_model_for_chatgpt_auth`: omitting lets `codex` pick the auth-mode-correct default (ChatGPT-account auth rejects explicit model selection).
- External GNU `timeout 300` — `codex exec` has no built-in timeout flag.
- `--sandbox read-only`: codex is verifying, not modifying. Read-only ensures it can't alter the staged diff during verification.
- If `timeout` is unavailable on the platform: omit it and rely on the harness/agent timeout (typically 5–10 min). Acceptable degradation; codex normally finishes in 30–90s on a small staged diff.

````

- [ ] **Step 2: Verify and commit**

```bash
grep -c '^### Step 5' plugins/harness/skills/github-review/SKILL.md

git add plugins/harness/skills/github-review/SKILL.md
git commit -m "$(cat <<'EOF'
feat(#111): SKILL.md Steps 5A-5C — codex verify setup + prompt + call

Step 5A: gitignored artifact dir (.harness-github-review/cycle-N-*).
Step 5B: prompt builder with finding-table rendering and conditional
  inline-vs-file diff embedding (500-line threshold).
Step 5C: codex exec invocation with verified flags:
  --output-schema (not --output-schema-file)
  --output-last-message $RESULT_JSON
  --sandbox read-only
  no --model (per feedback_codex_model_for_chatgpt_auth memory)
  external timeout 300 (no built-in flag)

Spec sections: §3.1, §3.2, §3.3.
EOF
)"
````

---

### Task 10: Step 5 (parts D–G) — verify result classification, retry budget, abort, docs-only escape

**Files:**

- Modify: `plugins/harness/skills/github-review/SKILL.md` (continue filling Step 5)

**Spec reference:** §3.4 "Result classification matrix", §3.5 "Verify retry budget", §3.6 "Docs-only escape", §3.7 "Abort".

- [ ] **Step 1: Append Steps 5D through 5G**

Use Edit to add after the Step 5C block:

````markdown
### Step 5D: Result classification matrix

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
````

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

`overall_correctness` enum is `"patch is correct" | "patch has issues"` per `.github/codex/codex-output-schema.json`. The matrix uses these exact strings.

### Step 5E: Verify retry budget

`VERIFY_RETRY_COUNTER` starts at 0 at cycle start. Each `unaddressed_upstream` / `new_medium` / `new_high` re-entry to Step 4 increments it.

```bash
if [ "$VERIFY_RETRY_COUNTER" -ge 3 ]; then
  echo "Verify retry budget exhausted (3 attempts) — aborting cycle." >&2
  goto_step_5g_abort
fi

VERIFY_RETRY_COUNTER=$((VERIFY_RETRY_COUNTER + 1))
goto_step_4
```

### Step 5F: Docs-only escape (narrow)

Verify is skipped only when **all three** are true:

1. Every Finding in the cycle is severity LOW
2. Every staged path matches `^docs/` OR `^[^/]*\.md$` OR `^[^/]*\.txt$`
3. **No** staged path matches `^\.github/`, `^package(-lock)?\.json$`, `^src-tauri/`, `^src/`, `^vite\.config\.`, `^tailwind\.config\.`, `^eslint\.config\.`, `^tsconfig\.`, `^\.husky/`

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

### Step 5G: Abort

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

1. Cycle metadata: round number, abort reason, retry counter at abort, started/aborted timestamps.
2. The cycle's full Finding table (the `$FINDINGS_JSON`), each finding's `status` and `fix_summary`.
3. For each verify attempt 1..N: the prompt sent, raw `findings[]` from the result JSON, which findings caused retry/abort.
4. The watermark trailers that **would have been** committed for this cycle (so the user can re-run after manual fixup without losing the watermark progression).
5. A "Recommended next steps" section enumerating the recovery paths from the Cleanup section (§6.3).

The skill **does not** auto-`git stash`. Working tree is left visible. The skill exits the entire loop (not just this cycle):

```bash
echo "Cycle ${ROUND} aborted in verify after ${VERIFY_RETRY_COUNTER} attempts."
echo "See $ABORT_DIR/."
echo ""
echo "Working tree contains the last attempted fix — inspect with 'git status' / 'git diff'."
echo "See § Cleanup → recovery paths for next steps."
exit 1
```

````

- [ ] **Step 2: Verify and commit**

```bash
grep -c '^### Step 5' plugins/harness/skills/github-review/SKILL.md

git add plugins/harness/skills/github-review/SKILL.md
git commit -m "$(cat <<'EOF'
feat(#111): SKILL.md Steps 5D-5G — verify classify + retry + escape + abort

Step 5D: result classification matrix using exact schema enum strings
  ("patch is correct" / "patch has issues"). [UNADDRESSED Fk] prefix
  protocol distinguishes unaddressed-upstream from new-finding paths.
Step 5E: retry budget ≤3 per cycle.
Step 5F: docs-only escape with narrow allowlist (docs/, *.md, *.txt
  only) AND explicit forbidden-list (.github/, src/, src-tauri/,
  package*.json, all config files).
Step 5G: abort writes patches + incident.md to cycle-N-aborted/. NO
  auto-git-stash. Loop exits 1.

Spec sections: §3.4, §3.5, §3.6, §3.7.
EOF
)"
````

---

### Task 11: Step 6 — pattern KB write + stage + commit + push + reply + resolve threads

**Files:**

- Modify: `plugins/harness/skills/github-review/SKILL.md` (replace Step 6 placeholder)

**Spec reference:** §4 "Pattern KB integration" (subsections 4.1–4.5), Loop-flow Step 6 ordering.

- [ ] **Step 1: Replace the Step 6 placeholder**

Use Edit. The Step 6 content is large; this is the longest single section. The order is critical:

1. Write/append patterns (§4)
2. `git add` code changes + pattern files explicitly (no `-A`)
3. Single `git commit` with full trailer block
4. `git push`
5. For each connector finding: `gh api -X POST .../pulls/comments/{id}/replies` (cite commit SHA)
6. For each thread: GraphQL `resolveReviewThread`

Replace the placeholder with:

```markdown
## Step 6: Write patterns → stage all → commit → push → reply + resolve threads

This step lands the cycle's work atomically. **Order matters** — pattern files must be written BEFORE the commit (so they're part of the same commit as the code fix), and reply + thread resolution must come AFTER push (so the cited commit SHA exists on origin).

### 6.1: Match each fixed finding to a pattern file

For each finding with `status == 'fixed'`, decide its target pattern file using the algorithm from spec §4.1:
```

1. Read docs/reviews/CLAUDE.md → get list of (pattern_file_path, category).
2. Pre-filter candidates by:
   - Finding's file path overlap with files already in the pattern.
   - Category vs finding's domain.
3. Read Summary section ONLY for the top 3-5 candidates from Step 2 to disambiguate.
4. Fallback rules:
   a. 2+ findings sharing a novel theme → create new pattern.
   b. Single novel security/data-loss/correctness finding → create new pattern (single-entry security patterns earn their cost).
   c. Other single novel findings → fit into closest existing with a 1-line note.
5. Never create a new category without user approval — abort with prompt.

```

Record decisions in a list for the commit-message trailer:
```

Pattern-Append-Decisions:

- F1 (alias recursion) → patterns/async-race-conditions.md (existing, theme: bounded recursion)
- F2 (Authorization regex) → patterns/credential-leakage.md (NEW pattern)

````

### 6.2: Append entries to existing patterns

For each finding routed to an existing pattern, compute the next entry number:

```python
def next_finding_number(pattern_file_path: str) -> int:
    text = read(pattern_file_path)
    if "## Findings" not in text:
        return 1
    findings_section = text.split("## Findings", 1)[1]
    findings_section = findings_section.split("\n## ", 1)[0]  # stop at next H2
    matches = re.findall(r'^### (\d+)\. ', findings_section, re.MULTILINE)
    return max(int(n) for n in matches) + 1 if matches else 1
````

Append each entry under `## Findings`, schema:

```markdown
### N. <Finding's title>

- **Source:** <github-claude | github-codex-connector | local-codex> | PR #<PR_NUMBER> round <ROUND> | <YYYY-MM-DD>
- **Severity:** <severity_label_original> # e.g. "HIGH" or "P1 / HIGH"
- **File:** `<repo-relative path>`
- **Finding:** <one to three sentences from the finding body>
- **Fix:** <one to three sentences describing what was changed>
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)
```

Note: `Commit:` does NOT contain the SHA — pattern file is part of the same commit being created, so the SHA isn't yet known. Recoverable via `git blame` later.

Update frontmatter `last_updated:` to today's date. Do **NOT** bump `ref_count` on append — it's a consumer counter (per `docs/reviews/CLAUDE.md`).

### 6.3: Create new patterns when needed

For findings without a close fit, create a new pattern file at `docs/reviews/patterns/<kebab-slug>.md`:

```markdown
---
id: <kebab-slug-of-name>
category: <one of: security | react-patterns | testing | terminal | code-quality |
                   error-handling | files | review-process | a11y | cross-platform |
                   editor | backend | correctness | e2e-testing>
created: <today>
last_updated: <today>
ref_count: 0
---

# <Title Case Pattern Name>

## Summary

<One paragraph (3-5 sentences) describing the pattern's theme — failure mode + general fix shape — drafted from the finding bodies that triggered creation.>

## Findings

### 1. <First finding's title>

- **Source:** ...
  (continues per 6.2 schema)
```

Category MUST come from the existing closed list (see §4.3). New categories require user approval — abort if needed.

### 6.4: Update the pattern index

`docs/reviews/CLAUDE.md` has a markdown table:

| Pattern                                          | Category | Findings | Refs | Last Updated |
| ------------------------------------------------ | -------- | -------- | ---- | ------------ |
| [Filesystem Scope](patterns/filesystem-scope.md) | security | 20       | 2    | 2026-04-29   |

For each touched pattern, update the row's `Findings` count (re-derive from `### N.` count after this commit's appends), `Last Updated` to today. `Refs` unchanged.

For new pattern files, append a row in the same alphabetical order as existing rows (or end-of-table — verify by reading the file before adding).

### 6.5: Stage everything explicitly

**Do not** use `git add -A` — that would catch the gitignored `.harness-github-review/` if the gitignore failed somehow, and unrelated untracked files. List exact files:

```bash
# Build the staged file list:
STAGED_FILES=()

# Code-fix files (from Step 4 modifications):
while IFS= read -r f; do STAGED_FILES+=("$f"); done < <(git diff --name-only)

# Pattern files modified or created in this cycle:
for f in "${TOUCHED_PATTERN_FILES[@]}"; do STAGED_FILES+=("$f"); done

# Index file if any pattern was added/created:
if [ "${INDEX_TOUCHED:-0}" -eq 1 ]; then
  STAGED_FILES+=("docs/reviews/CLAUDE.md")
fi

git add "${STAGED_FILES[@]}"
git status --short  # sanity check — verify expected files staged, no surprises
```

### 6.6: Build the commit message and commit

```bash
COMMIT_MSG_FILE=".harness-github-review/cycle-${ROUND}-commit-msg.txt"

cat > "$COMMIT_MSG_FILE" <<EOF
fix(#${PR_NUMBER}): address review round ${ROUND} findings

$(render_per_finding_listing)

Reviewers: $(list_unique_sources)

GitHub-Review-Processed-Claude: ${LATEST_CLAUDE_ID:-}
GitHub-Review-Superseded-Claude: $(jq -r 'join(",")' <<< "$SUPERSEDED_THIS_CYCLE")
GitHub-Review-Processed-Codex-Reviews: $(jq -r 'join(",")' <<< "$UNPROCESSED_REVIEW_IDS_JSON")
GitHub-Review-Processed-Codex-Inline: $(list_inline_ids_processed_this_cycle)
Closes-Codex-Threads: $(list_thread_ids_to_close)
Pattern-Files-Touched: $(printf '%s, ' "${TOUCHED_PATTERN_FILES[@]}" | sed 's/, $//')
Pattern-Append-Decisions:
$(render_pattern_append_decisions)
EOF

# Conditional trailers (only if state applies):
if [ -n "${VERIFY_DEFERRED_LOW:-}" ]; then
  echo "Verify-Deferred-LOW: $VERIFY_DEFERRED_LOW" >> "$COMMIT_MSG_FILE"
fi
if [ "${VERIFY_SKIPPED:-0}" -eq 1 ]; then
  echo "Verify-Skipped: docs-only" >> "$COMMIT_MSG_FILE"
fi

git commit -F "$COMMIT_MSG_FILE"
COMMIT_SHA=$(git rev-parse HEAD)

echo "Committed cycle $ROUND as $COMMIT_SHA"
```

### 6.7: Push

```bash
git push
```

### 6.8: Reply to each connector inline finding

```bash
for finding in $(jq -c '.[] | select(.source == "codex-connector" and .status == "fixed")' <<< "$FINDINGS_JSON"); do
  COMMENT_ID=$(jq -r '.source_comment_id' <<< "$finding")
  CYCLE_ID=$(jq -r '.cycle_id' <<< "$finding")
  TITLE=$(jq -r '.title' <<< "$finding")
  FIX_SUMMARY=$(jq -r '.fix_summary // ""' <<< "$finding")

  REPLY_BODY=$(cat <<EOF
Fixed in $COMMIT_SHA — $FIX_SUMMARY

(github-review cycle ${ROUND}, finding ${CYCLE_ID})
EOF
)

  gh api -X POST "repos/$REPO/pulls/$PR_NUMBER/comments/${COMMENT_ID}/replies" \
    -f body="$REPLY_BODY"
done
```

### 6.9: Resolve threads via GraphQL

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

After 6.8 + 6.9, every finding has been:

- Fixed in code (Step 4)
- Verified by codex (Step 5)
- Documented in the pattern KB (6.1–6.4)
- Committed atomically (6.5–6.6)
- Pushed (6.7)
- Replied to on the connector side (6.8)
- Marked resolved in GraphQL (6.9)

The cycle is now done. Proceed to Step 7.

````

- [ ] **Step 2: Verify and commit**

```bash
grep -c '^### 6\.' plugins/harness/skills/github-review/SKILL.md

git add plugins/harness/skills/github-review/SKILL.md
git commit -m "$(cat <<'EOF'
feat(#111): SKILL.md Step 6 — pattern KB + commit + push + reply + resolve

Critical ordering: write patterns BEFORE commit (atomicity); reply +
resolveReviewThread AFTER push (so cited commit SHA exists on origin).

6.1: Pattern matching algorithm (read index → pre-filter → read summaries
     → judgment with fallback rules; new categories require user approval)
6.2: Append entries — next_finding_number() scoped to ## Findings only
6.3: New pattern file template — closed category list
6.4: Index row update — re-derive Findings count, last_updated to today
6.5: Explicit STAGED_FILES enumeration (no git add -A)
6.6: Commit message with full trailer block:
     Processed-Claude / Superseded-Claude / Processed-Codex-Reviews /
     Processed-Codex-Inline / Closes-Codex-Threads / Pattern-Files-Touched
     / Pattern-Append-Decisions; conditional Verify-Deferred-LOW and
     Verify-Skipped trailers
6.7: git push
6.8: Per-finding reply via gh api .../pulls/comments/{id}/replies
6.9: Per-thread resolveReviewThread mutation

Spec section: §4 (and Loop-flow Step 6 ordering).
EOF
)"
````

---

### Task 12: Step 7 — exit check + retro prompt + Cleanup section

**Files:**

- Modify: `plugins/harness/skills/github-review/SKILL.md` (fill Step 7 + Cleanup placeholders)

**Spec reference:** §5 "Loop exit & retro prompt", §6 "Cleanup, recovery & failsafe" (all subsections).

- [ ] **Step 1: Replace the Step 7 placeholder**

````markdown
## Step 7: Exit check + retro prompt

After Step 6 commits + pushes (or after Step 3 returns `EXIT_CLEAN` / `POLL_NEXT`), determine if the loop continues or exits.

### 7.1: Check connector unresolved threads via GraphQL

Reuse the `paginated_review_threads_query` helper defined in Step 2B (no separate inline GraphQL query — that would re-introduce the unpaginated-bounded-query bug):

```bash
UNRESOLVED_CONNECTOR_THREADS=$(paginated_review_threads_query \
  | jq '[.[] | select(.comment_author_login == "chatgpt-codex-connector[bot]"
                      and .isResolved == false)] | length')
```
````

If this number is > 0, the connector still has unresolved findings (either from this cycle's work that didn't fully resolve, or from a fresh review that just landed).

### 7.2: Check Claude verdict on the latest comment

After Step 6's push, the Claude reviewer will re-run on the new commit. The verdict on its NEW comment determines if Claude is satisfied. If we're at this step right after a fresh commit, the new Claude review hasn't run yet — that's the "poll-next" case.

### 7.3: Decide

- **All clean** = `UNRESOLVED_CONNECTOR_THREADS == 0` AND latest Claude comment verdict is `is_claude_clean` AND ROUND < MAX_ROUNDS → **exit clean**.
- **More expected** = either reviewer hasn't reported on the new commit yet → **poll next**.
- **Max rounds reached** = ROUND == 10 → exit "max rounds" (abnormal — print warning).

### 7.4: Poll-next sub-flow

```bash
echo "Round $ROUND committed — polling for next review (60s × 10 rounds)."

for poll_attempt in $(seq 1 10); do
  sleep 60
  # Re-poll Claude and connector exactly as Step 2.
  # If new finding(s) appear (cases 2/3/4/5), break and either continue cycle or loud-fail.
  if step_2_yields_new_content; then
    ROUND=$((ROUND + 1))
    goto_step_2
  fi
done

echo "No new review after 10×60s — exiting loop."
goto_step_7_clean_exit_message
```

### 7.5: Clean exit message + retro prompt

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

# Run cleanup before exit (§6.1 success path).
cleanup_on_clean_exit
```

### 7.6: Abnormal exit message

For max-rounds, abort, or poll-timeout:

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

The skill **does NOT auto-write retros**. Synthesis needs hindsight; mandatory low-value retros pollute the directory.

````

- [ ] **Step 2: Replace the Cleanup placeholder**

```markdown
## Cleanup, recovery & failsafe

### Per-cycle artifact lifecycle

The skill writes `cycle-${ROUND}-*` files to `.harness-github-review/` (gitignored): `cycle-${ROUND}-diff.patch`, `cycle-${ROUND}-verify-prompt.md`, `cycle-${ROUND}-verify-result.json`, `cycle-${ROUND}-verify-events.log`, `cycle-${ROUND}-verify-stderr.log`. On abort, also `cycle-${ROUND}-aborted/`.

| Event | Action |
| --- | --- |
| Round N commits OK, loop continuing to N+1 | **Keep** N's artifacts. Next round may compare. |
| Round N aborts → loop exits | **Preserve everything** in `.harness-github-review/`. Print recovery instructions (below). |
| Loop exits cleanly (final round verdict clean) | `cleanup_on_clean_exit`: wipe non-aborted `cycle-*-{diff,verify-prompt,verify-result,verify-events,verify-stderr}.{patch,md,json,log}` files. **Preserve any `cycle-*-aborted/` dirs** from earlier rounds in this run. Print "cleaned N artifact files from this run". |
| New `/harness-plugin:github-review` invocation, `.harness-github-review/` already has prior content | **Scan first.** If any `cycle-*-aborted/` dirs found from prior loops → **prompt user**: list paths, suggest inspecting, do NOT auto-delete. Skill exits without starting a new loop. If only orphaned `cycle-*` files exist → wipe with one-line "cleaned N stale files from prior run" notice and proceed. |

The "scan-on-loop-start, prompt-don't-delete" rule for prior aborted dirs is the **load-bearing forensics guarantee**: aborted dirs are the evidence we need when the loop failed in a confusing way. Auto-deleting violates the loud-fail / preserve-forensics posture.

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
````

`loop_start_scan` runs at the start of Step 1 (BEFORE input resolution). `cleanup_on_clean_exit` runs in Step 7.5.

### No `git stash`, by design

The skill does NOT auto-`git stash`. Reasons:

1. **Working-tree visibility.** Auto-hiding contradicts loud-fail discipline.
2. **Loop state lives elsewhere.** Persistent state is GitHub + commit trailers. Abort artifacts are `.harness-github-review/cycle-*-aborted/`. Stash would be a third surface.
3. **Stash is user-controlled.** A parking lot for the user's own workflow needs.

Stash is documented as one of three explicit user-driven recovery paths (below), not an automatic step.

### Three recovery paths on abort

The skill prints all three in §3.7's exit message:

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

- `git restore --staged . && git restore .` reverts both index and working-tree mods, including staged deletions (which `git checkout -- .` misses).
- Untracked-file removal is **per-path from `untracked.txt`**, not blanket `git clean -fd`. Blanket clean risks deleting unrelated work.

### Pattern-file rollback is N/A

Pattern appends only happen if the cycle's commit succeeds (§4 atomicity). On abort, attempted appends are still in working tree alongside the code fix — discarded by recovery path 1, kept by paths 2/3.

### Watermark trailers are durable

Trailers live in committed history; nothing to clean. If the entire fix commit needs to be undone (`git reset HEAD~1`), the trailers vanish with the commit and the next cycle re-derives a smaller processed set. Self-healing.

### Manual full reset

```bash
rm -rf .harness-github-review/
```

Safe because gitignored. Wipes all artifacts including aborted dirs. User invokes only after resolving aborted dirs.

````

- [ ] **Step 3: Final structural verification**

```bash
grep -c '^## ' plugins/harness/skills/github-review/SKILL.md
grep -c '^### ' plugins/harness/skills/github-review/SKILL.md
wc -l plugins/harness/skills/github-review/SKILL.md
````

Expected:

- `^## ` count: ~10 (title + Loop Control + Step 0 + Step 1 + Step 1.5 + Step 2 + Step 3 + Step 4 + Step 5 + Step 6 + Step 7 + Cleanup)
- `^### ` count: ~25–30 (subsections under each step)
- Total lines: ~600–700

- [ ] **Step 4: Run prettier on the file**

```bash
npx prettier --write plugins/harness/skills/github-review/SKILL.md
```

Accept Prettier's formatting. Re-check lines didn't shift in a way that breaks code blocks.

- [ ] **Step 5: Commit**

```bash
git add plugins/harness/skills/github-review/SKILL.md
git commit -m "$(cat <<'EOF'
feat(#111): SKILL.md Step 7 + Cleanup — exit check + retro + lifecycle

Step 7:
  7.1: GraphQL unresolved-connector-threads check (paginated as Step 2)
  7.2: Claude verdict check on latest comment
  7.3: All-clean / poll-next / max-rounds decision
  7.4: Poll-next sub-flow (60s × 10)
  7.5: Clean exit message + retro prompt (conditional /write-retro)
  7.6: Abnormal exit message (does NOT cleanup; forensics preserved)

Cleanup section:
  - Per-cycle artifact lifecycle table
  - loop_start_scan() runs before Step 1, prompts on prior aborted dirs
  - cleanup_on_clean_exit() runs in Step 7.5
  - No-auto-git-stash rationale
  - Three recovery paths on abort (corrected commands per spec §6.3)
  - Pattern-file rollback N/A; watermark trailers durable
  - Manual full reset (gitignored, safe)

Skill rewrite is now content-complete. Acceptance gate (self-test on
throwaway PR) follows.

Spec sections: §5, §6.
EOF
)"
```

---

## Phase 2: Acceptance gate (pre-merge self-test)

The skill rewrite is content-complete after Task 12. Tasks 13–15 prove it works end-to-end on a real PR before this branch's PR can merge.

### Task 13: Open a throwaway PR with deliberate bugs (in an isolated worktree)

**Goal:** Create a PR that both reviewers will catch findings on, **without** disturbing the fix/111 primary working tree.

**Why a worktree?** The fix/111 primary checkout has many unrelated untracked dotfiles (`.bash_profile`, `.bashrc`, `.claude/agents`, etc.). `git stash push -u` would sweep them into a stash with the engineer's actual work, and a later `git stash pop` could fail or scatter them. Per `rules/common/worktrees.md`, parallel/isolated work belongs under `.claude/worktrees/<branch>/` (gitignored). The throwaway PR self-test is exactly that: a parallel context with its own branch and commits, completely independent of the fix/111 implementation work.

**Files:**

- Created: `.claude/worktrees/test-throwaway-for-111/` (gitignored, local-only) — full working tree on branch `test/throwaway-for-111` (branched from `main`)
- Created in worktree: `src/__throwaway__.ts` (the deliberate-bug file)
- Cleanup at end of Task 14: worktree removed, branch deleted

- [ ] **Step 1: Confirm the fix/111 working tree is clean (no auto-stash anywhere)**

The primary checkout's tracked files must be committed before Task 13. Untracked dotfiles are fine — they stay put across worktree operations.

```bash
# From the primary checkout (still on fix/111-github-review-connector):
git status
git diff --quiet && git diff --staged --quiet || (
  echo "ERROR: fix/111 has uncommitted tracked changes. Commit or discard before Task 13." >&2
  exit 1
)
```

If tracked changes exist: commit them as part of whichever Task 1–12 they belong to, or discard if accidental. **Do not stash.**

- [ ] **Step 2: Create the throwaway worktree from `main`**

```bash
# From the primary checkout. This creates a separate working tree on a new
# branch test/throwaway-for-111, branched from origin/main, under
# .claude/worktrees/test-throwaway-for-111/. Primary fix/111 working tree
# is untouched throughout.
git fetch origin main --no-tags
git worktree add .claude/worktrees/test-throwaway-for-111 -b test/throwaway-for-111 origin/main
```

Verify:

```bash
git worktree list   # should show two entries: primary (fix/111-...) and the new throwaway
ls .claude/worktrees/test-throwaway-for-111/   # full repo checkout, on test/throwaway-for-111
```

- [ ] **Step 3: Introduce one HIGH-class bug Claude will catch**

Switch into the worktree and create the throwaway file:

```bash
cd .claude/worktrees/test-throwaway-for-111
```

Create `src/__throwaway__.ts` with an unbounded-recursion bug Claude reliably catches:

```typescript
// Deliberate bug for #111 self-test — DELETE BEFORE MERGE.
export const recurse = (n: number): number => {
  // BUG: no base case → stack overflow on any input.
  return recurse(n - 1) + 1
}
```

- [ ] **Step 4: Add a P1-class inline bug the connector will catch**

Append to the same `src/__throwaway__.ts` file in the worktree:

```typescript
// BUG: hardcoded API key — chatgpt-codex-connector flags credential exposure.
export const apiKey = 'sk-test-DO-NOT-USE-real-key-shape'
```

- [ ] **Step 5: Commit, push, open the throwaway PR (from the worktree)**

```bash
# Still inside .claude/worktrees/test-throwaway-for-111
git add src/__throwaway__.ts
git commit -m "test: throwaway PR for #111 self-test (DO NOT MERGE)"
git push -u origin test/throwaway-for-111
gh pr create \
  --base main \
  --head test/throwaway-for-111 \
  --title "test: throwaway for /harness-plugin:github-review #111 self-test" \
  --body "$(cat <<'EOF'
## Throwaway PR for issue #111 self-test

This PR contains deliberate bugs to validate the rewritten
\`/harness-plugin:github-review\` skill end-to-end.

DO NOT MERGE. Closes after self-test capture.

Bugs intentionally introduced:
1. Unbounded recursion in \`src/__throwaway__.ts:recurse\` — Claude review should catch.
2. Hardcoded API key constant — chatgpt-codex-connector should catch inline.

Tracks: #111
EOF
)"
```

Note the PR number that gets returned (e.g., `#NNN`). Save it as `THROWAWAY_PR_NUMBER` for use in Task 14.

- [ ] **Step 6: Wait for both reviewers to post**

Both reviewers run on every push. Stay in the worktree (or anywhere — `gh pr view` is host-wide). Wait until:

- An issue comment appears with `## Claude Code Review` header
- A `chatgpt-codex-connector[bot]` review + at least one inline comment appears

```bash
gh pr view "$THROWAWAY_PR_NUMBER" --json comments,reviews --jq '{
  claude_comment_count: [.comments[] | select(.body | startswith("## Claude Code Review"))] | length,
  connector_review_count: [.reviews[] | select(.author.login == "chatgpt-codex-connector[bot]")] | length
}'
```

Typical timeline: 2–10 minutes for Claude, 1–5 minutes for the connector. Both must show ≥1 before Task 14.

The fix/111 primary checkout was never touched throughout Task 13. Task 14 will run the skill **from the worktree** so its commit/push lands on `test/throwaway-for-111`, not fix/111.

---

### Task 14: Run the self-test against the throwaway PR (from the worktree), then clean up

**Goal:** Invoke the new skill from the throwaway worktree, verify acceptance criteria, copy evidence to the primary fix/111 checkout, then remove the worktree.

**Files:** No code changes on fix/111 from this task. The skill executes inside the throwaway worktree (committing + pushing to `test/throwaway-for-111`); evidence is copied OUT of the worktree before cleanup.

- [ ] **Step 1: Update the host-wide plugin cache from the primary checkout**

The Claude Code plugin cache lives at `~/.claude/plugins/cache/harness/` (host-wide, shared across worktrees). The new SKILL.md lives in the **primary fix/111 working tree** at `plugins/harness/skills/github-review/SKILL.md`. Sync them:

```bash
# From the primary checkout (PWD = /home/will/projects/vimeflow):
ls -la ~/.claude/plugins/cache/harness/skills/github-review/SKILL.md 2>/dev/null \
  || (echo "Plugin cache not present — run /plugin install harness-plugin@harness first" >&2; exit 1)

# Diff the cache vs the primary checkout's updated SKILL.md.
diff plugins/harness/skills/github-review/SKILL.md ~/.claude/plugins/cache/harness/skills/github-review/SKILL.md \
  || cp plugins/harness/skills/github-review/SKILL.md ~/.claude/plugins/cache/harness/skills/github-review/SKILL.md

echo "Plugin cache now reflects the rewritten SKILL.md."
```

The `cp` is faster than `/plugin install` for self-test iteration cycles. After Task 14 ships, normal `/plugin install` workflow resumes.

- [ ] **Step 2: Invoke the skill from inside the throwaway worktree**

The skill does `git commit` + `git push` from `$PWD`'s working tree. To make those land on `test/throwaway-for-111` (not fix/111), invoke from inside the worktree:

```bash
cd /home/will/projects/vimeflow/.claude/worktrees/test-throwaway-for-111
pwd                    # confirm
git branch --show-current   # should print: test/throwaway-for-111
```

In your Claude Code session, with the working directory set to the worktree, run:

```
/harness-plugin:github-review
```

When prompted (or via env), supply the throwaway PR number:

```
USER_SUPPLIED_PR_NUMBER=$THROWAWAY_PR_NUMBER
```

Or as an argument: `/harness-plugin:github-review $THROWAWAY_PR_NUMBER`.

- [ ] **Step 3: Watch the skill execute end-to-end**

The skill will (working inside the worktree):

1. Resolve the throwaway PR via `USER_SUPPLIED_PR_NUMBER` (Step 0)
2. Derive watermarks from `git log $PR_BASE..HEAD` — empty on first run (Step 1)
3. Pass non-review-CI check (Step 1.5) — throwaway PR has no project tests touching its single throwaway file
4. Poll Claude + connector (Step 2). Both should yield findings.
5. Classify as case 2 (Step 3)
6. Fix `src/__throwaway__.ts` (add base case, remove hardcoded key) (Step 4)
7. Codex verify on staged diff (Step 5)
8. Append patterns + commit + push + reply + resolve threads (Step 6) — pushes to `test/throwaway-for-111`
9. Poll for next round (Step 7); on the second round both reviewers should return clean verdicts

Skill artifacts land in `<worktree>/.harness-github-review/cycle-N-*` (the worktree's gitignored dir, not fix/111's).

- [ ] **Step 4: Verify against issue #111's acceptance criteria; copy evidence to primary**

Stay in the worktree to gather evidence (because the cycle-N files live there). Then copy out to the primary checkout's `.harness-github-review/acceptance-evidence/`:

```bash
# From inside the throwaway worktree
WORKTREE_DIR="$PWD"
PRIMARY_DIR="/home/will/projects/vimeflow"
ACCEPTANCE_DIR="$PRIMARY_DIR/.harness-github-review/acceptance-evidence"
mkdir -p "$ACCEPTANCE_DIR"

# Capture remote-state evidence (host-wide gh queries — work from any directory)
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
OWNER=${REPO%%/*}
NAME=${REPO#*/}

# 1. Connector inline findings on the throwaway PR
gh api "repos/$REPO/pulls/$THROWAWAY_PR_NUMBER/comments" \
  --jq '[.[] | select(.user.login == "chatgpt-codex-connector[bot]")]' \
  > "$ACCEPTANCE_DIR/01-connector-inline.json"

# 2. Skill events log from cycle 1 (proves no silent-empty)
cp "$WORKTREE_DIR/.harness-github-review/cycle-1-verify-events.log" "$ACCEPTANCE_DIR/02-cycle-1-events.log"

# 3 & 4. Verify result + prompt
cp "$WORKTREE_DIR/.harness-github-review/cycle-1-verify-result.json" "$ACCEPTANCE_DIR/03-cycle-1-verify-result.json"
cp "$WORKTREE_DIR/.harness-github-review/cycle-1-verify-prompt.md" "$ACCEPTANCE_DIR/04-cycle-1-verify-prompt.md"

# 5. Final thread state from GraphQL — proves resolveReviewThread fired
gh api graphql -f query='
  query($owner:String!, $name:String!, $pr:Int!) {
    repository(owner:$owner, name:$name) {
      pullRequest(number:$pr) {
        reviewThreads(first:100) {
          nodes {
            id isResolved
            comments(first:5) { nodes { databaseId author { login } body } }
          }
        }
      }
    }
  }' -F owner="$OWNER" -F name="$NAME" -F pr="$THROWAWAY_PR_NUMBER" \
  > "$ACCEPTANCE_DIR/05-final-thread-state.json"

# 6 & 7. Commits + trailers from the worktree (where skill committed)
# Use the worktree's git index since fix/111 doesn't see test/throwaway-for-111 commits.
(cd "$WORKTREE_DIR" \
  && git log "origin/main..HEAD" --pretty=fuller \
       --grep "Pattern-Files-Touched" \
  ) > "$ACCEPTANCE_DIR/06-pattern-commits.txt"

(cd "$WORKTREE_DIR" \
  && git log "origin/main..HEAD" --pretty=%B \
  | grep -E '^GitHub-Review-Processed-(Claude|Codex-Reviews|Codex-Inline)|^GitHub-Review-Superseded-Claude|^Closes-Codex-Threads|^Pattern-Files-Touched|^Pattern-Append-Decisions' \
  ) > "$ACCEPTANCE_DIR/07-trailers.txt"
```

Expected outcomes:

- File 01: at least one entry from `chatgpt-codex-connector[bot]`
- File 02: log shows "Working on PR #..." line and case-2 classification
- File 03: `findings: []` in the final cycle (clean verdict reached)
- File 04: prompt embeds the staged diff (small) or references the patch file (large)
- File 05: `isResolved: true` for at least one thread (the connector thread we replied to + resolved)
- File 06: at least one commit on `test/throwaway-for-111` has `Pattern-Files-Touched:` trailer
- File 07: six trailer types present, well-formed comma-separated lists

If any expected outcome is missing: the skill has a real bug. Fix on the fix/111 branch, sync the cache (`cp` again), and re-run the skill against the throwaway PR.

- [ ] **Step 5: Close the throwaway PR (no merge)**

```bash
# From anywhere — gh is host-wide
gh pr close "$THROWAWAY_PR_NUMBER" \
  --comment "Self-test complete for #111. Closing without merge. Evidence captured in fix/111-github-review-connector PR body."
```

- [ ] **Step 6: Remove the throwaway worktree and branch**

```bash
# Back to primary checkout
cd /home/will/projects/vimeflow

# Remove the worktree (deletes .claude/worktrees/test-throwaway-for-111/).
git worktree remove .claude/worktrees/test-throwaway-for-111
git worktree list   # confirm only the primary remains

# Delete the local branch
git branch -D test/throwaway-for-111

# Delete the remote branch (gh pr close doesn't auto-delete)
git push origin --delete test/throwaway-for-111
```

Verify:

```bash
git worktree list                          # one entry: primary fix/111
git branch -a | grep throwaway || echo "OK: no throwaway branch local or remote"
```

`.harness-github-review/acceptance-evidence/` remains on the primary fix/111 working tree (not committed; gitignored) for the Task 15 PR body.

---

### Task 15: Open the fix/111 PR with self-test evidence

**Goal:** Open this branch's PR against `main`, with the acceptance-evidence linked in the body.

- [ ] **Step 1: Sanity check the branch**

```bash
git status                # should be clean (no uncommitted changes)
git log main..HEAD --oneline   # should show ~12-13 commits from Tasks 1-12
git push -u origin fix/111-github-review-connector
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create \
  --base main \
  --head fix/111-github-review-connector \
  --title "fix(#111): harness-github-review connector-aware rewrite" \
  --body "$(cat <<'EOF'
## Summary

Rewrites `/harness-plugin:github-review` to consume the chatgpt-codex-connector inline review surface plus the surviving Claude Code Review aggregated comments. Disables the quota-blocked aggregated `codex-review.yml` workflow. Adds atomic per-cycle pattern KB appends and a post-fix `codex exec` verify gate.

Closes #111. Spec at [`docs/superpowers/specs/2026-04-29-harness-github-review-connector-design.md`](docs/superpowers/specs/2026-04-29-harness-github-review-connector-design.md).

## What changed

- `plugins/harness/skills/github-review/SKILL.md` — full rewrite, Steps 0-7 + Cleanup section (~700 lines)
- `.github/workflows/codex-review.yml` → `.disabled`
- `.gitignore` — adds `.harness-github-review/`
- `CHANGELOG.md` + `CHANGELOG.zh-CN.md` — workflow disable note
- `docs/reviews/CLAUDE.md` — source-label documentation block

No code changes outside the skill prompt. No test changes (skill files have no Vitest/cargo coverage per project convention).

## Test plan (acceptance gate per spec §"Acceptance gate (pre-merge)")

- [x] Throwaway PR created with deliberate HIGH + P1 bugs
- [x] Both reviewers (Claude + connector) posted findings on the throwaway
- [x] Skill invoked with `USER_SUPPLIED_PR_NUMBER=NNN` against the throwaway
- [x] Skill correctly classified as case 2 (≥1 finding)
- [x] Codex verify gated the commit (cycle-1 verify-result.json shows clean exit)
- [x] Connector inline threads received replies + GraphQL resolve mutations
- [x] Pattern files appended in the same commit as the code fix (atomicity)
- [x] All six trailer types well-formed in commit message

Self-test evidence captured in `.harness-github-review/acceptance-evidence/` on this branch (NOT committed — the dir is gitignored). Selected entries reproduced inline below for review.

### Inline evidence

(Paste relevant excerpts from acceptance-evidence files here — e.g., the commit trailer block from one cycle commit, the final thread-state GraphQL response showing `isResolved: true`, etc.)

## Reviewer notes

- The skill's failure modes are loud-fail by design (no silent-empty path). Spec §2.4 documents the 5-case empty-state classification.
- Verify retry budget is ≤3 per cycle. Exceeding = abort + loop exit. Spec §3.5.
- No auto-`git stash`; recovery paths are user-driven. Spec §6.3.
- Pattern entry's `Commit:` field intentionally does NOT contain the in-flight SHA — self-referential, can't be computed pre-commit. Use `git blame`/`git log` to recover. Spec §4.2.

## Out of scope

- Re-enabling the OpenAI Codex Action — billing concern, orthogonal. Single-commit revert if quota restored later.
- `STASH_ON_ABORT=1` opt-in flag — spec §6.2 explicitly defers.
- `/write-retro` skill — referenced as conditional ("if available"); not built here.
EOF
)"
```

- [ ] **Step 3: Verify the PR opened**

```bash
gh pr view --json url --jq .url
```

Capture the URL and report it back.

- [ ] **Step 4: Wait for CI on this PR**

Both reviewers WILL run on this PR (Claude review + connector inline). The Claude reviewer should reach `is_claude_clean` quickly (the change is doc/skill-only). The connector may post inline findings on the SKILL.md content — if so, run `/harness-plugin:github-review` against THIS PR as well to dogfood the new skill.

If the dogfood run lands a clean verdict in 1–2 rounds: ship it.

If the dogfood run aborts or loud-fails: that IS a real bug in the rewrite. Fix on the fix/111 branch, push, repeat.

---

## Self-Review

After writing the complete plan, look at the spec with fresh eyes and check the plan against it.

### Spec coverage check

| Spec section                             | Implementing task                                     |
| ---------------------------------------- | ----------------------------------------------------- |
| §"Problem"                               | (Context only — no task implements problem statement) |
| §"Solution"                              | All tasks                                             |
| §"Decisions"                             | All design decisions reflected in implementation      |
| §"Architecture / Loop flow"              | Task 3 scaffold + Tasks 4–12 fill steps               |
| §"Architecture / File structure"         | Task 1, Task 3                                        |
| §0 "Input resolution"                    | Task 4                                                |
| §1 "State persistence"                   | Task 4 (PR_BASE + extract_trailer)                    |
| §2.1 "Claude reviewer"                   | Task 5                                                |
| §2.2 "Codex connector reviewer"          | Task 6                                                |
| §2.3 "Finding-table aggregation"         | Task 6                                                |
| §2.4 "Empty-state classification"        | Task 7                                                |
| §3.1 "Setup"                             | Task 9                                                |
| §3.2 "Build verify prompt"               | Task 9                                                |
| §3.3 "Call codex exec"                   | Task 9                                                |
| §3.4 "Result classification matrix"      | Task 10                                               |
| §3.5 "Verify retry budget"               | Task 10                                               |
| §3.6 "Docs-only escape"                  | Task 10                                               |
| §3.7 "Abort"                             | Task 10                                               |
| §4.1 "Pattern matching algorithm"        | Task 11                                               |
| §4.2 "Pattern entry append schema"       | Task 11                                               |
| §4.3 "New pattern creation"              | Task 11                                               |
| §4.4 "Index update"                      | Task 11, Task 2 (source labels)                       |
| §4.5 "Failure modes"                     | Task 11                                               |
| §5 "Loop exit & retro prompt"            | Task 12                                               |
| §6.1 "Per-cycle artifact lifecycle"      | Task 12                                               |
| §6.2 "No git stash"                      | Task 12                                               |
| §6.3 "Three recovery paths on abort"     | Task 12                                               |
| §6.4 "Pattern-file rollback is N/A"      | Task 12                                               |
| §6.5 "Watermark trailers are durable"    | Task 12                                               |
| §6.6 "Manual full reset"                 | Task 12                                               |
| §6.7 "Summary: what is NOT auto-cleaned" | Task 12                                               |
| §"Workflow disable & related changes"    | Task 1                                                |
| §"Acceptance gate (pre-merge)"           | Tasks 13–15                                           |
| §"Out of scope"                          | (Reflected in PR body, no task)                       |
| §"Failure modes summary"                 | (Distributed across Tasks 5–12)                       |
| §"Cross-references"                      | (Reference material in spec, no task)                 |

All spec sections have an implementing task. ✓

### Placeholder scan

No "TBD", "TODO", "implement later", "fill in details", or generic "add appropriate error handling" entries in this plan. ✓

### Type consistency

- `Finding` type defined in Task 6, referenced consistently in Tasks 7, 8, 9, 10, 11.
- `cycle_id` (`F1`, `F2`, ...) protocol consistent: Task 6 assigns, Task 9 uses in verify prompt rendering, Task 10's `[UNADDRESSED Fk]` regex matches.
- Trailer keys consistent across Tasks 4, 11, 12: `GitHub-Review-Processed-Claude`, `GitHub-Review-Superseded-Claude`, `GitHub-Review-Processed-Codex-Reviews`, `GitHub-Review-Processed-Codex-Inline`, `Closes-Codex-Threads`, `Pattern-Files-Touched`, `Pattern-Append-Decisions`, `Verify-Deferred-LOW`, `Verify-Skipped`.
- Variable names consistent: `PR_BASE`, `BASE_REF`, `REPO`, `OWNER`, `NAME`, `PR_NUMBER`, `ROUND`, `VERIFY_RETRY_COUNTER`, `FINDINGS_JSON`.
- File paths consistent: `.harness-github-review/cycle-${ROUND}-{diff,verify-prompt,verify-result,verify-events,verify-stderr}.{patch,md,json,log}` and `cycle-${ROUND}-aborted/{staged,unstaged}.patch`, `cycle-${ROUND}-aborted/{status,untracked}.txt`, `cycle-${ROUND}-aborted/incident.md`.

No drift between tasks. ✓

---

---
id: error-surfacing
category: error-handling
created: 2026-04-10
last_updated: 2026-04-29
ref_count: 0
---

# Error Surfacing

## Summary

`void promise` is the silent error swallowing footgun of the codebase. Every
`void editorBuffer.openFile(...)` or `void someAsyncIpc()` discards both the
return value AND any rejection — the user sees zero feedback on Tauri IPC
failures (disk full, permission denied, file missing) and the editor silently
stays in a deceptive state. The fix is always the same shape: wrap in
try/catch, capture the error message, route it to a UI sink (banner, dialog,
toast), and — critically — make sure the UI state is consistent with the
caught error. "Save failed" must mean the buffer is still dirty; "Open
failed" must mean the editor shows the original file, not the requested one.

## Findings

### 1. Direct file open silently swallows Tauri IPC failures

- **Source:** github-claude | PR #38 round 3 | 2026-04-10
- **Severity:** HIGH
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** `handleFileSelect` called `void editorBuffer.openFile(filePath)` for the no-unsaved-changes path. Any `readFile` IPC failure (file deleted, permission denied, disk error) was silently dropped. The editor kept displaying the previous file's content with no error message. The PR's own comment explicitly called out this bug pattern as "fire and forget" — but only fixed it inside `handleDiscard`, leaving this call site unchanged.
- **Fix:** Extract `openFileSafely(filePath)` helper with try/catch that calls `setFileError` on failure. Add a dismissible inline error banner to `WorkspaceView` that surfaces the message.
- **Commit:** `d2a67ed fix: address Claude review round 3 findings`

### 2. Vim `:w` save path silently swallows write errors

- **Source:** github-claude | PR #38 round 3 | 2026-04-10
- **Severity:** HIGH
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** `onSave={() => void editorBuffer.saveFile()}` in the BottomDrawer chain: the `:w` command → `Vim.defineEx` handler → `useCodeMirror.onSave` ref → this callback. If `writeFile` IPC failed (disk full, permissions), the error was dropped. The user saw the editor still open with no error message and could reasonably believe the save succeeded — while their edits had not been persisted.
- **Fix:** Extract `handleVimSave()` async function with try/catch, route errors to `fileError` banner.
- **Commit:** `d2a67ed fix: address Claude review round 3 findings`

### 3. CodeEditor logs load errors to console with `eslint-disable` bypass

- **Source:** github-claude | PR #38 round 3 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src/features/editor/components/CodeEditor.tsx`
- **Finding:** The project's ESLint configuration enforces `no-console: error`. CodeEditor bypassed it with an inline `// eslint-disable-next-line no-console` to call `console.error('Failed to load file:', error)` on a `readFile` rejection. The error was logged to the browser console and swallowed — no UI feedback reached the user. The `eslint-disable` hid the rule violation from CI enforcement, so the bypass shipped silently.
- **Fix:** Remove the `eslint-disable` and propagate the error via an `onLoadError?: (message: string) => void` callback prop. WorkspaceView wires it to `setFileError` so the user sees a banner. Use a ref pattern for the callback identity so its change doesn't re-fire the load effect.
- **Commit:** `d2a67ed fix: address Claude review round 3 findings`

### 4. CodeEditor fallback save path silently swallows `writeFile` errors

- **Source:** github-claude | PR #38 round 4 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src/features/editor/components/CodeEditor.tsx`
- **Finding:** When the `onSave` prop was undefined, CodeEditor fell back to `void fileSystemService.writeFile(loadedFilePath, currentContent)`. The `void` discarded the rejection. In this codepath a `:w` would appear to succeed (no error, editor still open) while the file was never written. Same silent-swallow pattern as above, left behind in a "safety net" branch.
- **Fix:** Remove the fallback entirely. `onSave` is always provided by the only real call site (`BottomDrawer` → `WorkspaceView.handleVimSave`, which already has try/catch). The fallback was dead code that could only hurt.
- **Commit:** `967c25f fix: address Claude review round 4 findings`

### 5. `handleSave` / `handleDiscard` silently swallow errors via `void handleSave()`

- **Source:** github-claude | PR #38 round 2 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** Both handlers were `async` functions, invoked from the dialog prop chain as `() => void handleSave()`. If `saveFile()` or `openFile()` threw, the rejection propagated out of the handler as an unhandled Promise rejection — no user feedback, no error display. `handleSave` also failed to close the dialog on error (the setState calls were after the await), leaving the user in a stuck state with no indication of what went wrong.
- **Fix:** Wrap both handlers in try/catch. Thread a `saveError` prop through `UnsavedChangesDialog` so errors display as an inline alert inside the dialog. On save failure, keep the dialog open for retry. On discard failure, also keep the dialog open (was previously closing prematurely).
- **Commit:** `077c87f fix: address Claude review round 2 findings`

### 6. UnsavedChangesDialog shows destination file as dirty, not the current file

- **Source:** github-claude | PR #38 round 4 | 2026-04-10
- **Severity:** HIGH
- **File:** `src/features/workspace/WorkspaceView.tsx`
- **Finding:** The dialog received `pendingFilePath` (the file the user was switching TO) as its `fileName` prop. The dialog body read "{pendingFilePath} has unsaved changes" — backwards from reality. A user could panic-discard the wrong file or dismiss the dialog as a glitch and lose work on the actually-dirty file. Classic misleading-error-UI pattern.
- **Fix:** Pass `editorBuffer.filePath` (the currently-open dirty file) instead.
- **Commit:** `967c25f fix: address Claude review round 4 findings`

### 7. Missing loading indicator for async file-open IPC

- **Source:** github-claude | PR #38 round 2 | 2026-04-10
- **Severity:** HIGH
- **File:** `src/features/editor/hooks/useEditorBuffer.ts`, `CodeEditor.tsx`
- **Finding:** `useEditorBuffer.openFile` fired an async Tauri IPC `readFile` call with no `isLoading` flag exposed. During the IPC round-trip the editor kept showing the previous file's content (or the "No file selected" placeholder) with zero indication that the click registered. On slow disks or permission-checked reads the UI looked unresponsive. Users might click again, firing duplicate `openFile` calls; the race-guard silently discarded stale responses but the user had no feedback at all.
- **Fix:** Add `isLoading: boolean` to the EditorBuffer interface. Set true before `readFile` await, clear in a `finally` block — but only if the current request is still the latest, so stale responses from earlier calls don't flip it back to false while a newer read is still in flight. Render a glassmorphism loading overlay in CodeEditor with `role="status"` and a spinning progress icon.
- **Commit:** `0c8f0ac fix: address Claude review round 12 findings`

### 8. Bash function exits 0 even when inner command-substitution calls fail

- **Source:** github-claude | PR #112 round 1 | 2026-04-29
- **Severity:** MEDIUM
- **File:** `plugins/harness/skills/github-review/SKILL.md`
- **Finding:** `paginated_review_threads_query` ends with `echo "$result"` — bash propagates the exit code of the last command, so the function always returns 0 regardless of inner `gh api graphql` failures. A failed `page_json=$(gh api graphql ...)` produces empty output; downstream `jq` errors silently to stderr; the loop hits `break` because `has_next` is not `"true"` for empty input — and the function returns `0` with a corrupted thread map. The Step 1 caller's `2>/dev/null || echo "[]"` fallback never fires; Step 2B and 7.1 callers had no fallback at all. Same shape as the `void promise` footgun: silent error swallowing where the caller is expected to detect failures via exit code.
- **Fix:** Add `|| return 1` after each `page_json=$(gh api graphql ...)` assignment so transient GraphQL failures actually propagate. Then loud-fail at every call site: Step 1 keeps its `|| echo "[]"` (best-effort reconciliation); Step 2B and 7.1 promote to `|| { echo "ERROR..."; exit 1; }` because a corrupted thread map there silently misses unresolved threads (Step 7.1 would declare clean exit prematurely) or breaks inline-comment lookup with no diagnostic.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 9. `grep -vxFf` exits 1 on full-match input, aborting under `set -euo pipefail`

- **Source:** github-claude + github-codex-connector | PR #112 round 2 | 2026-04-29
- **Severity:** HIGH (claude) / P1 / HIGH (connector)
- **File:** `plugins/harness/skills/github-review/references/commit-trailers.md`
- **Finding:** The Step 1 reconciliation block subtracts stale IDs from three processed-set variables using pipelines ending `grep -vxFf <(...)`. The exit-code contract for `grep -v` is 1 when every input line is suppressed (no surviving lines). Sourcing `helpers.sh` activates `set -euo pipefail` in the caller's shell, so this exit propagates through the command substitution and aborts the script — exactly in the scenario reconciliation guards against (push succeeded but reply/resolve failed; ALL processed IDs are stale and need clearing). Both reviewers found the same root cause; the connector finding cites L97 specifically, the claude finding generalizes to L95-125. An identical risk pattern: `diff` returning 1 for differences, `cmp` returning non-zero for mismatch — any tool whose exit code encodes "found nothing" rather than "actual error" breaks under strict mode.
- **Fix:** Replaced all three `grep -vxFf` pipelines with awk-based set-difference: build the stale set in awk's `BEGIN { split(stale, a, /,/); for (i...) s[a[i]] = 1 }`, then filter `NF && !($0 in s) { print }`. awk handles empty input cleanly and never returns non-zero for "no matches." Also took the opportunity to remove the `set -euo pipefail` side-effect when `helpers.sh` is sourced (guard with `[ "${BASH_SOURCE[0]}" = "${0}" ]`), so future shell idioms with non-fatal non-zero exits don't get unexpectedly weaponized.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 10. helpers.sh `set -euo pipefail` propagates strict mode into the caller when sourced

- **Source:** github-claude | PR #112 round 2 | 2026-04-29
- **Severity:** LOW
- **File:** `plugins/harness/skills/github-review/scripts/helpers.sh`
- **Finding:** `helpers.sh` calls `set -euo pipefail` unconditionally at top level. Sourcing the file (per SKILL.md Bootstrap) propagates strict mode into the calling skill session. Commands that legitimately exit non-zero — `grep` with no matches, `diff` finding differences — then abort the skill mid-run with no diagnostic. The `grep -vxFf` regression in Finding 9 is a direct consequence.
- **Fix:** Guard the `set -euo pipefail` line with `if [ "${BASH_SOURCE[0]}" = "${0}" ]; then ... fi` so strict mode applies only on direct execution, not on source. Internal helper functions already use `|| return 1` on their `gh api` calls, so failures still propagate to callers via exit code.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 11. Bootstrap script-path derivation breaks under interactive-shell `$0`

- **Source:** github-codex-connector | PR #112 round 2 | 2026-04-29
- **Severity:** P1 / HIGH
- **File:** `plugins/harness/skills/github-review/SKILL.md`
- **Finding:** `SCRIPT_DIR="$(dirname "$(realpath "$0")")"` resolves to `/usr/bin/bash` (or similar) when SKILL.md is invoked from an interactive shell — `$0` is the shell name, not the SKILL.md path. The subsequent `source "$SCRIPT_DIR/scripts/helpers.sh"` then fails with file-not-found; every later step that depends on the helpers (`paginated_review_threads_query`, `extract_trailer`) silently uses an unbound name and produces empty results. The skill silently miscounts findings, miscomputes processed sets, or aborts further down with a misleading error.
- **Fix:** Hard-code the repo-relative path with a git-toplevel fallback: `SKILL_DIR="plugins/harness/skills/github-review"; [ -d "$SKILL_DIR" ] || SKILL_DIR="$(git rev-parse --show-toplevel)/plugins/harness/skills/github-review"`. Explicit precondition check on `helpers.sh` existence with a clear error message. Documented "must be invoked from repo root" assumption in the orchestrator preamble. The skill always runs from the repo root (Claude Code's plugin runner CWD) so the relative path is reliable.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 12. Skill-authored replies re-classified as new human findings on next cycle

- **Source:** github-codex-connector | PR #112 round 2 | 2026-04-29
- **Severity:** P1 / HIGH
- **File:** `plugins/harness/skills/github-review/references/parsing.md`
- **Finding:** Step 2D filters human findings by `user.type == "User"`. But the skill itself authenticates as a human GitHub user (the gh CLI's auth) — its Step 6.8 replies show up as user-authored comments on later cycles. Without a body-content exclusion, the next cycle re-classifies its own replies as new "human findings" and either tries to fix them (creating self-referential loops) or burns processed-set capacity on its own outputs. Same loop-amplification family as the `LATEST_CLAUDE_ID` regression in cycle 1 finding 11.
- **Fix:** Extended the Step 2D human-comment poll filter (both issue-level and inline) with `((.body // "") | contains("(github-review cycle ") | not)`. Every Step 6.8 reply emits the marker `(github-review cycle <N>, finding F<K>)` as a stable footer; this `contains` check excludes any comment whose body carries that marker, regardless of cycle / finding ID. Added rationale comment in parsing.md and cross-referenced the marker invariant in commit-trailers.md § Step 6.8.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 13. GraphQL HTTP-200 error envelopes silently bypass `gh api graphql || return 1` guards

- **Source:** github-claude | PR #112 round 3 | 2026-04-29
- **Severity:** HIGH
- **File:** `plugins/harness/skills/github-review/scripts/helpers.sh`
- **Finding:** `paginated_review_threads_query` issued two `gh api graphql` calls (no-cursor + cursor variants) each terminated with `|| return 1`. The guard catches subprocess exit-code failures but NOT the case where `gh` exits 0 while the response body is `{"errors": [...], "data": null}` — GitHub's HTTP-200-with-errors envelope for auth issues, rate-limit exhaustion, malformed queries, or stale node IDs. Without an explicit errors check, jq silently traverses null paths: `.data.repository.pullRequest.reviewThreads.nodes` is empty, the accumulated array stays `[]`, `hasNextPage` evaluates to `"null"` (not `"true"`), the loop breaks, the function returns 0 with empty data. Step 7.1's `UNRESOLVED_*_THREADS == 0` check then satisfies the all-clean exit while real unresolved threads exist on GitHub — a false clean-exit. Same bug class infected the SKILL.md § 6.9 `resolveReviewThread` mutation (would silently mark a thread "resolved" in the trailer when GitHub didn't actually resolve it). Same silent-failure family as cycle 2's awk set-difference fix and finding #8 in this pattern (bash exits 0 even when inner command-substitution fails).
- **Fix:** Added `_assert_graphql_response_ok` helper to `helpers.sh` that validates two invariants on every GraphQL response — `(a)` no non-empty `errors` array, `(b)` the caller-specified `.data...` path exists and is non-null. Applied after each `gh api graphql` call in `paginated_review_threads_query` (both no-cursor and cursor branches). Updated SKILL.md § 6.9 example to capture the resolveReviewThread response, run it through `_assert_graphql_response_ok`, and `continue` (skip the thread, don't mark it resolved) on validation failure. Documented the GraphQL response invariant in a comment block above `paginated_review_threads_query`.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

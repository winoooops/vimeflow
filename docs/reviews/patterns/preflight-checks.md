---
id: preflight-checks
category: error-handling
created: 2026-04-20
last_updated: 2026-06-06
ref_count: 2
---

# Preflight Checks

## Summary

Before allocating state, spawning processes, or printing startup banners, verify the environment actually supports what the code is about to do. When a refactor **removes** a check, audit what that check was catching — a cryptic runtime failure deep inside a subprocess call is worse than an immediate "Error: X not found" at entry.

## Findings

### 1. Removing the API-key check left no "claude CLI on PATH" check behind

- **Source:** claude-review | PR #73 | 2026-04-20 (round 10)
- **Severity:** LOW
- **File:** `harness/autonomous_agent_demo.py`
- **Finding:** The CLI-default refactor dropped `ANTHROPIC_API_KEY` validation from `preflight_checks()` (correct — the CLI backend doesn't need it). But nothing replaced it: a developer without the `claude` CLI installed would pass preflight, see startup banners, and hit a cryptic `FileNotFoundError: 'claude'` from `asyncio.create_subprocess_exec` deep into the first session spawn. The old behavior surfaced the problem immediately.
- **Fix:** `shutil.which("claude")` gate at the top of `preflight_checks` when `client_kind == "cli"`. Error message points to the install command + `claude /login`, and offers `--client sdk` as the fallback escape.
- **Commit:** (round 10)

## How to apply

When adding / removing / refactoring preflight checks:

1. **What did the removed check catch?** If it caught "the harness can't work without X", you need a replacement check for the new "X" under the new architecture — not just silently deletion.
2. **Check entry points, not call sites.** `shutil.which("tool")`, env var presence, auth token files — verify at `main()` / `preflight_checks()`, not on first use inside a subprocess.
3. **Offer the escape hatch in the error message.** "Install X" is fine, but "or pass `--client sdk` to use the legacy backend" closes the decision loop for the user who wants to move forward without installing.

### 2. Expensive paginated APIs called before cheap early-exit checks

- **Source:** github-claude | PR #320 round 1 | 2026-05-31
- **Severity:** MEDIUM
- **File:** `scripts/qa-runner/watch.js`
- **Finding:** `computeState()\'s` two most expensive calls — `unresolvedThreads()` (paginated GraphQL) and `claudeVerdictClean()` (paginated REST) — ran before the CI fail / Claude pending early-exits, wasting API quota on PRs that would exit cheaply.
- **Fix:** Deferred both expensive calls until inside the `else` branch after all cheap guard checks pass.
- **Commit:** same commit as this entry

### 3. Require a positive-pass gate instead of enumerating blocked states

- **Source:** github-codex-connector | PR #320 round 1 | 2026-05-31
- **Severity:** P1 / HIGH
- **File:** `scripts/qa-runner/watch.js`
- **Finding:** `computeState()` enumerated negative states (missing, pending, fail) to block on Claude check status, but `skipping` and `cancel` buckets bypassed the gate. An old clean Claude comment could still let the PR reach `GOOD_SHAPE` and auto-merge without a fresh review.
- **Fix:** Replaced negative-state enumeration with a single positive gate `claudeReady = claudeCheck?.bucket === 'pass'`; block on `!claudeReady` so any non-pass state (including skipped/cancelled) waits.
- **Commit:** same commit as this entry

### 4. Zero concurrency limit disables fixer dispatch without warning

- **Source:** github-codex-connector | PR #331 round 1 | 2026-06-02
- **Severity:** P2 / MEDIUM
- **File:** `scripts/qa-runner/watch.js`
- **Finding:** `numericOption(val('max'), MAX_PARALLEL)` correctly preserves `0` as a parsed number (unlike the previous `Number(...) || fallback` which fell back for `0`). However, the bounded-concurrency `pool()` uses `Math.min(limit, items.length)` workers; with `limit = 0` it starts none. A user passing `--max 0` intending to throttle or test would silently block all `NEEDS_FIX` dispatches, and the tick would exit cleanly with no work done and no error surfaced.
- **Fix:** Clamped `maxParallel` to at least 1 via `Math.max(1, numericOption(val('max'), MAX_PARALLEL))`. This restores the prior behavior where `0` falls back to `MAX_PARALLEL`, while still allowing `--max-ci-reruns 0` where zero is semantically intentional.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 5. JSON-parsed env var used without type guard causes opaque TypeError

- **Source:** github-claude | PR #349 round 3 | 2026-06-05
- **Severity:** MEDIUM
- **File:** `scripts/qa-runner/lib/cloud-dispatch.js`
- **Finding:** `dispatchConfig` returned `JSON.parse(env.QA_WORKER_SSH_OPTIONS_JSON)` directly, while `sshDispatchPlan` later spread `sshOptions` into an array. Valid but non-array JSON (`null`, `{}`, `42`) crashed dispatch with `TypeError: sshOptions is not iterable` — an opaque error that gave no hint the env var was malformed.
- **Fix:** Added an `Array.isArray` check immediately after `JSON.parse`. Non-array values now throw `QA_WORKER_SSH_OPTIONS_JSON must be a JSON array` at config time, before any SSH spawn attempt. Added unit tests for array, object, null, and scalar JSON inputs.
- **Commit:** same commit as this entry

### 6. Spot bootstrap installs mutable upstream packages and Lifeline as root

- **Source:** github-claude | PR #362 round 3 | 2026-06-06
- **Severity:** MEDIUM
- **File:** `scripts/qa-runner/deploy/worker-spot-user-data.sh`
- **Finding:** The bootstrap installed `@openai/codex` and `@moonshot-ai/kimi-code` without version pins and cloned Lifeline from the default branch. Because the script runs as root before worker credentials materialize, any upstream malicious or breaking release could compromise or break the runner fleet without any repository change.
- **Fix:** Added required env vars `QA_CODEX_VERSION`, `QA_KIMI_CODE_VERSION`, and `QA_LIFELINE_REF`. The script now validates exact semver for npm packages and a full 40-character commit SHA for Lifeline, failing fast when production values are missing or mutable. Lifeline is fetched via `git init` + `fetch --depth=1` + `checkout FETCH_HEAD` so SHA pins actually resolve.
- **Commit:** cycle 3

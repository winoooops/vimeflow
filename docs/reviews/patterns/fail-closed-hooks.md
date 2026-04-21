---
id: fail-closed-hooks
category: security
created: 2026-04-20
last_updated: 2026-04-20
ref_count: 0
---

# Fail-Closed Security Hooks

## Summary

Security hooks that are invoked as out-of-process subprocesses (e.g. Claude
Code's `settings.json` `PreToolUse` hooks) must fail CLOSED on every possible
error path — including ones that happen before the hook's business logic
runs. The CLI treats "no decision JSON on stdout" as ALLOW, so any error that
short-circuits the hook silently bypasses the allowlist.

Rules:

- Every error path must emit a `{"decision": "block", "reason": "..."}` JSON
  object to stdout and exit 0.
- The try/except must cover: the hook body, module-level imports, JSON
  parsing of stdin, argv validation, even dispatch-by-kind lookup failures.
- Never let an uncaught exception propagate out of the hook process.

## Findings

### 1. Hook body exceptions fell through to CLI-default-allow

- **Source:** claude-review | PR #73 | 2026-04-20 (round 3)
- **Severity:** HIGH
- **File:** `harness/hook_runner.py`
- **Finding:** `main()` called `asyncio.run(hook(payload))` without a guard.
  If `bash_security_hook` raised (policy judge timeout, bad payload, import
  error inside the hook), the exception propagated, nothing was printed, and
  Claude CLI defaulted to allow — silently disabling the allowlist.
- **Fix:** Wrap the hook call in try/except that emits an explicit block with
  the exception type + message.
- **Commit:** `0363ac7 fix(harness): address round-3 review — fail-closed hook_runner + 3 more`

### 2. Module-level import errors bypassed the try/except entirely

- **Source:** claude-review | PR #73 | 2026-04-20 (round 5)
- **Severity:** MEDIUM
- **File:** `harness/hook_runner.py`
- **Finding:** The runtime try/except from finding 1 only covered `main()`.
  Top-level `from security import bash_security_hook` was outside it — a
  corrupted `.pyc`, missing dep, or transient ImportError would crash the
  process before `main()` ran. Same silent-allow outcome.
- **Fix:** Wrap top-level imports in their own try/except that emits a block
  decision and exits 0. Now fail-closed covers both import-time and
  runtime paths.
- **Commit:** `be7f9b3 fix(harness): round-5 review — hook_runner import fail-closed + stale docs`

## How to apply

When building any subprocess-based security hook for a CLI tool that uses
"hook emits JSON or falls back to allow":

1. **Import with a guard.** Every top-level import of modules that could fail
   (bad patch, missing dep, ImportError) gets wrapped in try/except at module
   top.
2. **Dispatch with a guard.** Every branch in `main()` that could raise —
   argv parsing, JSON decoding, kind lookup, hook invocation — gets a
   fail-closed emission.
3. **Never skip the JSON emit.** If you `return` / `exit` without printing,
   the CLI treats it as no-hook-said-anything → allow.
4. **Regression tests.** Have at least two live tests that verify the runner
   still emits a block decision when (a) the hook function raises, (b) the
   hook module itself fails to import. The import-failure test must cover
   the real `sys.path.insert(0, HARNESS_DIR)` code path (copy the runner to a
   scratch dir with a broken sibling module; don't rely on `PYTHONPATH`).

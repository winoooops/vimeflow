---
id: preflight-checks
category: error-handling
created: 2026-04-20
last_updated: 2026-04-20
ref_count: 0
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

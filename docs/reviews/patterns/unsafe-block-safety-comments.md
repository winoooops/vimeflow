---
id: unsafe-block-safety-comments
category: security
created: 2026-06-14
last_updated: 2026-06-14
ref_count: 0
---

# Unsafe Block Safety Comments

## Summary

Every `unsafe` block in Rust must carry a `// SAFETY:` comment that explains
why the block is sound for the specific call site. The comment is not a
formality: it documents the invariant that makes the `unsafe` operation safe,
which prevents future edits from widening the block, copying it into an
inappropriate context, or treating a mechanical FFI call as risk-free just
because it has no user-facing pointer arguments.

Even when the underlying operation is effectively infallible (for example,
reading a kernel constant through `libc::sysconf`), the `// SAFETY:` annotation
must state what assumptions hold and how the return value is validated.

## Findings

### 1. unsafe sysconf call lacks required SAFETY annotation

- **Source:** github-claude | PR #447 round 4 | 2026-06-14
- **Severity:** LOW
- **File:** `crates/backend/src/agent/adapter/kimi/locator.rs` L469-L478
- **Finding:** `clock_ticks_per_sec` called `libc::sysconf(libc::_SC_CLK_TCK)` inside an `unsafe` block with no `// SAFETY:` comment. The repository's Rust security rule requires every `unsafe` block to document why it is sound; omitting the comment creates audit debt and invites future regressions.
- **Fix:** Added a `// SAFETY:` comment immediately above the call explaining that `_SC_CLK_TCK` takes no pointers and that the return value is checked before use.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

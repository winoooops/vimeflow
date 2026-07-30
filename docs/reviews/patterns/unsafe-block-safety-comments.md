---
id: unsafe-block-safety-comments
category: security
created: 2026-06-14
last_updated: 2026-07-30
ref_count: 3
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

### 2. fd transport unsafe blocks lacked local SAFETY comments

- **Source:** github-claude | PR #761 round 6 | 2026-07-30
- **Severity:** LOW
- **File:** `crates/backend/src/terminal/fd_transport.rs`
- **Finding:** Several `unsafe` operations in the PTY fd transport had no adjacent `// SAFETY:` explanation even though the file otherwise documented every FFI call site. The missing comments made future audit of the SCM_RIGHTS buffer and `msghdr` invariants harder.
- **Fix:** Added targeted `// SAFETY:` comments for `CMSG_SPACE`, `msghdr` zero-initialization, plain datagram test writes, and the new multi-fd regression test's custom `sendmsg` construction.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 3. fd transport unsafe helper lacked Safety contract

- **Source:** github-claude | PR #761 round 7 | 2026-07-30
- **Severity:** LOW
- **File:** `crates/backend/src/terminal/fd_transport.rs` L302-L321
- **Finding:** `close_rights_cmsg_fds` was declared `unsafe fn` and walked a raw `cmsghdr` pointer without documenting the caller-side invariant for the pointer and kernel-written control buffer.
- **Fix:** Added a `# Safety` section documenting that callers must pass a non-null `cmsghdr` from the current `recvmsg` control buffer and that `cmsg_len` describes initialized kernel data.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

---
id: ffi-buffer-alignment
category: security
created: 2026-07-29
last_updated: 2026-07-29
ref_count: 1
---

# FFI Buffer Alignment

## Summary

Raw byte arrays are only byte-aligned, even when they are large enough for a C
control structure. Passing their pointers to libc helpers that cast and
dereference stronger-aligned structs can make otherwise small FFI wrappers
undefined behavior. Ancillary buffers, ioctl structs, and other C-owned storage
should use wrapper types whose allocation alignment is at least the alignment of
the C type that will be read from or written into that memory.

## Findings

### 1. SCM_RIGHTS ancillary buffers were not cmsghdr-aligned

- **Source:** github-codex-connector | PR #752 round 1 | 2026-07-29
- **Severity:** P1 / HIGH
- **File:** `crates/backend/src/terminal/fd_transport.rs` L75
- **Finding:** `send_fd` and `recv_fd` allocated `[u8; 64]` ancillary control
  buffers, then passed them to `CMSG_FIRSTHDR`/`CMSG_NXTHDR` paths that
  dereference `libc::cmsghdr`. The byte arrays had enough capacity but only
  byte alignment, so those dereferences could be undefined behavior.
- **Fix:** Replaced the raw arrays with a `repr(C)` `ControlMessageBuffer`
  wrapper whose zero-length `libc::cmsghdr` field raises the allocation
  alignment, and added a regression test for the alignment invariant.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 2. Native parent SCM_RIGHTS receive buffer was not cmsghdr-aligned

- **Source:** github-codex-connector | PR #754 round 1 | 2026-07-29
- **Severity:** P1 / HIGH
- **File:** `native/ghostty-parent/ghostty_native_parent.cc`
- **Finding:** The native parent received PTY fds into a raw `char` ancillary
  control buffer, then passed it through `CMSG_FIRSTHDR`/`CMSG_NXTHDR`, which
  dereference `cmsghdr` and require suitable alignment.
- **Fix:** Replaced the raw array with a union containing a `cmsghdr` member and
  the byte storage, so the control buffer has at least `cmsghdr` alignment
  before the CMSG macros read it.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

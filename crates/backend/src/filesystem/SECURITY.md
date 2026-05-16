# Vimeflow Filesystem Sandbox — Security Model

> **Read this before modifying anything in `src-tauri/src/filesystem/`.**
> The code here is a security boundary, not ordinary glue code. This
> document is the threat model, enforcement contract, and deferred-work
> log for the entire module.

## Purpose

This module is the Tauri IPC boundary for all filesystem access. Any
code that reads or writes user files from the frontend webview MUST go
through one of the three commands in this directory (`list_dir`,
`read_file`, `write_file`). No other module in `src-tauri` should open
files on behalf of the webview.

## Threat Model

### In scope

- **Adversary:** a compromised sibling process in the same user session
  — for example a buggy coding agent spawned by the app, a malicious
  transitive dependency loaded by the frontend, or a script run by an
  agent that has access to the user's account.
- **Goal of enforcement:** confine filesystem reads and writes to paths
  rooted at `$HOME`, even in the presence of symlinks, `..` segments,
  TOCTOU races, and intermediate-path replacement.
- **Trust boundary:** the canonical path of `$HOME` at process start.
  Anything resolving outside that subtree is rejected.

### Out of scope

- Multi-user hardening. Vimeflow is a single-user desktop app.
- Confused-deputy attacks from a different OS user.
- Kernel-level attacks, `ptrace`, or `/proc/<pid>/mem` tampering.
- Denial of service via very large files or very deep directory trees.
- Information leakage via filesystem metadata (mtime, size, inode).

## Enforcement Primitives

All primitives live in `scope.rs`. Keep them there — if a helper gets
inlined into `list.rs` / `read.rs` / `write.rs` the files will silently
diverge on the next review round (see finding #9 in the review
knowledge base for the exact way this already happened once).

| Primitive                                          | Where      | What it prevents                                                                                                 |
| -------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| `reject_parent_refs`                               | `scope.rs` | Lexical `..` in user input                                                                                       |
| `home_canonical`                                   | `scope.rs` | Stale `$HOME` resolution                                                                                         |
| `ensure_within_home`                               | `scope.rs` | Containment check after canonicalization                                                                         |
| `canonicalize_within_home`                         | `scope.rs` | Walk-up + per-segment mkdir loop; symlink escapes on existing or racing segments                                 |
| `open_nofollow`                                    | `scope.rs` | Symlink races on the leaf; Unix `O_NOFOLLOW` + Windows `FILE_FLAG_OPEN_REPARSE_POINT` + post-open metadata check |
| Atomic temp-file + rename                          | `write.rs` | Partial writes, mid-write replacement                                                                            |
| `WRITE_FILE_TMP_COUNTER` (per-process `AtomicU64`) | `write.rs` | Temp-file name collisions under concurrency                                                                      |

## Test Coverage Map

Each primitive has a regression test. Reviewers cross-reference this
map before approving changes to the module.

| Primitive                               | Tests                                                                                                                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reject_parent_refs`                    | `scope_tests::rejects_parent_refs_basic`, `write_tests::write_file_rejects_traversal_into_sibling_of_home`                                                                                           |
| `canonicalize_within_home` (happy path) | `scope_tests::canonicalize_within_home_resolves_nested_nonexistent`, `write_tests::write_file_creates_parent_dirs`                                                                                   |
| `canonicalize_within_home` (rejection)  | `scope_tests::canonicalize_within_home_rejects_escape`, `write_tests::write_file_rejects_path_outside_home`, `write_tests::write_file_refuses_intermediate_symlink_escape`                           |
| `ensure_within_home`                    | `list_tests::list_dir_*`, `read_tests::read_file_rejects_path_outside_home`                                                                                                                          |
| `open_nofollow` (Unix)                  | `read_tests::read_file_refuses_to_follow_symlink_escaping_home`, `write_tests::write_file_refuses_to_follow_symlink_escaping_home`, `write_tests::write_file_refuses_symlink_even_to_in_home_target` |
| `open_nofollow` (Windows)               | Currently uncovered — Windows CI is not yet running these tests. Tracked in follow-up (see Deferred Work below).                                                                                     |
| Atomic write + counter                  | `write_tests::write_file_creates_file`, `write_tests::write_file_overwrites_existing`                                                                                                                |

### Findings map

Every review finding from PR #38 (catalogued in
`docs/reviews/patterns/filesystem-scope.md`) is guarded by at least
one test above. Do not remove or rename a test in this module without
also updating the regression map in the review knowledge base.

## Defense Layers

The backend sandbox is not the only line of defense. The frontend file
explorer (`src/features/files/hooks/useFileTree.ts`) clamps `navigateUp`
at the home boundary so the UI never asks the backend to read above
`$HOME`. The backend enforces the sandbox; the frontend prevents the
attempt. Both layers must hold; neither is sufficient alone.

## Invariants

The module guarantees to callers:

1. No command opens, reads, or writes a path that resolves outside
   `$HOME`.
2. Write commands are atomic at the filesystem level — readers see
   either the old contents or the new, never a partial write.
3. Commands never follow a symlink on the leaf segment.
4. `..` in user input is rejected before any filesystem syscall.
5. The three `#[tauri::command]` entry points never invoke `unsafe`
   Rust.

## Deferred Work

### Workspace crate extraction (issue #40, task 3)

**Status:** Deferred.

**Rationale:** Currently only `src-tauri` consumes this module.
Workspace-crate ceremony (nested `Cargo.toml`, path deps,
workspace-level lints, doubled CI steps) has no payoff with a single
consumer. The ~500 LOC of production code does not warrant a separate
compile unit today.

**Revisit when any of the following becomes true:**

- A second binary (CLI, fuzz harness, test fixture) needs filesystem
  access.
- The module grows beyond ~1500 LOC of production code.
- We commit to `cargo fuzz` (see below) — fuzz harnesses live more
  naturally against a dedicated crate.
- A CVE in this module prompts a desire to version and changelog it
  independently of the Tauri app.

### Fuzz testing (issue #40, task 5)

**Status:** Deferred.

**Rationale:** `cargo fuzz` requires nightly Rust and adds CI
complexity. Hand-written regression tests cover all currently-known
attack classes. Fuzz pays off _after_ the module split — fuzzing
`write.rs` in isolation yields higher signal than fuzzing a
mixed-concerns file. Fuzz findings deserve their own PR narrative
(one finding per commit) rather than being buried in a refactor.

**Revisit when either of the following becomes true:**

- A CVE or near-miss surfaces in the write path.
- New surface area is added (`move_file`, `delete_file`,
  symlink creation, chmod).

### Windows CI coverage

**Status:** Deferred but flagged.

**Rationale:** The Windows arm of `open_nofollow` is not currently
exercised by CI. The Unix regression tests cover the logical behavior,
and the Windows code path is a mechanical mirror, but a Windows CI
runner would catch subtle drift (e.g. the post-open metadata check
getting skipped).

**Revisit when:** the project gains a Windows CI runner, OR when the
Windows code path changes.

## Review Checklist

For reviewers touching this module, run through each item:

- [ ] Does the change introduce a new filesystem syscall? If so, which
      primitive in `scope.rs` enforces the sandbox boundary for it?
- [ ] Is the change covered by a test in the matching
      `tests/<area>_tests.rs` file?
- [ ] If a new primitive was added, is it in the Enforcement
      Primitives table and the Test Coverage Map above?
- [ ] If deferred work was addressed, was it removed from the
      Deferred Work section?
- [ ] Does the change rename any test? If so, update
      `docs/reviews/patterns/filesystem-scope.md` so the regression
      map stays in sync.

## References

- Review knowledge base: `docs/reviews/patterns/filesystem-scope.md`
  (14 findings from 15 rounds of review on PR #38)
- Design spec: `docs/superpowers/specs/2026-04-10-filesystem-module-refactor-design.md`
- Issue: [winoooops/vimeflow#40](https://github.com/winoooops/vimeflow/issues/40)
- PR #38 review history: the commits with messages starting
  `fix: address Claude review round N` are the raw audit trail this
  document crystallizes.

# Filesystem Module Refactor — Design

**Issue:** [winoooops/vimeflow#40](https://github.com/winoooops/vimeflow/issues/40)
**Status:** Design approved, ready for implementation plan
**Date:** 2026-04-10

## Overview

`src-tauri/src/filesystem/commands.rs` has grown to **864 lines** (49 over the 800-line CLAUDE.md guideline) through 15 rounds of code-review hardening on PR #38. The file now mixes ~480 lines of production IPC handlers with ~380 lines of regression tests, and the production code itself bundles three command handlers (`list_dir`, `read_file`, `write_file`) plus their shared sandbox-enforcement primitives into one file.

This refactor splits the module along responsibility lines so each file has a single, testable purpose. The fifteen security findings landed during PR #38 stay protected by the same regression tests, and a new `SECURITY.md` captures the threat model that has so far been scattered across review comments.

**This is a refactor, not a feature.** No production behavior changes. No new commands. No public API changes (same `#[tauri::command]` exports, same signatures).

## Tech Stack

- **Backend:** Rust, Tauri 2 (`#[tauri::command]` IPC handlers)
- **Testing:** `cargo test` with std-lib `tempfile`-style helpers (existing pattern)
- **Lints:** `cargo clippy -- -D warnings`, `cargo fmt --check`
- **Verification:** `npm run dev` smoke test before merge

## Scope

### In scope (this PR)

1. **Test extraction** — Move the `#[cfg(test)]` block out of `commands.rs` into a `tests/` sub-module with one file per area.
2. **Module split** — Split production code into `list.rs`, `read.rs`, `write.rs`, and `scope.rs` (shared primitives).
3. **`SECURITY.md`** — Add `src-tauri/src/filesystem/SECURITY.md` documenting the threat model, enforcement primitives, test coverage map, and deferred-work log.
4. **`mod.rs` doc comment** — Short `//!` brief at the top of `mod.rs` pointing reviewers to `SECURITY.md`.

### Out of scope (deferred with documented rationale in `SECURITY.md`)

5. **Workspace crate extraction (`crates/vimeflow-fs/`)** — Deferred. Single consumer (`src-tauri`), ~500 LOC of production code, no release pressure. Workspace ceremony has no current payoff. Revisit triggers documented in `SECURITY.md` § Deferred Work.
6. **`cargo fuzz` harness for the write path** — Deferred. Nightly-only tooling adds CI complexity; fuzz pays off _after_ the module split (higher signal against `write.rs` in isolation than against an 864-line mixed file). Fuzz findings deserve their own PR narrative. Revisit triggers documented in `SECURITY.md` § Deferred Work.

### Explicitly excluded

- Any frontend changes (CodeMirror editor, vim mode, file explorer, `useFileTree.ts`).
- New Tauri commands (`move_file`, `delete_file`, `rename_file`, etc.). File these as separate features after this refactor lands.
- Behavior changes to existing commands. The 15 security findings from PR #38 stay protected by their existing regression tests.

## Module Layout

```
src-tauri/src/filesystem/
├── mod.rs              # Public re-exports + //! threat model brief + pointer to SECURITY.md
├── SECURITY.md         # Full threat model, enforcement table, deferred-work log
├── types.rs            # (unchanged) FileEntry, FileType, etc.
├── scope.rs            # NEW — home-dir scope enforcement primitives
├── list.rs             # NEW — list_dir command
├── read.rs             # NEW — read_file command
├── write.rs            # NEW — write_file command (atomic rename, symlink guards)
└── tests/              # NEW — co-located tests, one file per module
    ├── mod.rs          # #[cfg(test)] mod declarations
    ├── scope_tests.rs
    ├── list_tests.rs
    ├── read_tests.rs
    └── write_tests.rs
```

### Key design decision: `scope.rs` as the shared primitive

Both `read.rs` and `write.rs` need the same set of sandbox helpers:

- `expand_home(path)` — resolve `~` prefix
- `reject_parent_refs(path)` — reject `..` segments before canonicalization
- `canonicalize_within_home(path)` — walk-up-ancestor canonicalization that tolerates non-existent leaves (so `write_file` can create new files), with per-segment `mkdir` + canonicalize loop
- `ensure_within_home(canonical)` — final `$HOME` containment check
- `open_nofollow(path)` — `O_NOFOLLOW` (Unix) / `FILE_FLAG_OPEN_REPARSE_POINT` + post-open metadata check (Windows)

These live in `scope.rs` as `pub(super) fn` helpers. `list.rs`, `read.rs`, and `write.rs` import them. **This is the load-bearing design choice:** if `scope.rs` is right, the three command files become thin orchestrators (~80-120 lines each). If `scope.rs` is wrong, every command file leaks scope-check logic and the refactor fails.

### Test directory pattern

Rust's two test conventions are:

- (a) Inline `#[cfg(test)] mod tests { }` at the bottom of each production file
- (b) A `tests/` sub-module with separate files

Going with **(b)** because the issue specifically calls out "~380 lines of tests." Inline `#[cfg(test)]` blocks would just recreate the 800-line-file problem one level down. The `tests/mod.rs` is a single file that declares the children as `#[cfg(test)] mod scope_tests;` etc. — zero runtime cost, conditional compilation as normal.

### File size estimates

| File           | Estimated lines                            |
| -------------- | ------------------------------------------ |
| `mod.rs`       | ~60 (re-exports + doc comment)             |
| `scope.rs`     | ~180 (5 helpers + their tight invariants)  |
| `list.rs`      | ~80                                        |
| `read.rs`      | ~100                                       |
| `write.rs`     | ~180 (atomic rename logic is the heaviest) |
| Each test file | 60-120                                     |

All under the 800-line guideline; most comfortably under 200.

## `SECURITY.md` Outline

Full structure of `src-tauri/src/filesystem/SECURITY.md` (~120-150 lines total):

```markdown
# Vimeflow Filesystem Sandbox — Security Model

## Purpose

One paragraph: this module is the sandbox boundary for all Tauri
filesystem IPC. Any code that reads or writes user files MUST go
through these commands. Reviewers touching this directory should read
this document first.

## Threat Model

### In scope

- **Adversary:** a compromised sibling process in the same user
  session (e.g. a buggy coding agent, a malicious dependency loaded
  by the frontend, a script spawned by an agent).
- **Goal of enforcement:** confine filesystem reads and writes to
  paths rooted at `$HOME`, even in the presence of symlinks,
  `..` segments, TOCTOU races, and intermediate-path replacement.
- **Trust boundary:** `$HOME` canonical path at process start.
  Anything resolving outside that subtree is rejected.

### Out of scope

- Multi-user hardening (single-user desktop app).
- Confused-deputy attacks from a different OS user.
- Kernel-level attacks, ptrace, or `/proc/<pid>/mem` tampering.
- Denial of service via large files or deep directories.
- Information leakage via filesystem metadata (mtime, size).

## Enforcement Primitives

| Primitive                                     | Where                  | What it prevents                                |
| --------------------------------------------- | ---------------------- | ----------------------------------------------- |
| `reject_parent_refs`                          | `scope.rs`             | Lexical `..` in user input                      |
| `canonicalize_within_home`                    | `scope.rs`             | Symlink escapes on existing path segments       |
| `ensure_within_home`                          | `scope.rs`             | Final containment check after resolution        |
| `O_NOFOLLOW` / `FILE_FLAG_OPEN_REPARSE_POINT` | `scope::open_nofollow` | Symlink races on the leaf                       |
| Per-segment canonicalization                  | `scope.rs`             | Intermediate-segment symlink races during write |
| Atomic temp-file + rename                     | `write.rs`             | Partial writes, mid-write replacement           |
| Per-process `AtomicU64` counter               | `write.rs`             | Temp-file name collisions under concurrency     |

## Test Coverage Map

Mapping each primitive above to the test file(s) that exercise it.
Reviewers cross-reference before approving changes.

| Primitive                         | Tests                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| `reject_parent_refs`              | `scope_tests.rs::rejects_parent_refs_*`                                                       |
| `canonicalize_within_home`        | `scope_tests.rs::canonicalize_*`, `write_tests.rs::intermediate_symlink_*`                    |
| `open_nofollow`                   | `scope_tests.rs::open_nofollow_*` (unix + windows)                                            |
| Per-segment mkdir                 | `scope_tests.rs::per_segment_mkdir_caps_blast_radius`, `mkdir_already_exists_is_benign`       |
| Atomic write                      | `write_tests.rs::partial_write_failure_preserves_old_bytes`, `concurrent_writes_dont_collide` |
| `list_dir` scope                  | `list_tests.rs::rejects_outside_home_*`                                                       |
| `read_file` scope + symlink guard | `read_tests.rs::rejects_symlink_target_*`                                                     |

## Defense Layers

The backend sandbox is not the only line of defense. The frontend
file explorer (`src/features/files/hooks/useFileTree.ts`) clamps
`navigateUp` at the home boundary so the UI never asks the backend
to read above `$HOME`. The backend enforces the sandbox; the
frontend prevents the attempt. Both layers must hold; neither is
sufficient alone.

## Invariants

The module guarantees to callers:

1. No command opens, reads, or writes a path that resolves outside
   `$HOME`.
2. Write commands are atomic at the filesystem level — readers see
   either the old contents or the new, never a partial write.
3. Commands never follow a symlink on the leaf segment.
4. `..` in user input is rejected before any filesystem syscall.

## Deferred Work

### Workspace crate extraction (issue #40, task #3)

**Status:** Deferred.
**Rationale:** Currently only `src-tauri` consumes this module.
Workspace-crate ceremony (nested `Cargo.toml`, path deps,
workspace-level lints) has no payoff with a single consumer. The
~500 LOC of production code does not warrant a separate compile
unit today.
**Revisit when** any of the following becomes true:

- A second binary (CLI, fuzz harness, test fixture) needs filesystem
  access.
- The module grows beyond ~1500 LOC of production code.
- We commit to `cargo fuzz` (see below) — fuzz harnesses live more
  naturally against a dedicated crate.

### Fuzz testing (issue #40, task #5)

**Status:** Deferred.
**Rationale:** `cargo fuzz` requires nightly Rust and adds CI
complexity. Hand-written regression tests cover all currently-known
attack classes. Fuzz pays off _after_ the module split — fuzzing
`write.rs` in isolation yields higher signal than fuzzing a 864-line
mixed file. Fuzz findings deserve their own PR narrative.
**Revisit when** a CVE or near-miss surfaces in the write path, OR
when we add new surface area (e.g. `move_file`, `delete_file`,
symlink creation).

## Review Checklist

For reviewers touching this module:

- [ ] Does the change introduce a new filesystem syscall? If so,
      which primitive enforces the sandbox boundary for it?
- [ ] Is the change covered by a test in the matching `*_tests.rs`?
- [ ] If a new primitive was added, is it in the Enforcement
      Primitives table and the Test Coverage Map?
- [ ] If deferred work was addressed, was it removed from the
      Deferred Work section?
```

### Matching `mod.rs` doc

```rust
//! # Filesystem sandbox
//!
//! This module is the Tauri IPC boundary for all filesystem access.
//! It enforces a `$HOME`-rooted sandbox against a compromised sibling
//! process in the same user session.
//!
//! **Before modifying this module, read `SECURITY.md` in this
//! directory.** It contains the threat model, enforcement primitives,
//! test coverage map, and deferred-work log.
//!
//! ## Quick reference
//! - Sandbox boundary: `$HOME` canonical path at process start
//! - Adversary: compromised sibling process (same user session)
//! - Out of scope: multi-user, confused-deputy, kernel attacks
//!
//! See `SECURITY.md` for the full model.
```

The deferred-work section in `SECURITY.md` is the central artifact for the deferral story. "Deferred" never means "forgotten" — a future maintainer sees exactly why and when to reopen.

## Migration Strategy

The PR is split into four ordered commits, each independently revertable.

### Commit 1 — Test extraction, no production changes

Move the `#[cfg(test)]` block out of `commands.rs` into `filesystem/tests/mod.rs` + per-area test files. Production code in `commands.rs` is unchanged. After this commit: `commands.rs` drops from 864 → ~480 lines, `cargo test` results identical.

This is the lowest-risk move and gets us under the 800-line guideline immediately even if the rest of the PR were reverted.

### Commit 2 — Extract `scope.rs`

Pull the shared helpers (`expand_home`, `reject_parent_refs`, `canonicalize_within_home`, `ensure_within_home`, `open_nofollow`) out of `commands.rs` into `scope.rs` as `pub(super) fn`. `commands.rs` imports them. No behavior change. Tests in `scope_tests.rs` cover them in isolation.

**Verification gate (critical):** after this commit, the full 15-test battery from PR #38 must still map 1-for-1 onto a passing test. If any of the findings #1-#14 from `docs/reviews/patterns/filesystem-scope.md` no longer has a guarding test, stop and investigate before commit 3.

### Commit 3 — Split into `list.rs` / `read.rs` / `write.rs`

Move each `#[tauri::command]` handler into its own file, importing from `scope.rs`. `mod.rs` re-exports them so `src-tauri/src/lib.rs` (the Tauri builder) sees no API change. Delete the now-empty `commands.rs`.

### Commit 4 — Add `mod.rs` doc + `SECURITY.md`

Pure documentation. Includes the deferred-work section with revisit triggers.

### Why this commit order

- Each commit is independently revertable. If commit 3 breaks something subtle, commits 1+2 still land the test extraction win.
- Reviewers can read commit-by-commit instead of one giant diff.
- Commit 1 alone resolves the 800-line guideline violation, so even partial landings are useful.

## Risk Register

| Risk                                                                                                                      | Likelihood                          | Mitigation                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Test extraction silently drops a test (wrong `mod` declaration, missing `use` import)                                     | Medium                              | Run `cargo test 2>&1 \| grep "test result"` before AND after commit 1, compare counts. Document the count in the commit message.             |
| `pub(super)` visibility change breaks compilation                                                                         | Low                                 | Caught at compile time. Trivial fix.                                                                                                         |
| Tauri command registration missed during split (forgot to re-export from `mod.rs`)                                        | Medium                              | Caught by `src-tauri/src/lib.rs` failing to compile against the `invoke_handler!` macro. Smoke-test by running `npm run dev` after commit 3. |
| Subtle behavior change when extracting helpers (e.g. inline closure becomes a function with different lifetime semantics) | Low-Medium                          | The 15 existing regression tests are the safety net. They MUST pass after each commit. No exceptions.                                        |
| `cfg(unix)` / `cfg(windows)` paths get split across files awkwardly                                                       | Medium                              | Keep ALL `cfg` arms for a given primitive in `scope.rs`. The command files only call the primitive — they don't know which OS impl ran.      |
| Hidden coupling discovered mid-split (e.g. `read_file` and `write_file` share a private helper not yet noticed)           | Medium                              | If found, that helper goes into `scope.rs` too. Don't fight it — the whole point of `scope.rs` is to be the shared layer.                    |
| Per-segment canonicalization loop accidentally simplified to single `create_dir_all`                                      | Low (if reviewer reads finding #11) | Preserve the explanatory comment block. The match arm swallowing `AlreadyExists` is load-bearing — do not "clean up" into a `?`.             |
| `TEMP_COUNTER` becomes function-local instead of module-level static                                                      | Low (covered by finding #14 test)   | Doc comment on the static referencing finding #14 in the review knowledge base.                                                              |

## Verification at Each Commit

- `cargo build` (debug + release)
- `cargo test --package <crate>` — all 15 regression tests must pass
- `cargo clippy -- -D warnings`
- `cargo fmt --check`
- Manual smoke test before final push: `npm run dev`, open the app, verify file explorer lists files, opens a file in the editor, saves a file. (The 3 user-visible code paths.)

### Out-of-band verification before claiming done

- Diff the public API surface of `filesystem::mod` before/after using `cargo doc --no-deps` and visually compare. Any name that disappeared = a regression.
- Confirm `src-tauri/src/lib.rs` `invoke_handler!` macro lists the same commands as before.

## Findings Regression Map

The 14 review findings in `docs/reviews/patterns/filesystem-scope.md` are the single most important constraint on this refactor. Each represents a subtle property that must not be silently lost during the split. Every finding gets a home in the new layout and a test that would catch its regression.

| #   | Finding (one-line)                                                       | Lives in (after split)                                                   | Guarded by test in                                                                          |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| 1   | `list_dir` must validate path against home scope                         | `list.rs` (calls `scope::ensure_within_home`)                            | `list_tests.rs::rejects_outside_home_*`                                                     |
| 2   | (Frontend `navigateUp` clamp — out of scope, lives in `useFileTree.ts`)  | n/a (covered in `SECURITY.md` § Defense Layers)                          | n/a                                                                                         |
| 3   | Tests must use temp dirs **inside** home (not `/tmp`)                    | All `*_tests.rs` files                                                   | Test helper `scope_tests.rs::tmp_in_home()`                                                 |
| 4   | `write_file` must reject `..` BEFORE any FS mutation                     | `scope.rs::reject_parent_refs` (called first by `write.rs`)              | `scope_tests.rs::rejects_parent_refs_*` + `write_tests.rs::rejects_traversal_before_mkdir`  |
| 5   | Final target path must be checked for symlink (no `fs::write` follow)    | `write.rs` (uses `scope::open_nofollow`)                                 | `write_tests.rs::rejects_symlink_at_target`                                                 |
| 6   | `read_file` must use `O_NOFOLLOW` / `FILE_FLAG_OPEN_REPARSE_POINT`       | `read.rs` (uses `scope::open_nofollow`)                                  | `read_tests.rs::rejects_symlink_target_unix`, `..._windows`                                 |
| 7   | TOCTOU between `symlink_metadata` and `fs::write` — kernel-level refusal | `scope::open_nofollow` (single source for both `read.rs` and `write.rs`) | `scope_tests.rs::open_nofollow_*`                                                           |
| 8   | Windows must set `FILE_FLAG_OPEN_REPARSE_POINT`                          | `scope::open_nofollow` (Windows arm)                                     | `scope_tests.rs::open_nofollow_windows_*`                                                   |
| 9   | Windows post-open metadata check (reject if landed on symlink)           | `scope::open_nofollow` (post-open guard inside the helper)               | `scope_tests.rs::open_nofollow_windows_post_check`                                          |
| 10  | After ancestor canon walk, `resolved_parent` must be re-canonicalized    | `scope::canonicalize_within_home` (per-segment loop)                     | `scope_tests.rs::intermediate_symlink_race`, `write_tests.rs::intermediate_symlink_blocked` |
| 11  | Per-segment `mkdir` loop with canon-after-each (cap blast radius)        | `scope::canonicalize_within_home`                                        | `scope_tests.rs::per_segment_mkdir_caps_blast_radius`                                       |
| 12  | `mkdir` per-segment must swallow `ErrorKind::AlreadyExists`              | `scope::canonicalize_within_home` (the explicit `match` block)           | `scope_tests.rs::mkdir_already_exists_is_benign`                                            |
| 13  | Atomic write pattern: temp file → `sync_all` → `rename`                  | `write.rs::atomic_write_via_temp` (private fn)                           | `write_tests.rs::partial_write_failure_preserves_old_bytes`                                 |
| 14  | Per-process `AtomicU64` counter for unique temp-file names               | `write.rs` (module-level `static TEMP_COUNTER: AtomicU64`)               | `write_tests.rs::concurrent_writes_dont_collide`                                            |

### Code quality protections from this map

1. **`scope::open_nofollow` is the most-tested function in the module.** Findings 5, 6, 7, 8, 9 all converge on it. It MUST be:
   - A single function with `cfg(unix)` / `cfg(windows)` arms inside it (NOT two separate functions in two files — that's how the Windows post-open check got missed in finding #9).
   - The post-open Windows metadata check lives **inside** the function, not in the caller. Otherwise `read.rs` and `write.rs` will silently diverge again.
   - Returns a `File` handle, not a `PathBuf` — the whole point is that the kernel atomically refuses to follow.

2. **`scope::canonicalize_within_home` is the second-most-tested.** Findings 10, 11, 12 converge on it. The per-segment loop with `match` on `AlreadyExists` is load-bearing — preserve the explanatory comment block currently in `commands.rs`. Don't "clean up" the match into a `?` operator.

3. **`write.rs::TEMP_COUNTER`** must be a module-level `static`, not a function-local. Finding #14 is exactly the bug of resetting per-call. Add a doc comment: `/// Per-process counter for atomic-write temp file names. See finding #14 in docs/reviews/patterns/filesystem-scope.md.`

### Invariant

Every test in this map must pass at every commit boundary in the migration. Not just at the end. If commit 2 (extract `scope.rs`) breaks `intermediate_symlink_race`, that's a stop-the-line — the helper signature is wrong, not the test.

## Other Review Patterns to Consult During Implementation

Read on demand, not now, to keep the refactor focused. Bump `ref_count` per the protocol when consulted:

- **`cross-platform-paths.md`** (2 findings) — when touching the Windows arm of `open_nofollow`
- **`testing-gaps.md`** (4 findings) — when designing the test split
- **`documentation-accuracy.md`** (8 findings) — when writing `SECURITY.md` and `mod.rs` `//!` doc
- **`error-surfacing.md`** (7 findings) — when deciding how `commands.rs` errors propagate to the frontend after the split

## Success Criteria

- `src-tauri/src/filesystem/commands.rs` no longer exists; replaced by `list.rs`, `read.rs`, `write.rs`, `scope.rs`
- All four new production files (`list.rs`, `read.rs`, `write.rs`, `scope.rs`) under 200 lines each; `mod.rs` and `types.rs` unchanged-or-smaller
- `cargo test` passes with the same number of tests as before (count documented in commit 1's message)
- Every finding #1-#14 in `docs/reviews/patterns/filesystem-scope.md` traces to a passing test in the matching `*_tests.rs` file
- `cargo clippy -- -D warnings` and `cargo fmt --check` pass
- `npm run dev` smoke test: file explorer lists files, opens file in editor, saves file
- `src-tauri/src/filesystem/SECURITY.md` exists with all sections from the outline
- `mod.rs` has the `//!` doc pointing to `SECURITY.md`
- PR description references issue #40 and explicitly lists the deferred items (3, 5) with a pointer to `SECURITY.md` § Deferred Work

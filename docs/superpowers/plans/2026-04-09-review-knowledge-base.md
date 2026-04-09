# Review Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a persistent review knowledge base at `docs/reviews/` seeded with findings from PRs #33, #34, #36, and wire it into project discovery docs.

**Architecture:** Flat markdown files — one per pattern in `docs/reviews/patterns/`, indexed by `docs/reviews/CLAUDE.md`. Findings are grouped by recurring pattern with YAML frontmatter for metadata and ref counting. No code, no scripts — pure documentation.

**Tech Stack:** Markdown, YAML frontmatter, `gh` CLI (for fetching PR comments during seeding)

**Worktree:** This plan MUST be executed in a git worktree, not on main.

---

## File Structure

| File                                               | Action | Purpose                                                      |
| -------------------------------------------------- | ------ | ------------------------------------------------------------ |
| `docs/reviews/CLAUDE.md`                           | Create | Pattern index with ref counters                              |
| `docs/reviews/patterns/filesystem-scope.md`        | Create | Filesystem access restrictions and path boundaries           |
| `docs/reviews/patterns/react-lifecycle.md`         | Create | React effect cleanup, state-after-unmount, dependency arrays |
| `docs/reviews/patterns/resource-cleanup.md`        | Create | Event listener leaks, service disposal                       |
| `docs/reviews/patterns/cross-platform-paths.md`    | Create | Windows path handling, drive root normalization              |
| `docs/reviews/patterns/debug-artifacts.md`         | Create | Debug UI/logging shipped to production                       |
| `docs/reviews/patterns/testing-gaps.md`            | Create | Missing co-located tests, test scope mismatches              |
| `docs/reviews/patterns/terminal-input-handling.md` | Create | Backspace, paste, CRLF, multi-char input                     |
| `docs/reviews/patterns/documentation-accuracy.md`  | Create | Stale docs after implementation changes                      |
| `CLAUDE.md`                                        | Modify | Add index table row                                          |
| `docs/CLAUDE.md`                                   | Modify | Add `reviews/` subsection                                    |
| `AGENTS.md`                                        | Modify | Add reference to review knowledge base                       |

## Pattern Classification (from PR history)

Findings from PRs #33, #34, #36 grouped into 8 patterns:

| Pattern                 | Findings | Sources                                                                  |
| ----------------------- | -------- | ------------------------------------------------------------------------ |
| filesystem-scope        | 4        | PR #36 (unrestricted access x2, navigate above home, rust test scope x2) |
| react-lifecycle         | 2        | PR #36 (PTY respawns on cwd), PR #34 (state after unmount)               |
| resource-cleanup        | 1        | PR #34 (event listener leaks)                                            |
| cross-platform-paths    | 2        | PR #36 (Windows `C:` path x2)                                            |
| debug-artifacts         | 2        | PR #34 (debug UI x2)                                                     |
| testing-gaps            | 1        | PR #36 (missing co-located tests)                                        |
| terminal-input-handling | 3        | PR #33 (backspace, paste, CRLF)                                          |
| documentation-accuracy  | 2        | PR #36 (broken ref path), PR #33 (stale WebGL docs)                      |

**Skipped:** Merge conflict markers from PR #34 (one-time mistake, not a recurring pattern).

---

### Task 1: Create directory structure and empty index

**Files:**

- Create: `docs/reviews/CLAUDE.md`
- Create: `docs/reviews/patterns/.gitkeep`

- [ ] **Step 1: Create `docs/reviews/CLAUDE.md`**

```markdown
# Review Knowledge Base

Patterns learned from code reviews (local Codex and GitHub Codex). This is an
optional reference — agents may consult relevant patterns before implementing
to avoid repeating past mistakes.

**For agents:** When you read a pattern file during implementation, bump its
`ref_count` in frontmatter by 1 and update the Refs column below.

**After a review-fix cycle:** Record new findings by appending to an existing
pattern or creating a new file. See the spec at
`docs/superpowers/specs/2026-04-09-review-knowledge-base-design.md` for the
ingestion protocol.

| Pattern | Category | Findings | Refs | Last Updated |
| ------- | -------- | -------- | ---- | ------------ |
```

- [ ] **Step 2: Create `docs/reviews/patterns/.gitkeep`**

Empty file to ensure the `patterns/` directory is tracked by git.

- [ ] **Step 3: Commit**

```bash
git add docs/reviews/CLAUDE.md docs/reviews/patterns/.gitkeep
git commit -m "docs: create review knowledge base directory structure"
```

---

### Task 2: Seed pattern — filesystem-scope

**Files:**

- Create: `docs/reviews/patterns/filesystem-scope.md`
- Modify: `docs/reviews/CLAUDE.md`

- [ ] **Step 1: Fetch fix commits for PR #36 filesystem findings**

```bash
git log --oneline --all --grep="#36" | head -5
```

Use the commit hash(es) from the PR #36 merge to identify fix commits. If specific fix commits can't be traced, use the merge commit.

- [ ] **Step 2: Create `docs/reviews/patterns/filesystem-scope.md`**

```markdown
---
id: filesystem-scope
category: security
created: 2026-04-09
last_updated: 2026-04-09
ref_count: 0
---

# Filesystem Scope

## Summary

Tauri IPC commands that access the filesystem must validate paths against an
allowlist. The webview is an untrusted boundary — a compromised renderer could
enumerate sensitive directories without scope restrictions.

## Findings

### 1. Unrestricted filesystem access from Tauri command

- **Source:** github-codex | PR #36 | 2026-04-09
- **Severity:** HIGH
- **File:** `src-tauri/src/filesystem/commands.rs`
- **Finding:** `list_dir` accepts any client-supplied path without validating against an allowed root or Tauri fs scope
- **Fix:** Added home-directory scope validation — canonicalize requested path, verify `starts_with(home_dir)` before reading
- **Commit:** `<hash from step 1> <message>`

### 2. File explorer can navigate above home directory

- **Source:** github-codex | PR #36 | 2026-04-09
- **Severity:** MEDIUM
- **File:** `src/features/files/hooks/useFileTree.ts`
- **Finding:** `navigateUp` allows navigation to paths outside home scope, triggering access denied errors
- **Fix:** Clamped `navigateUp` at home directory boundary
- **Commit:** `<hash from step 1> <message>`

### 3. Rust filesystem tests use temp dir outside allowed home scope

- **Source:** github-codex | PR #36 | 2026-04-09
- **Severity:** HIGH
- **File:** `src-tauri/src/filesystem/commands.rs`
- **Finding:** Tests create directories under `/tmp` which is outside the enforced home-directory scope, causing test failures
- **Fix:** Moved test directories under home directory path
- **Commit:** `<hash from step 1> <message>`
```

Replace `<hash from step 1> <message>` with actual git log output from step 1.

- [ ] **Step 3: Update index in `docs/reviews/CLAUDE.md`**

Add this row to the table:

```
| [Filesystem Scope](patterns/filesystem-scope.md) | security | 3 | 0 | 2026-04-09 |
```

- [ ] **Step 4: Commit**

```bash
git add docs/reviews/patterns/filesystem-scope.md docs/reviews/CLAUDE.md
git commit -m "docs: seed filesystem-scope review pattern from PR #36"
```

---

### Task 3: Seed pattern — react-lifecycle

**Files:**

- Create: `docs/reviews/patterns/react-lifecycle.md`
- Modify: `docs/reviews/CLAUDE.md`

- [ ] **Step 1: Fetch fix commits for PRs #34 and #36**

```bash
git log --oneline --all --grep="#34\|#36" | head -10
```

- [ ] **Step 2: Create `docs/reviews/patterns/react-lifecycle.md`**

```markdown
---
id: react-lifecycle
category: react-patterns
created: 2026-04-09
last_updated: 2026-04-09
ref_count: 0
---

# React Lifecycle

## Summary

React effects with async work or subscriptions must handle cleanup and guard
against state updates after unmount. Effect dependency arrays must be minimal
to avoid unintended re-runs (e.g., PTY respawning on every cwd change).

## Findings

### 1. PTY respawns on every cwd update via OSC 7

- **Source:** github-codex | PR #36 | 2026-04-09
- **Severity:** HIGH
- **File:** `src/features/terminal/hooks/useTerminal.ts`
- **Finding:** PTY spawn effect depends on `cwd`, so any directory change kills the running session and spawns a new one
- **Fix:** Decoupled spawning from cwd — treat cwd as initial spawn parameter stored in a ref
- **Commit:** `<hash> <message>`

### 2. State updates after unmount in PTY spawn flow

- **Source:** github-codex | PR #34 | 2026-04-08
- **Severity:** MEDIUM
- **File:** `src/features/terminal/hooks/useTerminal.ts`
- **Finding:** `setDebugInfo()` called even when `isMountedRef.current` is false, triggering React warnings
- **Fix:** Gated all state updates (including debug) behind `isMountedRef` guard
- **Commit:** `<hash> <message>`
```

- [ ] **Step 3: Update index in `docs/reviews/CLAUDE.md`**

Add row:

```
| [React Lifecycle](patterns/react-lifecycle.md) | react-patterns | 2 | 0 | 2026-04-09 |
```

- [ ] **Step 4: Commit**

```bash
git add docs/reviews/patterns/react-lifecycle.md docs/reviews/CLAUDE.md
git commit -m "docs: seed react-lifecycle review pattern from PRs #34, #36"
```

---

### Task 4: Seed pattern — resource-cleanup

**Files:**

- Create: `docs/reviews/patterns/resource-cleanup.md`
- Modify: `docs/reviews/CLAUDE.md`

- [ ] **Step 1: Create `docs/reviews/patterns/resource-cleanup.md`**

```markdown
---
id: resource-cleanup
category: react-patterns
created: 2026-04-09
last_updated: 2026-04-09
ref_count: 0
---

# Resource Cleanup

## Summary

Services that register global event listeners (especially Tauri IPC listeners)
must be disposed on unmount. Creating a new service instance per component
mount without cleanup causes listener accumulation and duplicate event handling.

## Findings

### 1. Tauri event listeners leak across terminal panes

- **Source:** github-codex | PR #34 | 2026-04-08
- **Severity:** MEDIUM
- **File:** `src/features/terminal/services/terminalService.ts`
- **Finding:** Each `createTerminalService()` call registers global Tauri listeners with no `dispose()` on unmount — listeners accumulate as panes mount/unmount
- **Fix:** Made Tauri service a singleton or added dispose call in cleanup
- **Commit:** `<hash> <message>`
```

- [ ] **Step 2: Update index in `docs/reviews/CLAUDE.md`**

Add row:

```
| [Resource Cleanup](patterns/resource-cleanup.md) | react-patterns | 1 | 0 | 2026-04-09 |
```

- [ ] **Step 3: Commit**

```bash
git add docs/reviews/patterns/resource-cleanup.md docs/reviews/CLAUDE.md
git commit -m "docs: seed resource-cleanup review pattern from PR #34"
```

---

### Task 5: Seed pattern — cross-platform-paths

**Files:**

- Create: `docs/reviews/patterns/cross-platform-paths.md`
- Modify: `docs/reviews/CLAUDE.md`

- [ ] **Step 1: Create `docs/reviews/patterns/cross-platform-paths.md`**

```markdown
---
id: cross-platform-paths
category: cross-platform
created: 2026-04-09
last_updated: 2026-04-09
ref_count: 0
---

# Cross-Platform Paths

## Summary

Path manipulation using string operations (regex split on `/`) breaks on
Windows. Drive roots like `C:/Users` become `C:` (drive-relative, not root)
when the trailing segment is stripped. Always normalize drive roots and
consider using path libraries for cross-platform code.

## Findings

### 1. Windows path navigation resolves to drive-relative `C:` instead of `C:/`

- **Source:** github-codex | PR #36 | 2026-04-09
- **Severity:** MEDIUM
- **File:** `src/features/files/hooks/useFileTree.ts`
- **Finding:** `navigateUp` strips last segment with `/` regex, turning `C:/Users` into `C:` — not a valid absolute path on Windows
- **Fix:** Added Windows drive root detection — if result matches `^[A-Za-z]:$`, append `/`
- **Commit:** `<hash> <message>`
```

- [ ] **Step 2: Update index in `docs/reviews/CLAUDE.md`**

Add row:

```
| [Cross-Platform Paths](patterns/cross-platform-paths.md) | cross-platform | 1 | 0 | 2026-04-09 |
```

- [ ] **Step 3: Commit**

```bash
git add docs/reviews/patterns/cross-platform-paths.md docs/reviews/CLAUDE.md
git commit -m "docs: seed cross-platform-paths review pattern from PR #36"
```

---

### Task 6: Seed pattern — debug-artifacts

**Files:**

- Create: `docs/reviews/patterns/debug-artifacts.md`
- Modify: `docs/reviews/CLAUDE.md`

- [ ] **Step 1: Create `docs/reviews/patterns/debug-artifacts.md`**

```markdown
---
id: debug-artifacts
category: code-quality
created: 2026-04-09
last_updated: 2026-04-09
ref_count: 0
---

# Debug Artifacts

## Summary

Debug UI elements (red borders, status bars, overlay text) and `console.log`
statements must not ship to production. Gate debug visuals behind
`import.meta.env.DEV` or remove them before committing. The project enforces
`no-console: error` via ESLint, but inline debug UI bypasses this.

## Findings

### 1. Debug status bar rendered unconditionally in TerminalPane

- **Source:** github-codex | PR #34 | 2026-04-08
- **Severity:** MEDIUM
- **File:** `src/features/terminal/components/TerminalPane.tsx`
- **Finding:** Always-on debug status bar with internal state leaks to users and conflicts with Obsidian Lens design
- **Fix:** Removed debug UI or gated behind `import.meta.env.DEV`
- **Commit:** `<hash> <message>`

### 2. Debug border and overlay in TerminalZone

- **Source:** github-codex | PR #34 | 2026-04-08
- **Severity:** LOW
- **File:** `src/features/workspace/components/TerminalZone.tsx`
- **Finding:** `border-2 border-red-500` wrapper and debug overlay shipped in production build
- **Fix:** Removed debug styling
- **Commit:** `<hash> <message>`
```

- [ ] **Step 2: Update index in `docs/reviews/CLAUDE.md`**

Add row:

```
| [Debug Artifacts](patterns/debug-artifacts.md) | code-quality | 2 | 0 | 2026-04-09 |
```

- [ ] **Step 3: Commit**

```bash
git add docs/reviews/patterns/debug-artifacts.md docs/reviews/CLAUDE.md
git commit -m "docs: seed debug-artifacts review pattern from PR #34"
```

---

### Task 7: Seed pattern — testing-gaps

**Files:**

- Create: `docs/reviews/patterns/testing-gaps.md`
- Modify: `docs/reviews/CLAUDE.md`

- [ ] **Step 1: Create `docs/reviews/patterns/testing-gaps.md`**

```markdown
---
id: testing-gaps
category: testing
created: 2026-04-09
last_updated: 2026-04-09
ref_count: 0
---

# Testing Gaps

## Summary

Every `.ts`/`.tsx` production file must have a co-located `.test.ts`/`.test.tsx`
sibling. New modules added without tests violate the project testing rule and
increase regression risk. Tests must also respect runtime constraints (e.g.,
filesystem scope restrictions).

## Findings

### 1. New core modules lack co-located tests

- **Source:** github-codex | PR #36 | 2026-04-09
- **Severity:** HIGH
- **File:** `src/features/workspace/hooks/useResizable.ts` (and 3 others)
- **Finding:** Four new production modules added without sibling test files: `useResizable.ts`, `useSessionManager.ts`, `fileSystemService.ts`, `useFileTree.ts`
- **Fix:** Added co-located test files for all new modules
- **Commit:** `<hash> <message>`
```

- [ ] **Step 2: Update index in `docs/reviews/CLAUDE.md`**

Add row:

```
| [Testing Gaps](patterns/testing-gaps.md) | testing | 1 | 0 | 2026-04-09 |
```

- [ ] **Step 3: Commit**

```bash
git add docs/reviews/patterns/testing-gaps.md docs/reviews/CLAUDE.md
git commit -m "docs: seed testing-gaps review pattern from PR #36"
```

---

### Task 8: Seed pattern — terminal-input-handling

**Files:**

- Create: `docs/reviews/patterns/terminal-input-handling.md`
- Modify: `docs/reviews/CLAUDE.md`

- [ ] **Step 1: Create `docs/reviews/patterns/terminal-input-handling.md`**

```markdown
---
id: terminal-input-handling
category: terminal
created: 2026-04-09
last_updated: 2026-04-09
ref_count: 0
---

# Terminal Input Handling

## Summary

Terminal input processing must handle multi-character input (paste), control
characters (backspace, delete), and line ending variants (CR, LF, CRLF).
Processing char-by-char with proper buffer mutation prevents ghost characters,
double execution, and paste failures.

## Findings

### 1. Backspace does not update the input buffer

- **Source:** github-codex | PR #33 | 2026-04-08
- **Severity:** MEDIUM
- **File:** `src/features/terminal/services/terminalService.ts`
- **Finding:** Backspace handler emits visual `\b \b` but never removes the last character from `session.inputBuffer` — deleted characters still execute
- **Fix:** Added buffer mutation on backspace with empty-buffer guard
- **Commit:** `<hash> <message>`

### 2. Pasted text with newline never executes

- **Source:** github-codex | PR #33 | 2026-04-08
- **Severity:** MEDIUM
- **File:** `src/features/terminal/services/terminalService.ts`
- **Finding:** `write()` only checks `data === '\r'` for Enter — multi-char paste containing newlines falls through to regular character path
- **Fix:** Process `data` per character, handling control chars individually
- **Commit:** `<hash> <message>`

### 3. CRLF input executes command twice

- **Source:** github-codex | PR #33 | 2026-04-08
- **Severity:** MEDIUM
- **File:** `src/features/terminal/services/terminalService.ts`
- **Finding:** `\r` and `\n` treated as independent Enter events — `\r\n` paste triggers two command executions
- **Fix:** Normalize input by replacing `\r\n` with `\n` before processing, or track previous char to skip `\n` after `\r`
- **Commit:** `<hash> <message>`
```

- [ ] **Step 2: Update index in `docs/reviews/CLAUDE.md`**

Add row:

```
| [Terminal Input Handling](patterns/terminal-input-handling.md) | terminal | 3 | 0 | 2026-04-09 |
```

- [ ] **Step 3: Commit**

```bash
git add docs/reviews/patterns/terminal-input-handling.md docs/reviews/CLAUDE.md
git commit -m "docs: seed terminal-input-handling review pattern from PR #33"
```

---

### Task 9: Seed pattern — documentation-accuracy

**Files:**

- Create: `docs/reviews/patterns/documentation-accuracy.md`
- Modify: `docs/reviews/CLAUDE.md`

- [ ] **Step 1: Create `docs/reviews/patterns/documentation-accuracy.md`**

```markdown
---
id: documentation-accuracy
category: code-quality
created: 2026-04-09
last_updated: 2026-04-09
ref_count: 0
---

# Documentation Accuracy

## Summary

When implementation changes (removing an addon, renaming a directory, changing
behavior), inline docs and comments must be updated in the same commit.
Stale documentation misleads future contributors and review agents.

## Findings

### 1. TerminalPane docs claim WebGL rendering after addon removal

- **Source:** github-codex | PR #33 | 2026-04-08
- **Severity:** LOW
- **File:** `src/features/terminal/components/TerminalPane.tsx`
- **Finding:** Component doc comment lists "Hardware-accelerated rendering with WebGL addon" but WebGL addon was removed in this PR
- **Fix:** Updated feature list to reflect Canvas2D renderer
- **Commit:** `<hash> <message>`

### 2. Broken design reference path in mock file tree

- **Source:** github-codex | PR #36 | 2026-04-09
- **Severity:** LOW
- **File:** `src/features/files/data/mockFileTree.ts`
- **Finding:** Comment references `docs/design/left-sidebar/` but actual path is `docs/design/leftsidebar/`
- **Fix:** Updated comment to correct directory name
- **Commit:** `<hash> <message>`
```

- [ ] **Step 2: Update index in `docs/reviews/CLAUDE.md`**

Add row:

```
| [Documentation Accuracy](patterns/documentation-accuracy.md) | code-quality | 2 | 0 | 2026-04-09 |
```

- [ ] **Step 3: Commit**

```bash
git add docs/reviews/patterns/documentation-accuracy.md docs/reviews/CLAUDE.md
git commit -m "docs: seed documentation-accuracy review pattern from PRs #33, #36"
```

---

### Task 10: Wire discovery pointers

**Files:**

- Modify: `CLAUDE.md` (root, index table around line 78-92)
- Modify: `docs/CLAUDE.md` (add reviews subsection)
- Modify: `AGENTS.md` (add reference)

- [ ] **Step 1: Add row to root `CLAUDE.md` index table**

Add after the "Shell OSC 7 setup" row (line 92):

```
| Review knowledge base (patterns from past reviews)       | `docs/reviews/CLAUDE.md`                                          |
```

- [ ] **Step 2: Add `reviews/` subsection to `docs/CLAUDE.md`**

Add after the `superpowers/specs/` subsection (after line 15):

```markdown
### `reviews/`

Review knowledge base — patterns learned from local Codex and GitHub Codex code reviews. Each pattern file in `patterns/` collects related findings with their fixes and commit links. Agents may consult relevant patterns before implementing to avoid repeating past mistakes. See `reviews/CLAUDE.md` for the index.
```

- [ ] **Step 3: Add reference to `AGENTS.md`**

Add after the "Review Guidelines" section (after line 81):

```markdown
## Review Knowledge Base

Past review findings are collected in `docs/reviews/CLAUDE.md`, grouped by recurring pattern. When reviewing, check if a finding matches an existing pattern — if so, note it. When fixing findings, record the fix in the appropriate pattern file per the ingestion protocol in the design spec.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/CLAUDE.md AGENTS.md
git commit -m "docs: wire review knowledge base into project discovery docs"
```

---

### Task 11: Final verification

- [ ] **Step 1: Verify all files exist and are well-formed**

```bash
ls -la docs/reviews/CLAUDE.md docs/reviews/patterns/*.md
```

Expected: `CLAUDE.md` + 8 pattern files.

- [ ] **Step 2: Verify index table row count matches pattern count**

```bash
grep -c "patterns/" docs/reviews/CLAUDE.md
```

Expected: 8

- [ ] **Step 3: Verify frontmatter is parseable in all pattern files**

```bash
for f in docs/reviews/patterns/*.md; do
  echo "--- $f ---"
  head -8 "$f"
done
```

Expected: Each file has `---` delimited YAML with id, category, created, last_updated, ref_count.

- [ ] **Step 4: Verify discovery pointers**

```bash
grep "reviews" CLAUDE.md docs/CLAUDE.md AGENTS.md
```

Expected: One match in each file pointing to `docs/reviews/CLAUDE.md`.

- [ ] **Step 5: Remove `.gitkeep` if patterns directory has files**

```bash
rm docs/reviews/patterns/.gitkeep
git add docs/reviews/patterns/.gitkeep
git commit -m "chore: remove .gitkeep now that patterns directory has content"
```

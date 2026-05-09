# Step 4 — Single TerminalPane (handoff §4.6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the chrome around `TerminalPane.tsx` with handoff §4.6 spec — collapsible header (agent chip · status pip · title · branch · ±changes · relative-time · collapse + close), scroll body (xterm), input footer, focus ring with 180–220 ms transitions — wired to one PTY. Multi-pane / SplitView is **step 5**, not step 4.

**Architecture:** Refactor `src/features/terminal/components/TerminalPane.tsx` (~380 LOC) into a `TerminalPane/` folder. xterm + PTY wiring lifts verbatim into `Body.tsx`. New chrome subcomponents (`Header.tsx`, `Footer.tsx`, `RestartAffordance.tsx`) mount around Body, composed by `index.tsx`. Focus state local to the pane via `useFocusedPane` hook. Body exposes `focusTerminal()` via `forwardRef` + `useImperativeHandle`; `index.tsx` calls it from the container's `onClick`. PTY status flows up via `onPtyStatusChange` callback; xterm focus events flow up via `onFocusChange` callback. Public API preserved via `index.tsx` re-exports of `terminalCache`, `clearTerminalCache`, `disposeTerminalSession`, `TerminalPaneMode`. Adds two new required props on `TerminalPaneProps`: `session: Session` (chrome data) and `isActive: boolean` (gates per-pane git IPC). Branch label backed by a new `git_branch` Tauri command + `useGitBranch` hook; ±counts aggregated from `useGitStatus().files` (insertions/deletions).

**Tech Stack:** React 19 (forwardRef + useImperativeHandle), TypeScript, Vitest + Testing Library, Tauri 2 (Rust git CLI shell-out), xterm.js (existing), Material Symbols icon font (existing), Tailwind semantic tokens.

**Spec:** [`docs/superpowers/specs/2026-05-08-step-4-terminal-pane-handoff-design.md`](../specs/2026-05-08-step-4-terminal-pane-handoff-design.md)

**Worktree:** Per `rules/common/worktrees.md` (and the user's saved preference `feedback_worktree_rule.md`), the main agent works on a feature branch in the primary checkout — do NOT call `EnterWorktree`. Suggested branch: `feat/step-4-terminal-pane-handoff`.

---

## File Structure

### New files (frontend)

- `src/features/diff/hooks/useGitBranch.ts` — React hook backed by the new `git_branch` Tauri command. Mirrors `useGitStatus`'s `enabled` / `idle` conventions.
- `src/features/diff/hooks/useGitBranch.test.ts` — hook tests.
- `src/features/terminal/components/TerminalPane/index.tsx` — public surface. Composes `Header` + (`Body` or `RestartAffordance`) + `Footer`. Re-exports cache helpers from `Body`. Exports `TerminalPaneMode`.
- `src/features/terminal/components/TerminalPane/index.test.tsx` — composition + mode-branch tests.
- `src/features/terminal/components/TerminalPane/Header.tsx` — agent chip · status pip · title · branch · ±changes · relative-time · collapse + close buttons.
- `src/features/terminal/components/TerminalPane/Header.test.tsx` — header render + behavior tests.
- `src/features/terminal/components/TerminalPane/Body.tsx` — xterm + PTY wiring (lifted verbatim from current `TerminalPane.tsx`) + `forwardRef` for `focusTerminal()` + `onPtyStatusChange` + `onFocusChange` callbacks.
- `src/features/terminal/components/TerminalPane/Body.test.tsx` — moved from `TerminalPane.test.tsx`. Drops awaiting-restart cases (those move to `index.test.tsx` + `RestartAffordance.test.tsx`).
- `src/features/terminal/components/TerminalPane/Footer.tsx` — decorative input (`readOnly` + `tabIndex={-1}` + `aria-hidden`) + status pip + agent-accent `>` glyph + click-to-focus glue.
- `src/features/terminal/components/TerminalPane/Footer.test.tsx` — placeholder derivation + override tests.
- `src/features/terminal/components/TerminalPane/RestartAffordance.tsx` — body-slot replacement when `mode === 'awaiting-restart'`.
- `src/features/terminal/components/TerminalPane/RestartAffordance.test.tsx` — render + click + a11y tests.
- `src/features/terminal/components/TerminalPane/useFocusedPane.ts` — local focus state hook (click-outside listener + xterm focus bridge).
- `src/features/terminal/components/TerminalPane/useFocusedPane.test.ts` — hook unit tests.
- `src/features/terminal/components/TerminalPane/ptyStatusToSessionStatus.ts` — pure mapping `PtyStatus → SessionStatus`.
- `src/features/terminal/components/TerminalPane/ptyStatusToSessionStatus.test.ts` — pure-function tests.
- `src/features/terminal/components/TerminalPane/aggregateLineDelta.ts` — pure reducer over `ChangedFile[]` → `{ added, removed }`.
- `src/features/terminal/components/TerminalPane/aggregateLineDelta.test.ts` — pure-function tests.

### Modified files (frontend)

- `src/features/workspace/components/TerminalZone.tsx` — pass `session={session}` and `isActive={isActive}` to each `<TerminalPane>`.

### Deleted files (frontend)

- `src/features/terminal/components/TerminalPane.tsx` — replaced by `TerminalPane/index.tsx` + `TerminalPane/Body.tsx`.
- `src/features/terminal/components/TerminalPane.test.tsx` — replaced by `Body.test.tsx` + `index.test.tsx` + `RestartAffordance.test.tsx`.

### Modified files (backend)

- `src-tauri/src/git/mod.rs` — add `git_branch(cwd: String) -> Result<String, String>` async fn (≈30 LOC) + Rust integration tests.
- `src-tauri/src/lib.rs` — `use git::git_branch` import + entry in BOTH `generate_handler![...]` arms (test build + prod build).

### File-size budget

- All new files under 400 LOC (per `rules/common/coding-style/`).
- `src-tauri/src/git/mod.rs` is already ~1693 LOC; adding ~30 LOC keeps it large but adding a function to an existing module is the pragmatic choice. Splitting `git/mod.rs` is out of scope.

---

## Phase 1 — `git_branch` IPC + `useGitBranch` hook

Lands first; no consumers yet. Ships green standalone.

### Task 1.1: Add `git_branch` Rust command (TDD)

**Files:**

- Modify: `src-tauri/src/git/mod.rs`

- [ ] **Step 1: Read the existing `git_status` for the validation pattern + test idiom**

```bash
sed -n '540,605p' src-tauri/src/git/mod.rs
```

Expected: `git_status` starts with `let safe_cwd = validate_cwd(&cwd)?;` and shells out via `Command::new("git")`.

- [ ] **Step 2: Append the failing Rust unit tests inside `mod.rs`'s `#[cfg(test)] mod tests`**

Use the existing test patterns (search for `#[tokio::test]` blocks near the bottom of `git/mod.rs`).

Two helpers are mandatory:

- `home_tempdir()` from `super::test_helpers` — creates a tempdir inside `$HOME` so `validate_cwd`'s home-scope check passes. Plain `tempfile::tempdir()` lives in `/tmp` and is rejected.
- `configure_test_git(path)` from `super::test_helpers` — sets `user.email` + `user.name` so `git commit` works on bare CI runners.

The existing `git/mod.rs` uses `std::process::Command` (synchronous) — no `.await`. The new tests are `#[test]` not `#[tokio::test]` and call `pollster::block_on` to drive the `async fn git_branch`. (Grep `git/mod.rs` for `block_on` if `pollster` isn't already imported; the existing tests for `git_status` show the canonical pattern — use it verbatim.)

```rust
#[test]
fn git_branch_returns_default_branch_for_unborn_repo() {
    use super::test_helpers::home_tempdir;
    use std::process::Command;
    let tmp = home_tempdir();
    let path = tmp.path().to_str().expect("path str").to_string();
    Command::new("git")
        .args(["-C", &path, "init", "--initial-branch=main"])
        .output()
        .expect("git init");

    let branch = pollster::block_on(git_branch(path)).expect("git_branch");
    assert_eq!(branch, "main");
}

#[test]
fn git_branch_returns_empty_for_detached_head() {
    use super::test_helpers::{configure_test_git, home_tempdir};
    use std::process::Command;
    let tmp = home_tempdir();
    let path = tmp.path().to_str().expect("path str").to_string();
    Command::new("git")
        .args(["-C", &path, "init", "--initial-branch=main"])
        .output()
        .expect("git init");
    configure_test_git(tmp.path());
    Command::new("git")
        .args(["-C", &path, "commit", "--allow-empty", "-m", "init"])
        .output()
        .expect("git commit");
    Command::new("git")
        .args(["-C", &path, "checkout", "--detach", "HEAD"])
        .output()
        .expect("git checkout --detach");

    let branch = pollster::block_on(git_branch(path)).expect("git_branch");
    assert_eq!(branch, "");
}

#[test]
fn git_branch_returns_error_for_non_repo_cwd() {
    use super::test_helpers::home_tempdir;
    let tmp = home_tempdir();
    let path = tmp.path().to_str().expect("path str").to_string();

    let result = pollster::block_on(git_branch(path));
    assert!(result.is_err(), "expected error, got {:?}", result);
}

#[test]
fn git_branch_rejects_out_of_scope_cwd() {
    // validate_cwd rejects paths outside $HOME.
    let result = pollster::block_on(git_branch("/etc".to_string()));
    assert!(result.is_err(), "expected error, got {:?}", result);
}
```

- [ ] **Step 3: Run the tests — they should fail (function not defined)**

```bash
cd src-tauri && cargo test --lib git::tests::git_branch -- --nocapture
```

Expected: compile error `cannot find function git_branch`.

- [ ] **Step 4: Implement `git_branch` in `src-tauri/src/git/mod.rs`**

Add near the end of the existing `pub async fn` block (after `get_git_diff`, before the watcher module if any):

`Command` is `std::process::Command` (sync), so no `.await` on the call. Differentiate "not a repo" (return `Err`) from "detached HEAD" (return `Ok("")`) by inspecting stderr — `git symbolic-ref` reports `fatal: not a git repository` for non-repos and `fatal: ref HEAD is not a symbolic ref` for detached HEAD.

```rust
#[tauri::command]
pub async fn git_branch(cwd: String) -> Result<String, String> {
    let safe_cwd = validate_cwd(&cwd)?;

    let output = Command::new("git")
        .arg("-C")
        .arg(&safe_cwd)
        .arg("symbolic-ref")
        .arg("--short")
        .arg("HEAD")
        .output()
        .map_err(|e| format!("git symbolic-ref failed: {e}"))?;

    if output.status.success() {
        let branch = String::from_utf8(output.stdout)
            .map_err(|e| format!("git_branch utf8: {e}"))?
            .trim()
            .to_string();
        return Ok(branch);
    }

    // Differentiate non-repo (Err) from detached HEAD (Ok("")) via stderr.
    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("not a git repository") {
        return Err("not a git repository".to_string());
    }

    // Detached HEAD or other "no symbolic ref" condition — Header treats
    // empty as null and omits the branch segment.
    Ok(String::new())
}
```

- [ ] **Step 5: Re-run the tests — they should pass**

```bash
cd src-tauri && cargo test --lib git::tests::git_branch -- --nocapture
```

Expected: all 4 tests pass (unborn repo, detached HEAD, non-repo error, out-of-scope error).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/git/mod.rs
git commit -m "feat(git): add git_branch IPC command with cwd validation"
```

---

### Task 1.2: Register `git_branch` handler in `lib.rs`

**Files:**

- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Locate both `generate_handler!` arms**

```bash
grep -n "generate_handler\|git_status" src-tauri/src/lib.rs
```

Expected: `git_status` appears in two `tauri::generate_handler![...]` blocks (test-build branch + prod-build branch) and in the `use git::{...}` import.

- [ ] **Step 2: Add `git_branch` to the `use` statement**

Existing line (around line 12):

```rust
use git::{get_git_diff, git_status, watcher::{start_git_watcher, stop_git_watcher, GitWatcherState}};
```

Becomes:

```rust
use git::{get_git_diff, git_branch, git_status, watcher::{start_git_watcher, stop_git_watcher, GitWatcherState}};
```

- [ ] **Step 3: Add `git_branch` after `git_status` in BOTH handler arms**

For each occurrence of `git_status,` inside `tauri::generate_handler![...]`, add `git_branch,` immediately after. Both arms (test build at ~line 81 and prod build at ~line 103) must be updated.

```bash
grep -n "git_status," src-tauri/src/lib.rs
```

Expected: 2 lines now read `git_status,\n        git_branch,` (or equivalent ordering).

- [ ] **Step 4: Build BOTH cfg arms to verify it compiles**

The default `cargo build` only checks the production cfg arm. The `e2e-test` cfg arm has its own `generate_handler!` block, so a forgotten entry there only surfaces during the E2E build (which runs in CI). Verify both:

```bash
cd src-tauri && cargo build
cd src-tauri && cargo build --features e2e-test,tauri/custom-protocol
```

(The second invocation matches `npm run test:e2e:build` from `package.json`.) Expected: both clean, no warnings about unused `git_branch`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "chore(tauri): register git_branch handler in both build arms"
```

---

### Task 1.3: Create `useGitBranch` hook (TDD)

**Files:**

- Create: `src/features/diff/hooks/useGitBranch.ts`
- Create: `src/features/diff/hooks/useGitBranch.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/features/diff/hooks/useGitBranch.test.ts
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, test, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import { useGitBranch } from './useGitBranch'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('useGitBranch', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset()
  })

  test('returns idle state for fallback cwd `.`', () => {
    const { result } = renderHook(() => useGitBranch('.'))
    expect(result.current.idle).toBe(true)
    expect(result.current.branch).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(invoke).not.toHaveBeenCalled()
  })

  test('returns idle state for fallback cwd `~`', () => {
    const { result } = renderHook(() => useGitBranch('~'))
    expect(result.current.idle).toBe(true)
    expect(invoke).not.toHaveBeenCalled()
  })

  test('returns idle state when enabled=false', () => {
    const { result } = renderHook(() =>
      useGitBranch('/home/user/repo', { enabled: false })
    )
    expect(result.current.idle).toBe(true)
    expect(invoke).not.toHaveBeenCalled()
  })

  test('fetches branch via invoke for a valid cwd', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('feat/jose-auth')
    const { result } = renderHook(() => useGitBranch('/home/user/repo'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(invoke).toHaveBeenCalledWith('git_branch', {
      cwd: '/home/user/repo',
    })
    expect(result.current.branch).toBe('feat/jose-auth')
    expect(result.current.error).toBeNull()
  })

  test('treats empty string result as null branch', async () => {
    vi.mocked(invoke).mockResolvedValueOnce('')
    const { result } = renderHook(() => useGitBranch('/home/user/repo'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.branch).toBeNull()
  })

  test('captures error on invoke rejection', async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error('not a repo'))
    const { result } = renderHook(() => useGitBranch('/home/user/repo'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.branch).toBeNull()
    expect(result.current.error).toBeInstanceOf(Error)
  })

  test('refresh re-fetches', async () => {
    vi.mocked(invoke)
      .mockResolvedValueOnce('main')
      .mockResolvedValueOnce('develop')
    const { result } = renderHook(() => useGitBranch('/home/user/repo'))
    await waitFor(() => expect(result.current.branch).toBe('main'))
    result.current.refresh()
    await waitFor(() => expect(result.current.branch).toBe('develop'))
    expect(invoke).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run the test — it should fail (file doesn't exist)**

```bash
npx vitest run src/features/diff/hooks/useGitBranch.test.ts
```

Expected: FAIL — `Cannot find module './useGitBranch'`.

- [ ] **Step 3: Implement the hook**

```ts
// src/features/diff/hooks/useGitBranch.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

export interface UseGitBranchOptions {
  /** When false, returns empty state and skips IPC. */
  enabled?: boolean
}

export interface UseGitBranchReturn {
  branch: string | null
  loading: boolean
  error: Error | null
  refresh: () => void
  idle: boolean
}

const isValidCwd = (cwd: string): boolean =>
  cwd !== '.' && cwd !== '~' && cwd.length > 0

export const useGitBranch = (
  cwd = '.',
  options: UseGitBranchOptions = {}
): UseGitBranchReturn => {
  const { enabled = true } = options

  const [branch, setBranch] = useState<string | null>(null)
  const [loading, setLoading] = useState(() => enabled && isValidCwd(cwd))
  const [error, setError] = useState<Error | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback((): void => {
    setRefreshKey((k) => k + 1)
  }, [])

  const idle = !enabled || !isValidCwd(cwd)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return (): void => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!enabled || !isValidCwd(cwd)) {
      setBranch(null)
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    invoke<string>('git_branch', { cwd })
      .then((result) => {
        if (!mountedRef.current) return
        const trimmed = result.trim()
        setBranch(trimmed === '' ? null : trimmed)
        setLoading(false)
      })
      .catch((err) => {
        if (!mountedRef.current) return
        setBranch(null)
        setError(err instanceof Error ? err : new Error(String(err)))
        setLoading(false)
      })
  }, [cwd, enabled, refreshKey])

  return { branch, loading, error, refresh, idle }
}
```

- [ ] **Step 4: Run the test — it should pass**

```bash
npx vitest run src/features/diff/hooks/useGitBranch.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 5: Run full lint + type-check to confirm the hook integrates cleanly**

```bash
npm run lint && npm run type-check
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/diff/hooks/useGitBranch.ts src/features/diff/hooks/useGitBranch.test.ts
git commit -m "feat(diff): add useGitBranch hook for current-branch label"
```

---

## Phase 2 — Refactor `TerminalPane.tsx` → `TerminalPane/Body.tsx` (verbatim move)

This is a structural move only. No behavior changes. After this phase, the visual UI is unchanged. We're just relocating the existing xterm wiring into the new folder so we have somewhere to attach chrome in Phase 3.

### Task 2.1: Move `TerminalPane.tsx` into `TerminalPane/Body.tsx`

**Files:**

- Create: `src/features/terminal/components/TerminalPane/Body.tsx`
- Create: `src/features/terminal/components/TerminalPane/index.tsx`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p src/features/terminal/components/TerminalPane
```

- [ ] **Step 2: Read the current `TerminalPane.tsx` so you have its exact content available**

```bash
cat src/features/terminal/components/TerminalPane.tsx > /tmp/terminal-pane-snapshot.tsx
wc -l /tmp/terminal-pane-snapshot.tsx
```

Expected: ~382 lines.

- [ ] **Step 3: Create `Body.tsx` by copying the current `TerminalPane.tsx`, then rewriting imports + renaming the exported component**

Copy the contents to `src/features/terminal/components/TerminalPane/Body.tsx`. Two non-trivial fixups are required because the file moved one directory deeper:

**3a — Rewrite relative imports.** Every `../*` import in the original was relative to `src/features/terminal/components/`. From the new location `src/features/terminal/components/TerminalPane/`, each needs an extra `../`:

| Original import in `TerminalPane.tsx`                       | Becomes in `TerminalPane/Body.tsx`      |
| ----------------------------------------------------------- | --------------------------------------- |
| `from '../theme/catppuccin-mocha'`                          | `from '../../theme/catppuccin-mocha'`   |
| `from '../hooks/useTerminal'`                               | `from '../../hooks/useTerminal'`        |
| `from '../services/terminalService'`                        | `from '../../services/terminalService'` |
| `from '../ptySessionMap'`                                   | `from '../../ptySessionMap'`            |
| Any other `../<file>` referring to a sibling of components/ | Add one more `../`                      |

`@xterm/...` and other non-relative imports stay unchanged. Verify with:

```bash
grep -nE "^import .* from '\\.\\." src/features/terminal/components/TerminalPane/Body.tsx
```

Expected: every relative import begins with `'../../'` (or deeper).

**3b — Rename the exports.**

- The component name `TerminalPane` → `Body`
- The exported props interface `TerminalPaneProps` → `BodyProps`
- Keep all module-scope exports (`terminalCache`, `clearTerminalCache`, `disposeTerminalSession`, `TerminalPaneMode`)

For Phase 2 keep the awaiting-restart fallback in Body so tests pass with minimal modification — Phase 3 (Task 3.7) narrows `BodyProps.mode` to `'attach' | 'spawn'` and the awaiting-restart fast-path moves up to `index.tsx`.

```ts
// src/features/terminal/components/TerminalPane/Body.tsx
//
// Copy of src/features/terminal/components/TerminalPane.tsx with:
//   1. Relative imports rewritten one level deeper (`../` → `../../`).
//   2. `export const TerminalPane = ...` renamed to `export const Body = ...`.
//   3. `export interface TerminalPaneProps {` renamed to `export interface BodyProps {`.
//   4. Internal references `TerminalPane` → `Body`, `TerminalPaneProps` → `BodyProps`.
// xterm + PTY wiring unchanged.
```

- [ ] **Step 4: Create `index.tsx` as a thin pass-through re-export**

```ts
// src/features/terminal/components/TerminalPane/index.tsx
//
// Phase 2 stub: re-exports Body as TerminalPane so existing imports keep
// working. Phase 3 replaces this stub with the full chrome composition.

import type { ReactElement } from 'react'
import { Body, type BodyProps } from './Body'

export { terminalCache, clearTerminalCache, disposeTerminalSession } from './Body'
export type { BodyProps as TerminalPaneProps } from './Body'
export type TerminalPaneMode = BodyProps['mode']

export const TerminalPane = (props: BodyProps): ReactElement => <Body {...props} />
```

- [ ] **Step 5: Type-check**

```bash
npm run type-check
```

Expected: clean. If error, double-check the `BodyProps` rename was complete inside `Body.tsx`.

---

### Task 2.2: Move `TerminalPane.test.tsx` → `TerminalPane/Body.test.tsx`

**Files:**

- Create: `src/features/terminal/components/TerminalPane/Body.test.tsx`

- [ ] **Step 1: Copy `TerminalPane.test.tsx` to `TerminalPane/Body.test.tsx`**

```bash
cp src/features/terminal/components/TerminalPane.test.tsx \
   src/features/terminal/components/TerminalPane/Body.test.tsx
```

- [ ] **Step 2: Rewrite imports + renames inside `Body.test.tsx`**

Same dual fix as `Body.tsx` (Task 2.1 Step 3): rewrite relative imports one level deeper AND rename `TerminalPane` → `Body`. Common patterns:

| Original                                                       | Becomes                                        |
| -------------------------------------------------------------- | ---------------------------------------------- |
| `from './TerminalPane'`                                        | `from './Body'`                                |
| `from '../services/terminalService'`                           | `from '../../services/terminalService'`        |
| `from '../hooks/useTerminal'`                                  | `from '../../hooks/useTerminal'`               |
| `from '../theme/...'`                                          | `from '../../theme/...'`                       |
| `from '../ptySessionMap'`                                      | `from '../../ptySessionMap'`                   |
| `import { TerminalPane, terminalCache } from './TerminalPane'` | `import { Body, terminalCache } from './Body'` |
| `<TerminalPane ... />` (JSX)                                   | `<Body ... />`                                 |

For Phase 2, leave awaiting-restart cases in if Body still accepts that mode — they pass as-is. Phase 3 Task 3.11 splits them into `index.test.tsx` + `RestartAffordance.test.tsx`.

- [ ] **Step 3: Run the moved tests**

```bash
npx vitest run src/features/terminal/components/TerminalPane/Body.test.tsx
```

Expected: same number of tests passing as the original `TerminalPane.test.tsx`.

---

### Task 2.3: Delete the old files + verify everything still passes

**Files:**

- Delete: `src/features/terminal/components/TerminalPane.tsx`
- Delete: `src/features/terminal/components/TerminalPane.test.tsx`

- [ ] **Step 1: Delete the old files**

```bash
git rm src/features/terminal/components/TerminalPane.tsx \
       src/features/terminal/components/TerminalPane.test.tsx
```

- [ ] **Step 2: Type-check (consumers should resolve to `TerminalPane/index.tsx` automatically)**

```bash
npm run type-check
```

Expected: clean. `TerminalZone.tsx`'s `import { TerminalPane, type TerminalPaneMode } from '../../terminal/components/TerminalPane'` resolves to `TerminalPane/index.tsx`.

- [ ] **Step 3: Run the full test suite**

```bash
npm run test
```

Expected: all tests pass. Coverage may shift slightly; the **count** of TerminalPane tests should match pre-move.

- [ ] **Step 4: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 5: Commit**

The deletes from Step 1 are already staged (`git rm` updates the index). Just add the new directory and commit:

```bash
git add src/features/terminal/components/TerminalPane/
git status --short    # confirm: D for old files, A for new TerminalPane/* files
git commit -m "refactor(terminal): split TerminalPane.tsx into TerminalPane/ folder"
```

---

## Phase 3 — Wire chrome (Header, Footer, useFocusedPane, RestartAffordance)

This is the visual + behavioral phase. After Phase 3, the pane matches handoff §4.6.

### Task 3.1: `ptyStatusToSessionStatus` pure util

**Files:**

- Create: `src/features/terminal/components/TerminalPane/ptyStatusToSessionStatus.ts`
- Create: `src/features/terminal/components/TerminalPane/ptyStatusToSessionStatus.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/features/terminal/components/TerminalPane/ptyStatusToSessionStatus.test.ts
import { describe, expect, test } from 'vitest'
import { ptyStatusToSessionStatus } from './ptyStatusToSessionStatus'

describe('ptyStatusToSessionStatus', () => {
  test('idle → paused', () => {
    expect(ptyStatusToSessionStatus('idle')).toBe('paused')
  })
  test('running → running', () => {
    expect(ptyStatusToSessionStatus('running')).toBe('running')
  })
  test('exited → completed', () => {
    expect(ptyStatusToSessionStatus('exited')).toBe('completed')
  })
  test('error → errored', () => {
    expect(ptyStatusToSessionStatus('error')).toBe('errored')
  })
})
```

- [ ] **Step 2: Run the test — it should fail**

```bash
npx vitest run src/features/terminal/components/TerminalPane/ptyStatusToSessionStatus.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/features/terminal/components/TerminalPane/ptyStatusToSessionStatus.ts
import type { SessionStatus } from '../../../sessions/types'

export type PtyStatus = 'idle' | 'running' | 'exited' | 'error'

export const ptyStatusToSessionStatus = (status: PtyStatus): SessionStatus => {
  switch (status) {
    case 'running':
      return 'running'
    case 'exited':
      return 'completed'
    case 'error':
      return 'errored'
    case 'idle':
    default:
      return 'paused'
  }
}
```

- [ ] **Step 4: Run the test — it should pass**

```bash
npx vitest run src/features/terminal/components/TerminalPane/ptyStatusToSessionStatus.test.ts
```

Expected: all 4 tests pass.

---

### Task 3.2: `aggregateLineDelta` pure util

**Files:**

- Create: `src/features/terminal/components/TerminalPane/aggregateLineDelta.ts`
- Create: `src/features/terminal/components/TerminalPane/aggregateLineDelta.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/features/terminal/components/TerminalPane/aggregateLineDelta.test.ts
import { describe, expect, test } from 'vitest'
import { aggregateLineDelta } from './aggregateLineDelta'
import type { ChangedFile } from '../../../diff/types'

describe('aggregateLineDelta', () => {
  test('empty array → 0/0', () => {
    expect(aggregateLineDelta([])).toEqual({ added: 0, removed: 0 })
  })

  test('sums insertions + deletions across files', () => {
    const files: ChangedFile[] = [
      {
        path: 'a.ts',
        status: 'modified',
        insertions: 10,
        deletions: 3,
        staged: false,
      },
      {
        path: 'b.ts',
        status: 'modified',
        insertions: 5,
        deletions: 1,
        staged: true,
      },
      {
        path: 'c.ts',
        status: 'untracked',
        insertions: 20,
        deletions: 0,
        staged: false,
      },
    ]
    expect(aggregateLineDelta(files)).toEqual({ added: 35, removed: 4 })
  })

  test('treats undefined insertions/deletions as 0', () => {
    const files: ChangedFile[] = [
      { path: 'a.ts', status: 'modified', staged: false },
      { path: 'b.ts', status: 'modified', insertions: 7, staged: true },
    ]
    expect(aggregateLineDelta(files)).toEqual({ added: 7, removed: 0 })
  })
})
```

- [ ] **Step 2: Run the test — it should fail**

```bash
npx vitest run src/features/terminal/components/TerminalPane/aggregateLineDelta.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/features/terminal/components/TerminalPane/aggregateLineDelta.ts
import type { ChangedFile } from '../../../diff/types'

export interface LineDelta {
  added: number
  removed: number
}

export const aggregateLineDelta = (files: ChangedFile[]): LineDelta =>
  files.reduce(
    (acc, f) => ({
      added: acc.added + (f.insertions ?? 0),
      removed: acc.removed + (f.deletions ?? 0),
    }),
    { added: 0, removed: 0 }
  )
```

- [ ] **Step 4: Run the test — it should pass**

```bash
npx vitest run src/features/terminal/components/TerminalPane/aggregateLineDelta.test.ts
```

Expected: all 3 tests pass.

---

### Task 3.3: `useFocusedPane` hook

**Files:**

- Create: `src/features/terminal/components/TerminalPane/useFocusedPane.ts`
- Create: `src/features/terminal/components/TerminalPane/useFocusedPane.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/features/terminal/components/TerminalPane/useFocusedPane.test.ts
import { renderHook, act } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { useRef } from 'react'
import { useFocusedPane } from './useFocusedPane'

const setup = (initial = false) =>
  renderHook(() => {
    const ref = useRef<HTMLDivElement | null>(null)
    const node = document.createElement('div')
    Object.defineProperty(node, 'offsetWidth', { value: 100 })
    document.body.appendChild(node)
    ref.current = node
    return useFocusedPane({ containerRef: ref, initial })
  })

describe('useFocusedPane', () => {
  test('initial state defaults to false', () => {
    const { result } = setup()
    expect(result.current.isFocused).toBe(false)
  })

  test('initial=true starts focused', () => {
    const { result } = setup(true)
    expect(result.current.isFocused).toBe(true)
  })

  test('setFocused(true) updates state', () => {
    const { result } = setup()
    act(() => result.current.setFocused(true))
    expect(result.current.isFocused).toBe(true)
  })

  test('onTerminalFocusChange mirrors xterm focus events', () => {
    const { result } = setup()
    act(() => result.current.onTerminalFocusChange(true))
    expect(result.current.isFocused).toBe(true)
    act(() => result.current.onTerminalFocusChange(false))
    expect(result.current.isFocused).toBe(false)
  })

  test('mousedown outside container blurs the pane', () => {
    const { result } = setup(true)
    expect(result.current.isFocused).toBe(true)
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    act(() => {
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(result.current.isFocused).toBe(false)
  })

  test('mousedown inside container does not blur', () => {
    const containerNode = document.createElement('div')
    Object.defineProperty(containerNode, 'offsetWidth', { value: 100 })
    document.body.appendChild(containerNode)
    const child = document.createElement('span')
    containerNode.appendChild(child)

    const { result } = renderHook(() => {
      const ref = useRef<HTMLElement | null>(containerNode)
      return useFocusedPane({ containerRef: ref, initial: true })
    })
    expect(result.current.isFocused).toBe(true)
    act(() => {
      child.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(result.current.isFocused).toBe(true)
  })

  test('offsetWidth === 0 short-circuits the outside-click handler', () => {
    const hidden = document.createElement('div')
    Object.defineProperty(hidden, 'offsetWidth', { value: 0 })
    document.body.appendChild(hidden)

    const { result } = renderHook(() => {
      const ref = useRef<HTMLElement | null>(hidden)
      return useFocusedPane({ containerRef: ref, initial: true })
    })

    const outside = document.createElement('button')
    document.body.appendChild(outside)
    act(() => {
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(result.current.isFocused).toBe(true) // hidden pane: no blur
  })

  test('removes mousedown listener on unmount', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const { unmount } = setup()
    unmount()
    expect(removeSpy).toHaveBeenCalledWith('mousedown', expect.any(Function))
  })
})
```

- [ ] **Step 2: Run the test — it should fail**

```bash
npx vitest run src/features/terminal/components/TerminalPane/useFocusedPane.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/features/terminal/components/TerminalPane/useFocusedPane.ts
import { useCallback, useEffect, useState } from 'react'
import type { RefObject } from 'react'

export interface UseFocusedPaneOptions {
  containerRef: RefObject<HTMLElement | null>
  initial?: boolean
}

export interface UseFocusedPaneReturn {
  isFocused: boolean
  setFocused: (next: boolean) => void
  onTerminalFocusChange: (focused: boolean) => void
}

export const useFocusedPane = ({
  containerRef,
  initial = false,
}: UseFocusedPaneOptions): UseFocusedPaneReturn => {
  const [isFocused, setIsFocused] = useState(initial)

  const onTerminalFocusChange = useCallback((focused: boolean): void => {
    setIsFocused(focused)
  }, [])

  useEffect(() => {
    const onMouseDown = (e: MouseEvent): void => {
      const node = containerRef.current
      if (!node) return
      if (node.offsetWidth === 0) return
      const target = e.target as Node | null
      if (target && !node.contains(target)) {
        setIsFocused(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return (): void => {
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [containerRef])

  return {
    isFocused,
    setFocused: setIsFocused,
    onTerminalFocusChange,
  }
}
```

- [ ] **Step 4: Run the test — it should pass**

```bash
npx vitest run src/features/terminal/components/TerminalPane/useFocusedPane.test.ts
```

Expected: all 8 tests pass (initial=false, initial=true, setFocused, onTerminalFocusChange, mousedown-outside-blurs, mousedown-inside-no-blur, offsetWidth-zero-short-circuit, listener-cleanup-on-unmount).

---

### Task 3.4: `Footer.tsx`

**Files:**

- Create: `src/features/terminal/components/TerminalPane/Footer.tsx`
- Create: `src/features/terminal/components/TerminalPane/Footer.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/terminal/components/TerminalPane/Footer.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { Footer } from './Footer'
import { AGENTS } from '../../../../agents/registry'

const baseProps = {
  agent: AGENTS.claude,
  pipStatus: 'running' as const,
  isFocused: false,
  isPaused: false,
  onClickFocus: vi.fn(),
}

describe('Footer', () => {
  test('renders agent-accent `>` glyph', () => {
    render(<Footer {...baseProps} />)
    expect(screen.getByText('>')).toBeInTheDocument()
  })

  test('input is readOnly + tabIndex={-1} + aria-hidden', () => {
    render(<Footer {...baseProps} />)
    const input = screen.getByDisplayValue('') as HTMLInputElement
    expect(input).toHaveAttribute('readonly')
    expect(input).toHaveAttribute('tabindex', '-1')
    expect(input).toHaveAttribute('aria-hidden', 'true')
  })

  test('placeholder when blurred shows click-to-focus cue', () => {
    render(<Footer {...baseProps} isFocused={false} />)
    const input = screen.getByPlaceholderText(/click to focus claude/i)
    expect(input).toBeInTheDocument()
  })

  test('placeholder when focused + paused shows "paused"', () => {
    render(<Footer {...baseProps} isFocused isPaused pipStatus="paused" />)
    expect(screen.getByPlaceholderText('paused')).toBeInTheDocument()
  })

  test('placeholder when focused + running shows "message claude..."', () => {
    render(<Footer {...baseProps} isFocused />)
    expect(screen.getByPlaceholderText(/message claude/i)).toBeInTheDocument()
  })

  test('placeholder override replaces derivation', () => {
    render(
      <Footer
        {...baseProps}
        placeholder="session ended — restart to resume claude"
      />
    )
    expect(screen.getByPlaceholderText(/session ended/i)).toBeInTheDocument()
  })

  test('clicking footer container fires onClickFocus', () => {
    const onClickFocus = vi.fn()
    render(<Footer {...baseProps} onClickFocus={onClickFocus} />)
    fireEvent.click(screen.getByTestId('terminal-pane-footer'))
    expect(onClickFocus).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test — it should fail**

```bash
npx vitest run src/features/terminal/components/TerminalPane/Footer.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// src/features/terminal/components/TerminalPane/Footer.tsx
import type { ReactElement } from 'react'
import type { Agent } from '../../../../agents/registry'
import type { SessionStatus } from '../../../sessions/types'
import { StatusDot } from '../../../sessions/components/StatusDot'

export interface FooterProps {
  agent: Agent
  pipStatus: SessionStatus
  isFocused: boolean
  isPaused: boolean
  onClickFocus: () => void
  /**
   * Optional placeholder override. When set, replaces the internal
   * focused/paused/blurred derivation. `index.tsx` uses this for
   * awaiting-restart panes.
   */
  placeholder?: string
}

const derivePlaceholder = (
  agent: Agent,
  isFocused: boolean,
  isPaused: boolean
): string => {
  if (!isFocused) return `click to focus ${agent.short.toLowerCase()}`
  if (isPaused) return 'paused'
  return `message ${agent.short.toLowerCase()}...`
}

export const Footer = ({
  agent,
  pipStatus,
  isFocused,
  isPaused,
  onClickFocus,
  placeholder,
}: FooterProps): ReactElement => {
  const text = placeholder ?? derivePlaceholder(agent, isFocused, isPaused)

  return (
    <div
      data-testid="terminal-pane-footer"
      onClick={onClickFocus}
      className="flex shrink-0 items-center gap-2 border-t border-outline-variant/20 bg-surface-container-lowest/55 px-3.5 py-1.5 font-mono text-[11px]"
    >
      <StatusDot status={pipStatus} size={6} aria-label={`pty ${pipStatus}`} />
      <span style={{ color: agent.accent }}>{'>'}</span>
      <input
        readOnly
        tabIndex={-1}
        aria-hidden="true"
        value=""
        placeholder={text}
        className="flex-1 border-0 bg-transparent text-on-surface outline-none"
      />
    </div>
  )
}
```

- [ ] **Step 4: Run the test — it should pass**

```bash
npx vitest run src/features/terminal/components/TerminalPane/Footer.test.tsx
```

Expected: all 7 tests pass.

---

### Task 3.5: `Header.tsx`

**Files:**

- Create: `src/features/terminal/components/TerminalPane/Header.tsx`
- Create: `src/features/terminal/components/TerminalPane/Header.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/terminal/components/TerminalPane/Header.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { Header } from './Header'
import { AGENTS } from '../../../../agents/registry'
import type { Session } from '../../../sessions/types'

const session: Session = {
  id: 's1',
  projectId: 'p1',
  name: 'auth refactor',
  status: 'running',
  workingDirectory: '/home/user/repo',
  agentType: 'claude-code',
  createdAt: '2026-05-08T10:00:00Z',
  lastActivityAt: '2026-05-08T11:55:00Z',
  activity: {
    fileChanges: [],
    toolCalls: [],
    testResults: [],
    contextWindow: { used: 0, total: 200000, percentage: 0, emoji: '😊' },
    usage: {
      sessionDuration: 0,
      turnCount: 0,
      messages: { sent: 0, limit: 200 },
      tokens: { input: 0, output: 0, total: 0 },
    },
  },
}

const baseProps = {
  agent: AGENTS.claude,
  session,
  pipStatus: 'running' as const,
  branch: 'feat/jose-auth',
  added: 48,
  removed: 12,
  isFocused: true,
  isCollapsed: false,
  onToggleCollapse: vi.fn(),
}

describe('Header', () => {
  test('renders agent chip with short name + glyph', () => {
    render(<Header {...baseProps} />)
    expect(screen.getByText('CLAUDE')).toBeInTheDocument()
    expect(screen.getByText('∴')).toBeInTheDocument()
  })

  test('renders pane title from session.name', () => {
    render(<Header {...baseProps} />)
    expect(screen.getByText('auth refactor')).toBeInTheDocument()
  })

  test('expanded header shows branch + added + removed', () => {
    render(<Header {...baseProps} />)
    expect(screen.getByText('feat/jose-auth')).toBeInTheDocument()
    expect(screen.getByText('+48')).toBeInTheDocument()
    expect(screen.getByText('−12')).toBeInTheDocument()
  })

  test('collapsed header hides branch + added + removed + relative-time', () => {
    render(<Header {...baseProps} isCollapsed />)
    expect(screen.queryByText('feat/jose-auth')).not.toBeInTheDocument()
    expect(screen.queryByText('+48')).not.toBeInTheDocument()
  })

  test('null branch omits the branch segment', () => {
    render(<Header {...baseProps} branch={null} />)
    expect(screen.queryByText('feat/jose-auth')).not.toBeInTheDocument()
  })

  test('collapse button fires onToggleCollapse', () => {
    const onToggleCollapse = vi.fn()
    render(<Header {...baseProps} onToggleCollapse={onToggleCollapse} />)
    fireEvent.click(screen.getByRole('button', { name: /collapse status/i }))
    expect(onToggleCollapse).toHaveBeenCalledTimes(1)
  })

  test('close button rendered only when onClose is defined', () => {
    const onClose = vi.fn()
    const { rerender } = render(<Header {...baseProps} />)
    expect(screen.queryByRole('button', { name: /close pane/i })).toBeNull()
    rerender(<Header {...baseProps} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: /close pane/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('focused state applies header gradient', () => {
    render(<Header {...baseProps} isFocused />)
    const header = screen.getByTestId('terminal-pane-header')
    expect(header).toHaveAttribute('data-focused', 'true')
  })
})
```

- [ ] **Step 2: Run the test — it should fail**

```bash
npx vitest run src/features/terminal/components/TerminalPane/Header.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// src/features/terminal/components/TerminalPane/Header.tsx
import type { ReactElement } from 'react'
import type { Agent } from '../../../../agents/registry'
import type { Session, SessionStatus } from '../../../sessions/types'
import { StatusDot } from '../../../sessions/components/StatusDot'
import { formatRelativeTime } from '../../../agent-status/utils/relativeTime'

export interface HeaderProps {
  agent: Agent
  session: Session
  pipStatus: SessionStatus
  branch: string | null
  added: number
  removed: number
  isFocused: boolean
  isCollapsed: boolean
  onToggleCollapse: () => void
  onClose?: () => void
}

export const Header = ({
  agent,
  session,
  pipStatus,
  branch,
  added,
  removed,
  isFocused,
  isCollapsed,
  onToggleCollapse,
  onClose,
}: HeaderProps): ReactElement => {
  const headerStyle = isFocused
    ? {
        background: `linear-gradient(180deg, ${agent.accentDim}, rgba(13,13,28,0.0))`,
      }
    : { background: 'transparent' }

  return (
    <div
      data-testid="terminal-pane-header"
      data-focused={isFocused || undefined}
      data-collapsed={isCollapsed || undefined}
      style={headerStyle}
      className={`flex shrink-0 select-none items-center gap-2.5 border-b border-outline-variant/[0.18] font-mono text-[10.5px] ${
        isCollapsed ? 'px-2.5 py-1.5' : 'pb-2 pl-2.5 pr-3 pt-2'
      }`}
    >
      {/* Agent identity chip */}
      <div
        className="inline-flex items-center gap-1.5 rounded-md border px-2 py-[3px] font-semibold tracking-[0.04em]"
        style={{
          background: agent.accentDim,
          borderColor: agent.accentSoft,
          color: agent.accent,
        }}
      >
        <span className="text-[12px]" aria-hidden="true">
          {agent.glyph}
        </span>
        <span>{agent.short}</span>
      </div>

      {/* State pip + title */}
      <StatusDot status={pipStatus} size={6} aria-label={`pty ${pipStatus}`} />
      <span className="text-on-surface">{session.name}</span>

      {/* Expanded-only metadata */}
      {!isCollapsed && (
        <>
          {branch && (
            <>
              <span className="text-outline-variant/60">·</span>
              <span className="text-on-surface-muted">{branch}</span>
            </>
          )}
          <span className="text-outline-variant/60">·</span>
          <span className="text-success">+{added}</span>
          <span className="text-error">−{removed}</span>
          <span className="text-outline-variant/60">·</span>
          <span className="text-on-surface-muted">
            {formatRelativeTime(session.lastActivityAt)}
          </span>
        </>
      )}

      <span className="flex-1" />

      <button
        type="button"
        aria-label={isCollapsed ? 'expand status' : 'collapse status'}
        onClick={(e) => {
          e.stopPropagation()
          onToggleCollapse()
        }}
        className="inline-flex h-[22px] w-[22px] items-center justify-center rounded border-0 bg-transparent"
      >
        <span
          className="material-symbols-outlined text-[13px] text-on-surface-muted"
          aria-hidden="true"
        >
          {isCollapsed ? 'unfold_more' : 'unfold_less'}
        </span>
      </button>
      {onClose && (
        <button
          type="button"
          aria-label="close pane"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          className="inline-flex h-[22px] w-[22px] items-center justify-center rounded border-0 bg-transparent"
        >
          <span
            className="material-symbols-outlined text-[13px] text-on-surface-muted"
            aria-hidden="true"
          >
            close
          </span>
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run the test — it should pass**

```bash
npx vitest run src/features/terminal/components/TerminalPane/Header.test.tsx
```

Expected: all 8 tests pass.

---

### Task 3.6: `RestartAffordance.tsx`

**Files:**

- Create: `src/features/terminal/components/TerminalPane/RestartAffordance.tsx`
- Create: `src/features/terminal/components/TerminalPane/RestartAffordance.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/terminal/components/TerminalPane/RestartAffordance.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { RestartAffordance } from './RestartAffordance'
import { AGENTS } from '../../../../agents/registry'

const baseProps = {
  agent: AGENTS.claude,
  sessionId: 's1',
  exitedAt: '2026-05-08T11:00:00Z',
  onRestart: vi.fn(),
}

describe('RestartAffordance', () => {
  test('renders "Session exited." title', () => {
    render(<RestartAffordance {...baseProps} />)
    expect(screen.getByText('Session exited.')).toBeInTheDocument()
  })

  test('renders restart button with aria-label', () => {
    render(<RestartAffordance {...baseProps} />)
    expect(
      screen.getByRole('button', { name: /restart session s1/i })
    ).toBeInTheDocument()
  })

  test('clicking restart fires onRestart with sessionId', () => {
    const onRestart = vi.fn()
    render(<RestartAffordance {...baseProps} onRestart={onRestart} />)
    fireEvent.click(screen.getByRole('button', { name: /restart session/i }))
    expect(onRestart).toHaveBeenCalledWith('s1')
  })

  test('renders relative-time string', () => {
    render(<RestartAffordance {...baseProps} />)
    // matches "ended Xm ago" or "ended Xh ago" etc.
    expect(screen.getByText(/ended/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test — it should fail**

```bash
npx vitest run src/features/terminal/components/TerminalPane/RestartAffordance.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// src/features/terminal/components/TerminalPane/RestartAffordance.tsx
import type { ReactElement } from 'react'
import type { Agent } from '../../../../agents/registry'
import { formatRelativeTime } from '../../../agent-status/utils/relativeTime'

export interface RestartAffordanceProps {
  agent: Agent
  sessionId: string
  exitedAt: string
  onRestart: (sessionId: string) => void
}

export const RestartAffordance = ({
  agent,
  sessionId,
  exitedAt,
  onRestart,
}: RestartAffordanceProps): ReactElement => (
  <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-surface text-on-surface/70">
    <p className="font-mono text-sm">Session exited.</p>
    <button
      type="button"
      aria-label={`Restart session ${sessionId}`}
      onClick={() => onRestart(sessionId)}
      className="rounded-pill bg-surface-container px-3 py-1.5 font-label text-sm text-on-surface hover:bg-surface-container/80 focus-visible:outline focus-visible:outline-2"
      style={{ outlineColor: agent.accent }}
    >
      <span
        className="material-symbols-outlined mr-1 text-[14px]"
        aria-hidden="true"
      >
        restart_alt
      </span>
      Restart
    </button>
    <span className="text-xs text-on-surface/50">
      ended {formatRelativeTime(exitedAt)}
    </span>
  </div>
)
```

- [ ] **Step 4: Run the test — it should pass**

```bash
npx vitest run src/features/terminal/components/TerminalPane/RestartAffordance.test.tsx
```

Expected: all 4 tests pass.

---

### Task 3.7: Update `Body.tsx` for `forwardRef` + `onPtyStatusChange` + `onFocusChange`

**Files:**

- Modify: `src/features/terminal/components/TerminalPane/Body.tsx`
- Modify: `src/features/terminal/components/TerminalPane/Body.test.tsx`

- [ ] **Step 1: Read the current Body.tsx**

```bash
sed -n '1,50p' src/features/terminal/components/TerminalPane/Body.tsx
```

Confirm the existing `BodyProps` interface and component shape.

- [ ] **Step 2: Add the new test cases**

Append to `Body.test.tsx`. Mirror the existing render harness — same `MockTerminalService` instance, same `await waitFor` patterns the file already uses.

```tsx
import { createRef } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { MockTerminalService } from '../../services/terminalService'
import { Body, terminalCache, type BodyHandle } from './Body'

// (Existing tests in this file already cover lifecycle / OSC 7 / resize.
// These three add the new chrome-bridge contracts.)

test('emits onPtyStatusChange when PTY transitions to running', async () => {
  const service = new MockTerminalService()
  const onPtyStatusChange = vi.fn()
  render(
    <Body
      sessionId="s-status"
      cwd="/tmp"
      service={service}
      mode="spawn"
      onPtyStatusChange={onPtyStatusChange}
    />
  )

  // MockTerminalService.spawn resolves after a 100ms setTimeout that
  // emits the initial '$ ' prompt; useTerminal flips status to 'running'
  // synchronously after the spawn promise resolves.
  await waitFor(() => {
    expect(onPtyStatusChange).toHaveBeenCalledWith('running')
  })
})

test('useImperativeHandle exposes focusTerminal that focuses the cached xterm', async () => {
  const service = new MockTerminalService()
  const ref = createRef<BodyHandle>()
  render(
    <Body
      ref={ref}
      sessionId="s-focus"
      cwd="/tmp"
      service={service}
      mode="spawn"
    />
  )

  await waitFor(() => {
    expect(terminalCache.has('s-focus')).toBe(true)
  })
  const cached = terminalCache.get('s-focus')!
  const focusSpy = vi.spyOn(cached.terminal, 'focus')

  ref.current?.focusTerminal()
  expect(focusSpy).toHaveBeenCalledTimes(1)
})

test('emits onFocusChange when xterm gains/loses focus', async () => {
  const service = new MockTerminalService()
  const onFocusChange = vi.fn()
  render(
    <Body
      sessionId="s-fc"
      cwd="/tmp"
      service={service}
      mode="spawn"
      onFocusChange={onFocusChange}
    />
  )

  await waitFor(() => expect(terminalCache.has('s-fc')).toBe(true))
  const cached = terminalCache.get('s-fc')!

  // xterm 6 exposes `onFocus` / `onBlur` event registrars. Body's setup
  // effect attaches handlers to both; firing the registrar's underlying
  // emitter is xterm-version specific. The pragmatic test path is to
  // capture the registered handlers via spies on the registrars themselves.
  // Adapt to whichever pattern the existing test file uses for xterm
  // event verification (search for `.onFocus(` or `.onBlur(` in
  // Body.test.tsx for the established convention).
  //
  // Minimum assertion: handlers are attached. Full assertion: invoking
  // each handler flips onFocusChange.
  expect(typeof cached.terminal.onFocus).toBe('function')
  expect(typeof cached.terminal.onBlur).toBe('function')
})
```

(The third test acknowledges that fully exercising xterm focus events requires the project's existing xterm event-emit helper, which lives elsewhere in `Body.test.tsx`. If the existing test file doesn't have that helper, mark the third test `test.skip(...)` and lean on the manual verification gate in Task 3.12. Don't fake the assertion — a green test that proves nothing is worse than a skipped one.)

- [ ] **Step 3: Run the new test cases — they should fail**

```bash
npx vitest run src/features/terminal/components/TerminalPane/Body.test.tsx
```

Expected: 3 new tests fail; existing tests still pass.

- [ ] **Step 4: Modify `Body.tsx` to add the new props + ref handle**

Convert the named export to `forwardRef`:

```tsx
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'

// ... existing imports unchanged ...

export type BodyMode = 'attach' | 'spawn'

export interface BodyProps {
  // ... existing props ...
  mode: BodyMode

  /** New: PTY status change callback. */
  onPtyStatusChange?: (status: 'idle' | 'running' | 'exited' | 'error') => void

  /** New: xterm focus change callback. */
  onFocusChange?: (focused: boolean) => void
}

export interface BodyHandle {
  focusTerminal: () => void
}

export const Body = forwardRef<BodyHandle, BodyProps>(function Body(
  {
    sessionId,
    cwd,
    service,
    shell,
    env,
    restoredFrom,
    onCwdChange,
    onPaneReady,
    mode,
    onPtyStatusChange,
    onFocusChange,
  },
  ref
): ReactElement {
  // ... existing useTerminal + xterm setup ...

  // Stable refs for callback props (avoid recreating xterm on every render).
  const onPtyStatusChangeRef = useRef(onPtyStatusChange)
  const onFocusChangeRef = useRef(onFocusChange)
  useEffect(() => {
    onPtyStatusChangeRef.current = onPtyStatusChange
  }, [onPtyStatusChange])
  useEffect(() => {
    onFocusChangeRef.current = onFocusChange
  }, [onFocusChange])

  // Bridge useTerminal.status → onPtyStatusChange
  useEffect(() => {
    onPtyStatusChangeRef.current?.(status)
  }, [status])

  // Inside the xterm setup useEffect, after newTerminal is created:
  //
  //   const onFocusDisposable = newTerminal.onFocus(() =>
  //     onFocusChangeRef.current?.(true)
  //   )
  //   const onBlurDisposable = newTerminal.onBlur(() =>
  //     onFocusChangeRef.current?.(false)
  //   )
  //
  // and in the cleanup branch:
  //
  //   onFocusDisposable.dispose()
  //   onBlurDisposable.dispose()

  // Imperative handle for index.tsx → focusTerminal()
  useImperativeHandle(
    ref,
    () => ({
      focusTerminal: (): void => {
        const cached = terminalCache.get(sessionId)
        cached?.terminal.focus()
      },
    }),
    [sessionId]
  )

  return (
    <div
      data-testid="terminal-pane-wrapper"
      className="relative h-full w-full overflow-hidden"
    >
      <div
        ref={containerRef}
        data-testid="terminal-pane"
        data-session-id={sessionId}
        className="h-full w-full"
      />
    </div>
  )
})
```

(The ellipses `...` retain existing logic — focus changes are additive. Only add the new effects + handle; don't restructure the existing setup effect.)

- [ ] **Step 5: Re-run the tests — all pass**

```bash
npx vitest run src/features/terminal/components/TerminalPane/Body.test.tsx
```

Expected: all tests pass (existing + 3 new).

---

### Task 3.8: Update `index.tsx` to compose chrome around `Body` (the integration)

**Files:**

- Modify: `src/features/terminal/components/TerminalPane/index.tsx`

- [ ] **Step 1: Replace the Phase 2 stub with the real composition**

```tsx
// src/features/terminal/components/TerminalPane/index.tsx
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import type { ITerminalService } from '../../services/terminalService'
import type { RestoreData, NotifyPaneReady } from '../../hooks/useTerminal'
import type { Session, SessionStatus } from '../../../sessions/types'
import { agentForSession } from '../../../sessions/utils/agentForSession'
import { useGitBranch } from '../../../diff/hooks/useGitBranch'
import { useGitStatus } from '../../../diff/hooks/useGitStatus'
import { Body, type BodyHandle } from './Body'
import { Header } from './Header'
import { Footer } from './Footer'
import { RestartAffordance } from './RestartAffordance'
import { useFocusedPane } from './useFocusedPane'
import {
  ptyStatusToSessionStatus,
  type PtyStatus,
} from './ptyStatusToSessionStatus'
import { aggregateLineDelta } from './aggregateLineDelta'

export type TerminalPaneMode = 'attach' | 'spawn' | 'awaiting-restart'

export interface TerminalPaneProps {
  sessionId: string
  cwd: string
  service: ITerminalService
  shell?: string
  env?: Record<string, string>
  restoredFrom?: RestoreData
  onCwdChange?: (cwd: string) => void
  onPaneReady?: NotifyPaneReady
  mode?: TerminalPaneMode
  onRestart?: (sessionId: string) => void
  /** Session source for chrome (name, agentType, status, lastActivityAt). */
  session: Session
  /** Gates per-pane git IPC so hidden panes don't fire requests. */
  isActive: boolean
  /** Reserved for step 5; not wired in single-pane mode. */
  onClose?: (sessionId: string) => void
}

export {
  terminalCache,
  clearTerminalCache,
  disposeTerminalSession,
} from './Body'

export const TerminalPane = ({
  sessionId,
  cwd,
  service,
  shell,
  env,
  restoredFrom,
  onCwdChange,
  onPaneReady,
  mode = 'spawn',
  onRestart,
  session,
  isActive,
  onClose,
}: TerminalPaneProps): ReactElement => {
  const agent = agentForSession(session)
  const containerRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<BodyHandle>(null)

  const [ptyStatus, setPtyStatus] = useState<PtyStatus>('idle')
  const [isCollapsed, setIsCollapsed] = useState(false)

  const { isFocused, setFocused, onTerminalFocusChange } = useFocusedPane({
    containerRef,
  })

  const pipStatus: SessionStatus =
    mode === 'awaiting-restart'
      ? session.status
      : ptyStatusToSessionStatus(ptyStatus)

  const isPaused = pipStatus === 'paused'

  const { branch } = useGitBranch(session.workingDirectory, {
    enabled: isActive,
  })
  const { files, filesCwd } = useGitStatus(session.workingDirectory, {
    enabled: isActive,
  })
  const isFresh = filesCwd === session.workingDirectory
  const { added, removed } = useMemo(
    () => (isFresh ? aggregateLineDelta(files) : { added: 0, removed: 0 }),
    [files, isFresh]
  )

  const handleContainerClick = useCallback((): void => {
    bodyRef.current?.focusTerminal()
    setFocused(true)
  }, [setFocused])

  const isAwaitingRestart = mode === 'awaiting-restart'
  const footerPlaceholder = isAwaitingRestart
    ? `session ended — restart to resume ${agent.short.toLowerCase()}`
    : undefined

  // Outline + box-shadow + cursor swap on focus state.
  const containerStyle = isFocused
    ? {
        outline: `2px solid ${agent.accent}`,
        outlineOffset: -2,
        boxShadow: `0 0 0 6px ${agent.accentDim}, 0 8px 32px rgba(0,0,0,0.35)`,
        cursor: 'default' as const,
      }
    : {
        outline: `1px solid rgba(74,68,79,0.22)`,
        outlineOffset: -1,
        boxShadow: 'none',
        cursor: 'pointer' as const,
      }

  return (
    <div
      ref={containerRef}
      data-testid="terminal-pane-wrapper"
      data-session-id={session.id}
      data-mode={mode}
      data-focused={isFocused || undefined}
      onClick={handleContainerClick}
      style={{
        ...containerStyle,
        background: '#121221',
        borderRadius: 10,
        transition:
          'outline-color 180ms ease, box-shadow 220ms ease, opacity 220ms ease',
      }}
      className="relative flex h-full w-full flex-col overflow-hidden"
    >
      <Header
        agent={agent}
        session={session}
        pipStatus={pipStatus}
        branch={branch}
        added={added}
        removed={removed}
        isFocused={isFocused}
        isCollapsed={isCollapsed}
        onToggleCollapse={() => setIsCollapsed((c) => !c)}
        onClose={onClose ? () => onClose(session.id) : undefined}
      />

      {isAwaitingRestart ? (
        <RestartAffordance
          agent={agent}
          sessionId={session.id}
          exitedAt={session.lastActivityAt}
          onRestart={onRestart ?? (() => {})}
        />
      ) : (
        <div className="relative min-h-0 flex-1">
          <Body
            ref={bodyRef}
            sessionId={sessionId}
            cwd={cwd}
            service={service}
            shell={shell}
            env={env}
            restoredFrom={restoredFrom}
            onCwdChange={onCwdChange}
            onPaneReady={onPaneReady}
            mode={mode}
            onPtyStatusChange={setPtyStatus}
            onFocusChange={onTerminalFocusChange}
          />
        </div>
      )}

      <Footer
        agent={agent}
        pipStatus={pipStatus}
        isFocused={isFocused}
        isPaused={isPaused}
        onClickFocus={handleContainerClick}
        placeholder={footerPlaceholder}
      />
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npm run type-check
```

Expected: clean. If errors, double-check `BodyProps.mode` accepts the parent's `TerminalPaneMode` (it should — `BodyMode` is the narrower `'attach' | 'spawn'`, and the awaiting-restart branch routes around Body so Body never receives that case at runtime; TS may complain about the type being wider than `BodyMode`. If so, narrow at the call site: `mode: mode as 'attach' | 'spawn'`).

---

### Task 3.9: Update `TerminalZone.tsx` to pass `session` + `isActive`

**Files:**

- Modify: `src/features/workspace/components/TerminalZone.tsx`

- [ ] **Step 1: Locate the `<TerminalPane>` JSX**

```bash
grep -n "<TerminalPane" src/features/workspace/components/TerminalZone.tsx
```

Expected: line ~141.

- [ ] **Step 2: Add `session` + `isActive` props**

Inside the existing `<TerminalPane ... />` element, after the existing props, add:

```tsx
session = { session }
isActive = { isActive }
```

(`isActive` is already a local in the same `sessions.map(...)` body — see line ~85. No new variable needed.)

- [ ] **Step 3: Type-check**

```bash
npm run type-check
```

Expected: clean.

- [ ] **Step 4: Run the existing TerminalZone tests**

```bash
npx vitest run src/features/workspace/components/TerminalZone.test.tsx
```

Expected: pass. If fixture-based, may need to update test fixtures to include `session` and `isActive` in the props they render with. Update by mirroring real `TerminalZone` behavior.

---

### Task 3.10: Add `index.test.tsx` (composition + mode-branch tests)

**Files:**

- Create: `src/features/terminal/components/TerminalPane/index.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// src/features/terminal/components/TerminalPane/index.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { TerminalPane } from './index'
import type { Session } from '../../../sessions/types'

// Mock Body so chrome tests don't pull in xterm/jsdom complexity.
vi.mock('./Body', async () => {
  const React = await import('react')
  const Body = React.forwardRef<{ focusTerminal: () => void }, unknown>(
    function MockBody(_, ref): ReturnType<typeof React.createElement> {
      React.useImperativeHandle(ref, () => ({
        focusTerminal: vi.fn(),
      }))
      return React.createElement('div', { 'data-testid': 'body-mock' })
    }
  )
  return {
    Body,
    terminalCache: new Map(),
    clearTerminalCache: vi.fn(),
    disposeTerminalSession: vi.fn(),
  }
})

vi.mock('../../../diff/hooks/useGitBranch', () => ({
  useGitBranch: () => ({
    branch: 'main',
    loading: false,
    error: null,
    refresh: vi.fn(),
    idle: false,
  }),
}))
vi.mock('../../../diff/hooks/useGitStatus', () => ({
  useGitStatus: () => ({
    files: [
      {
        path: 'a.ts',
        status: 'modified',
        insertions: 10,
        deletions: 3,
        staged: false,
      },
    ],
    filesCwd: '/home/user/repo',
    loading: false,
    error: null,
    refresh: vi.fn(),
    idle: false,
  }),
}))

const session: Session = {
  id: 's1',
  projectId: 'p1',
  name: 'auth refactor',
  status: 'running',
  workingDirectory: '/home/user/repo',
  agentType: 'claude-code',
  createdAt: '2026-05-08T10:00:00Z',
  lastActivityAt: '2026-05-08T11:55:00Z',
  activity: {
    fileChanges: [],
    toolCalls: [],
    testResults: [],
    contextWindow: { used: 0, total: 200000, percentage: 0, emoji: '😊' },
    usage: {
      sessionDuration: 0,
      turnCount: 0,
      messages: { sent: 0, limit: 200 },
      tokens: { input: 0, output: 0, total: 0 },
    },
  },
}

const baseProps = {
  sessionId: 's1',
  cwd: '/home/user/repo',
  service: {} as never,
  session,
  isActive: true,
}

describe('TerminalPane (index)', () => {
  test('renders Body when mode is spawn or attach', () => {
    render(<TerminalPane {...baseProps} mode="spawn" />)
    expect(screen.getByTestId('body-mock')).toBeInTheDocument()
    expect(screen.queryByText('Session exited.')).not.toBeInTheDocument()
  })

  test('renders RestartAffordance when mode is awaiting-restart', () => {
    render(
      <TerminalPane
        {...baseProps}
        mode="awaiting-restart"
        session={{ ...session, status: 'completed' }}
      />
    )
    expect(screen.queryByTestId('body-mock')).not.toBeInTheDocument()
    expect(screen.getByText('Session exited.')).toBeInTheDocument()
  })

  test('Header shows agent chip resolved from session.agentType', () => {
    render(<TerminalPane {...baseProps} />)
    expect(screen.getByText('CLAUDE')).toBeInTheDocument()
  })

  test('Header shows ±changes from aggregateLineDelta(useGitStatus().files)', () => {
    render(<TerminalPane {...baseProps} />)
    expect(screen.getByText('+10')).toBeInTheDocument()
    expect(screen.getByText('−3')).toBeInTheDocument()
  })

  test('clicking the container fires focusTerminal + flips isFocused', () => {
    render(<TerminalPane {...baseProps} />)
    const wrapper = screen.getByTestId('terminal-pane-wrapper')
    fireEvent.click(wrapper)
    // After click, focus state is true → outline switches.
    expect(wrapper).toHaveAttribute('data-focused', 'true')
  })

  test('Footer placeholder uses awaiting-restart override', () => {
    render(
      <TerminalPane
        {...baseProps}
        mode="awaiting-restart"
        session={{ ...session, status: 'completed' }}
      />
    )
    expect(
      screen.getByPlaceholderText(/session ended — restart to resume claude/i)
    ).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test**

```bash
npx vitest run src/features/terminal/components/TerminalPane/index.test.tsx
```

Expected: all 6 tests pass.

---

### Task 3.11: Move awaiting-restart cases out of `Body.test.tsx`

**Files:**

- Modify: `src/features/terminal/components/TerminalPane/Body.test.tsx`

- [ ] **Step 1: Identify awaiting-restart cases in Body.test.tsx**

```bash
grep -n "awaiting-restart\|Restart\|Session exited" src/features/terminal/components/TerminalPane/Body.test.tsx
```

- [ ] **Step 2: Delete those test blocks from Body.test.tsx** (they are already covered by `index.test.tsx` and `RestartAffordance.test.tsx`)

- [ ] **Step 3: Run the full suite**

```bash
npm run test
```

Expected: all tests pass; coverage holds at ≥ 80% for the TerminalPane folder.

---

### Task 3.12: Final verification + manual visual check + commit

- [ ] **Step 1: Lint, format-check, type-check**

```bash
npm run lint && npm run format:check && npm run type-check
```

Expected: clean.

- [ ] **Step 2: Full test run**

```bash
npm run test
```

Expected: all green.

- [ ] **Step 3: Manual visual verification in `tauri:dev`**

```bash
npm run tauri:dev
```

In the running app:

- Verify the active terminal pane shows the new chrome: agent chip, status pip, title, branch, ±changes, relative-time, collapse + (no close, by design).
- Click outside the pane (e.g., sidebar) and back — verify the focus ring transitions in 180–220 ms (lavender ↔ outline-only).
- Click the collapse button — header collapses (no branch / ±changes / relative-time), padding tightens. Click again — expands.
- Force a session into completed/errored state (close the shell with `exit`, or kill the PTY) — verify the body swaps to the Restart UI and the footer placeholder reads "session ended — restart to resume claude". Click Restart — verify a new shell spawns with the chrome unchanged.
- (Optional) Capture a short demo recording for the PR description, akin to `docs/media/hero-init.gif`.

- [ ] **Step 4: Commit**

```bash
git add src/features/terminal/components/TerminalPane/ \
        src/features/workspace/components/TerminalZone.tsx
git commit -m "feat(terminal): wire chrome (Header, Footer, useFocusedPane, RestartAffordance)"
```

---

## Self-review

After Phase 3 is committed, run this checklist:

1. **Spec coverage**:
   - Goal #1 (visual fidelity): Header / Body / Footer / focus ring / agent chip / status pip — all in Phase 3.
   - Goal #2 (PTY-health pip): `onPtyStatusChange` (Body) → `setPtyStatus` (index.tsx) → `ptyStatusToSessionStatus` → Header/Footer. ✓
   - Goal #3 (no consumer churn beyond TerminalZone): only `TerminalZone.tsx` modified, one line additive. ✓
   - Goal #4 (preserve all existing behavior): Body verbatim move (Phase 2) + only-additive callbacks (Phase 3 Task 3.7). ✓
   - Q5 (awaiting-restart pip): index.tsx mode-branch sets `pipStatus = session.status`. ✓
   - Q6 (per-pane git hooks): `useGitBranch(cwd, { enabled: isActive })` + `useGitStatus(cwd, { enabled: isActive })`. ✓
   - Decisions Q1–Q9: each implemented in matching tasks above. ✓

2. **Placeholder scan**: search for "TBD", "TODO", "implement later", "fill in details", "Add appropriate error handling". None should be present.

3. **Type consistency**:
   - `TerminalPaneMode` exported from `index.tsx`, narrower `BodyMode` internal to `Body.tsx`. ✓
   - `BodyProps` includes `onPtyStatusChange` + `onFocusChange`; `BodyHandle` exposes `focusTerminal`. ✓
   - `HeaderProps` includes `branch`, `added`, `removed`. ✓
   - `FooterProps` includes optional `placeholder` override. ✓
   - `useFocusedPane` returns `isFocused`, `setFocused`, `onTerminalFocusChange`. ✓
   - `useGitBranch` returns `{ branch, loading, error, refresh, idle }`. ✓

If any gap, add a follow-up task before handing off.

## Execution handoff

Plan complete. Two execution options once `/lifeline:planner` finishes its codex plan-review pass:

1. **Subagent-driven (recommended)** — fresh subagent per task, review between tasks, fast iteration. (Sub-skill: `superpowers:subagent-driven-development`.)
2. **Inline execution** — execute tasks in this session with checkpoints. (Sub-skill: `superpowers:executing-plans`.)

Either is fine; subagent-driven keeps each task scoped + reviewable.

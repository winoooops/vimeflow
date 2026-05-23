# 2026-05-23 — Git ref chip in the terminal pane header

## 1. Summary

Each terminal pane header currently renders the linked-worktree name with a
"🌲" emoji prefix and the branch name as a separate plain-text segment,
both wrapped in middle-dot dividers. The layout breaks the visual system —
the rest of the header is composed of inline-flex pills with semantic
tokens, while these two segments are loose text + an OS-rendered emoji.
Between the session title and the diff counts, a plain branch label also
reads ambiguously as a directory path.

This spec replaces those two segments with a single `<GitRefChip>`
component: a lavender-tinted inline-flex pill that renders a
`worktree → branch` ref using two distinct Material Symbols icons
(`account_tree` for worktree, `fork_right` for branch). The chip itself
is **purely presentational** — it takes the values produced by the
existing per-pane hooks (`useGitBranch(cwd)` + `useGitWorktree(cwd)`,
already called inside `TerminalPane`) as plain props. Styling uses
semantic Catppuccin tokens already in `tailwind.config.js`; no new color
tokens are introduced.

### 1.1 Scope split (stacked PRs against `feat/git-chip-migration`)

The migration ships as two stacked PRs against the
`feat/git-chip-migration` integration branch:

- **PR-A — chip migration (this spec).** Adds `<GitRefChip>`, replaces the
  worktree+branch segments in `HeaderMetadata.tsx`, adds component tests,
  ships the long-branch (ellipsize) and no-worktree edge cases. **Does
  not** detect detached HEAD: when the existing `git_branch` IPC returns a
  short SHA (its existing fallback when HEAD is detached), the chip
  renders it as an ordinary lavender chip with the SHA in the branch slot.
- **PR-B — detached HEAD signal + coral state (follow-up).** Adds a
  backend `git_head_state` IPC returning
  `{ branch: Option<String>, sha: Option<String>, detached: bool }`
  (full state table in §6.1). The frontend
  `useGitBranch` hook collapses this into a single display contract:
  `{ branch: string | null, detached: boolean }`, where the `branch`
  string carries **the value to display in the chip's branch slot** — the
  branch name when `detached === false`, the short SHA when
  `detached === true`. This keeps `<GitRefChip>`'s data contract minimal
  (one display string + one styling flag) and matches the existing
  `git_branch` hook's already-collapsed return type. The coral detached
  path on `<GitRefChip>` keys off the `detached` flag, not off SHA-vs-name
  string inspection. PR-B gets its own spec; §6 of this document defines
  the forward-compatible contract so PR-A's component shape doesn't paint
  PR-B into a corner.

A final `feat/git-chip-migration` → `main` PR opens after both child PRs
land on the integration branch.

### 1.2 Non-goals

- **No `Session` type changes.** `worktree?: string` / `detached?: boolean`
  on `SessionState` (as proposed in `docs/design/git-chip/CHANGES.md`) is
  intentionally not added; per-pane hooks are already the source of truth
  and each pane can hold its own cwd. See §2 for the rationale.
- **No new color tokens.** The design's hex values
  (`#c39eee` → `secondary-dim`, `#cba6f7` → `primary-container`,
  `#e3e0f7` → `on-surface`, `#4a444f` → `outline-variant`,
  `#ff94a5` → `tertiary`, `#ffb4ab` → `error`) all map to existing
  semantic tokens.
- **No backend changes in PR-A.** `git_branch` and `git_worktree_name`
  IPCs are untouched; PR-B adds `git_head_state` separately.

## 2. Data flow & the deviation from `CHANGES.md`

### 2.1 Per-pane sources

The Vimeflow workspace allows a single `Session` to host multiple `Pane`s,
each with its own `cwd` (one pane may be on the main checkout, another
inside a linked worktree). Git ref metadata is therefore inherently
**per-pane**, not per-session.

Two existing hooks already cover this:

- `src/features/diff/hooks/useGitBranch.ts` —
  `useGitBranch(cwd) → { branch, loading, error, refresh, idle }`. Invokes
  the `git_branch` IPC (which returns either the branch name from
  `symbolic-ref --short HEAD` or, when HEAD is detached, the short SHA
  from `rev-parse --short=7 HEAD`) and subscribes to `git-head-changed`
  watcher events for reactive refresh.
- `src/features/diff/hooks/useGitWorktree.ts` —
  `useGitWorktree(cwd) → { worktreeName, loading, error }`. Invokes
  `git_worktree_name` (returns `null` for the main checkout, basename of
  the linked-worktree path otherwise). No watcher subscription — worktree
  layout doesn't change mid-session.

Both hooks preserve their last-known value through IPC round-trips and
tab-deactivation transitions, so the chip never flickers blank during
ordinary navigation.

### 2.2 Component data contract (PR-A)

`<GitRefChip>` is presentational — it takes plain props and renders.
The hooks stay in `TerminalPane` exactly as today. PR-A introduces the
`detached?: boolean` prop already (defaulting to `false`) so PR-B is a
non-breaking widening — see §2.4.

```ts
interface GitRefChipProps {
  worktreeName: string | null
  branch: string | null
  /** PR-A: optional, always defaults to false. PR-B wires the live value. */
  detached?: boolean
}
```

`Header` already receives `worktreeName` and `branch` as props from its
parent (`TerminalPane`), which calls the two hooks once per pane. PR-A
removes the worktree+branch segments inside `HeaderMetadata.tsx` and
inserts `<GitRefChip>` in their place; no new IPC calls, no new state,
no hooks consumed inside the chip itself.

### 2.3 Why not add fields to `SessionState` (deviation from `CHANGES.md`)

`docs/design/git-chip/CHANGES.md` proposes adding `worktree?: string` and
`detached?: boolean` to `SessionState`. This spec intentionally does not
follow that recommendation:

- **Per-pane cwd.** One `Session` can host multiple `Pane`s in different
  cwds. A `Session.worktree` field would either need an arbitrary
  "primary pane" concept or be ambiguous when panes diverge. The prototype
  in `docs/design/git-chip/prototype/src/data.js` doesn't have this
  problem because its session model is single-paned.
- **Watcher duplication.** `useGitBranch` already listens to
  `git-head-changed` events for reactive refresh. Mirroring its output
  into a `Session` store would duplicate the subscription pattern and add
  a new sync seam (who writes `session.worktree` when the pane's cwd
  changes?).
- **Test surface.** `HeaderMetadata.test.tsx` mocks `worktreeName` /
  `branch` as plain props. Adding `session.worktree` adds a parallel
  surface every header test would need to configure.

The prototype `CHANGES.md` was authored against a different (simpler)
data model. The Vimeflow architecture diverges; the prototype JSX still
ports cleanly because the chip itself only needs two strings plus the
optional `detached` flag (see §2.2) — all values its caller already has
in scope.

### 2.4 Forward compatibility with PR-B

PR-B adds detached-HEAD detection by extending the hook return shape
rather than the chip's prop count:

```ts
// PR-B return shapes
interface UseGitBranchReturn {
  branch: string | null // branch name OR short SHA, per §1.1
  detached: boolean
  /* loading, error, refresh, idle — unchanged from PR-A */
}

interface GitRefChipProps {
  worktreeName: string | null
  branch: string | null
  detached?: boolean
}
```

PR-A introduces `detached?: boolean` as an **optional, defaulting-to-false
prop** on `GitRefChip` so that PR-B is a non-breaking widening — PR-B
flips the default from `undefined` to a populated value, and the chip's
internal `if (detached) { coral styling }` branch is wired but
unreachable until then. Coverage for the coral path can still land in
PR-A as a `detached={true}` unit test against a mocked prop, even though
no live caller passes it yet.

## 3. `<GitRefChip>` component contract

### 3.1 Location & test co-location

- Component: `src/features/terminal/components/TerminalPane/GitRefChip.tsx`
- Tests: `src/features/terminal/components/TerminalPane/GitRefChip.test.tsx`

The chip lives alongside `Header.tsx` / `HeaderMetadata.tsx` so it's
locally importable. No barrel re-export needed — existing siblings are
imported by relative path.

### 3.2 Props

```ts
export interface GitRefChipProps {
  /** Linked-worktree basename, or null when on the main checkout. */
  worktreeName: string | null
  /** Branch name (PR-A) — or short SHA when HEAD is detached. */
  branch: string | null
  /** PR-A: optional, always defaults to false. PR-B wires the live value. */
  detached?: boolean
}
```

**Empty-string normalisation.** The chip treats `branch === null`
*and* `branch === ''` identically — it returns `null` (renders
nothing) in both cases. `useGitBranch` already maps the empty string
to `null` before reaching the chip
(`setBranch(trimmed === '' ? null : trimmed)`), so the
empty-string branch is defensive only; the §4.1 header guard mirrors
the same `branch !== null && branch.length > 0` predicate.

`worktreeName === null` AND branch is non-empty (i.e. the normalised
predicate `branch !== null && branch.length > 0`) renders the chip
with only the branch segment (no worktree icon, no chevron) — the
no-worktree edge case from §1.1.

### 3.3 Visual contract

Composition (left → right):

| Element        | Glyph                          | Token & class                                                                  | Behaviour                              |
|----------------|--------------------------------|--------------------------------------------------------------------------------|----------------------------------------|
| Worktree icon  | `account_tree` (Material Sym.) | `material-symbols-outlined`, `text-secondary-dim`, `text-[13px]`, `shrink-0`   | omitted when `worktreeName === null`   |
| Worktree label | text                           | `text-secondary-dim`, `font-mono`, `text-[10.5px]`, `max-w-[120px]`, `shrink-0`, `truncate` | ellipsizes only when itself > 120 px; `shrink-0` so flex doesn't compress it below content width when the chip is narrow |
| Chevron        | `›` literal                    | `text-outline-variant`, `text-[11px]`, `shrink-0`                              | omitted when no worktree               |
| Branch icon    | `fork_right` (Material Sym.)   | `material-symbols-outlined`, `text-primary-container`, `text-[13px]`, `shrink-0` | always present                         |
| Branch label   | text                           | `text-on-surface`, `font-medium`, `font-mono`, `text-[10.5px]`, `min-w-0`, `truncate` | ellipsizes when long; the chip's "elastic" slot |

The `material-symbols-outlined` class is the load-bearing one — it
swaps the icon span's font to the Material Symbols font (loaded in
`src/index.css`). Without it, the `account_tree` / `fork_right` strings
render as literal text. Tests assert this class explicitly (§5.1
case 9).

Chip frame:

```text
inline-flex items-center gap-1.5 h-[22px] pl-1.5 pr-2
rounded-chip border max-w-[340px] overflow-hidden
bg-primary-container/[0.06] border-primary-container/20
```

`rounded-chip` is the project-specific 6 px token (`tailwind.config.js`
defines `chip: '6px'`; the generic `rounded-md` token is 0.75 rem / 12 px
and would diverge from `CHANGES.md`). The `/[0.06]` arbitrary-opacity
syntax produces `rgba(203,166,247,0.06)` exactly. `gap-1.5` = 6 px,
`pl-1.5 pr-2` = 6 px / 8 px asymmetric, `h-[22px]` = 22 px.

**Why worktree label has its own cap.** `CHANGES.md` says icons + the
worktree segment "must `flex-shrink: 0` so they never collapse; only the
branch label ellipsizes." Taken literally, a pathological 100-char
worktree name plus a 340 px chip cap would push the branch label out of
sight entirely. The 120 px worktree cap is the pragmatic compromise: a
typical worktree name (5–25 chars) fits inside it without truncation,
while a runaway worktree truncates at 120 px so the branch slot still
gets the remaining ~145 px of the 340 px frame
(`340 − 6 (pl-1.5) − 8 (pr-2) − 4 × 6 (gap-1.5) − 13 (wt icon) −
120 (wt cap) − 11 (chevron) − 13 (br icon) = 145`). Icons themselves
stay `shrink-0` so they never collapse, matching the design's intent.

### 3.4 Detached HEAD path (PR-B preview)

When `detached === true`:

- Chip frame: `bg-tertiary/[0.06] border-tertiary/25` (replaces lavender).
- Worktree icon + label: `text-error`.
- Branch icon + label: `text-tertiary`.
- Chevron: unchanged (`text-outline-variant`).

PR-A wires this branch but no production caller passes `detached={true}`;
a `detached={true}` unit test exercises it so the path doesn't bit-rot
before PR-B activates it.

### 3.5 Accessibility

- Outer element is a `<span>` — non-interactive, consistent with the
  existing chips in the header.
- `title` attribute composition (system tooltip on hover — consistent
  with the existing `worktree-chip` `title="worktree: ${name}"`
  pattern):
  - `detached === false`, both present →
    `worktree: ${worktreeName} · branch: ${branch}`.
  - `detached === false`, worktree null →
    `branch: ${branch}`.
  - `detached === true`, both present →
    `worktree: ${worktreeName} · detached HEAD: ${branch}` — `branch`
    here is the short SHA (per §1.1), so the label uses `detached HEAD:`
    rather than `branch:` to avoid mislabelling.
  - `detached === true`, worktree null →
    `detached HEAD: ${branch}`.
- Material Symbols icons get `aria-hidden="true"`; the surrounding text
  labels carry the semantic meaning.
- No keyboard focus in PR-A. PR-B may add a click-to-open-diff handler,
  but that's out of scope here.

## 4. `HeaderMetadata.tsx` integration

PR-A replaces the worktree-chip + branch segments in
`HeaderMetadata.tsx` with a single `<GitRefChip>`.

### 4.1 Before / after

Removed (lines 28–48 of the current `HeaderMetadata.tsx`):

```tsx
{hasWorktree && (
  <>
    <span className="text-outline-variant/60">·</span>
    <span
      data-testid="worktree-chip"
      title={`worktree: ${worktreeName}`}
      className="inline-flex min-w-0 items-center gap-1 truncate text-on-surface-muted"
    >
      <span aria-hidden="true">🌲</span>
      <span className="truncate">{worktreeName}</span>
    </span>
  </>
)}
{hasBranch && (
  <>
    <span className="text-outline-variant/60">·</span>
    <span className="min-w-0 truncate text-on-surface-muted">
      {branch}
    </span>
  </>
)}
```

Added:

```tsx
{hasGitRef && (
  <>
    <span className="text-outline-variant/60">·</span>
    <GitRefChip worktreeName={worktreeName} branch={branch} />
  </>
)}
```

Where `hasGitRef = branch !== null && branch.length > 0`. The chip
itself also returns `null` when `branch === null`; the local guard
matches it so the leading middle-dot is suppressed in the same case.

### 4.2 `hasLeadingMetadata` simplification

Current:

```ts
const hasLeadingMetadata = hasWorktree || hasBranch || hasDeltas
```

After:

```ts
const hasLeadingMetadata = hasGitRef || hasDeltas
```

The trailing-dot logic (the `·` before the relative-time label) keeps
its current behavior — present when *any* leading metadata renders.

### 4.3 Behaviour change: worktree-without-branch

Today the header can render `· 🌲 worktree · now` when the branch hook
is loading or errored but the worktree hook succeeded. Under PR-A the
chip suppresses itself if `branch` is null/empty, and §4.2's
`hasLeadingMetadata` collapses to `hasGitRef || hasDeltas`. With no
chip and no deltas, the trailing middle-dot is also gone — the header
renders just `now` (no leading `·`). With deltas present
(`+5 −2`), the header renders `+5 −2 · now`. This is the
minimum-viable contract: the chip's purpose is to show a
`worktree → branch` ref, and a worktree-only label arguably lies (a
checkout always has a HEAD).

If reviewers want to preserve the worktree-only label, the alternative
is a fifth chip render variant for `worktreeName !== null &&
branch === null`. PR-A keeps the contract simple; this is called out
as an open question in §7.

### 4.4 Imports & test handoff

`HeaderMetadata.tsx` adds:

```ts
import { GitRefChip } from './GitRefChip'
```

The `🌲` glyph and `data-testid="worktree-chip"` go away (the new chip
ships with its own `data-testid="git-ref-chip"` per §5.1). **Two test
files** must be updated in lockstep with this change:

- `HeaderMetadata.test.tsx` — the direct test for the integration site.
- `Header.test.tsx` — the parent component also asserts the
  `worktree-chip` testid (lines 89 and 101 at HEAD `a34d467`), so it
  needs the same testid migration.

§5.2 lists the exact updates for both files.

## 5. Testing

### 5.1 `GitRefChip.test.tsx` (new)

Co-located with `GitRefChip.tsx`. Uses `@testing-library/react`'s
`render` + `screen` per `rules/typescript/testing/CLAUDE.md`; `test()`
(not `it()`); test data inlined at call sites. The chip ships with
`data-testid="git-ref-chip"` on the outer `<span>`; per-segment
testids let tests assert structure without scraping class strings:

| Element        | testid                   |
|----------------|--------------------------|
| Outer chip     | `git-ref-chip`           |
| Worktree icon  | `git-ref-chip-wt-icon`   |
| Worktree label | `git-ref-chip-wt-label`  |
| Chevron        | `git-ref-chip-chevron`   |
| Branch icon    | `git-ref-chip-br-icon`   |
| Branch label   | `git-ref-chip-br-label`  |

Cases:

1. **Renders nothing when `branch` is null or empty.**
   Two parametrised assertions, one with `branch={null}` and one with
   `branch={''}`:
   `expect(screen.queryByTestId('git-ref-chip')).toBeNull()`.
2. **Both segments when both present.** `worktreeName="feat-jose"`,
   `branch="feat/jose-auth"`. All six testids resolve; label text
   matches.
3. **Branch-only when `worktreeName` is null.** Chip present; `wt-icon`,
   `wt-label`, `chevron` testids absent; branch testids present.
4. **Branch-label truncation class.** Asserts `min-w-0 truncate` on
   `git-ref-chip-br-label`. JSDOM doesn't lay out CSS reliably, so
   pixel ellipsis is not asserted — class presence is the contract.
5. **Worktree-label cap class.**
   `worktreeName="this-is-a-very-long-worktree-name-for-test"`
   asserts `max-w-[120px] truncate` on `git-ref-chip-wt-label`,
   locking the §3.3 mitigation against branch-slot starvation.
6. **Detached HEAD path.** `detached={true}` flips the chip to coral —
   assert `bg-tertiary/[0.06]` on frame, `text-tertiary` on branch
   label, `text-error` on worktree label.
7. **Detached + no worktree.** Coral branch segment only; worktree
   segments absent; chip frame still coral.
8. **Title attribute composition.**
   Both present → `title="worktree: feat-jose · branch: feat/jose-auth"`.
   Branch-only → `title="branch: feat/jose-auth"`.
9. **Icons render as glyphs, not text.** Both icon spans assert the
   `material-symbols-outlined` class is present AND that
   `aria-hidden="true"` is set. The class is load-bearing — without it,
   the `account_tree` / `fork_right` strings render as literal text;
   asserting it explicitly locks the behavior against an accidental
   class-name regression.

10. **Detached title wording.** With `detached={true}` and
    `branch="a7f23c"`, the chip's `title` attribute reads
    `detached HEAD: a7f23c` (not `branch: a7f23c`). With worktree also
    present, prefix is `worktree: feat-jose · `. Locks the §3.5 fix.

### 5.2 `HeaderMetadata.test.tsx` (updated in lockstep)

- Replace `getByTestId('worktree-chip')` assertions with
  `getByTestId('git-ref-chip')` for the both-present case.
- Remove the assertion that finds the branch as plain text — the chip
  now wraps it. Replace with a `git-ref-chip-br-label` testid check
  carrying the expected branch string.
- Add the §4.3 behaviour test: when `worktreeName="x"` and `branch=null`,
  neither chip nor leading dot renders; only the relative-time label
  is in the output.
- Add the defensive empty-string test: `branch=''` is treated the same
  as `branch=null` (no chip, no leading dot).
- Existing diff-count and relative-time tests stay intact.

### 5.3 `Header.test.tsx` (updated in lockstep)

`Header.test.tsx` is the parent-component test and currently asserts
`worktree-chip` directly (lines 89, 101 at HEAD `a34d467`). The
updates mirror §5.2 but the **negative-assertion target shifts**
because the new chip still renders in the branch-only case:

- Old line 89 (negative — worktreeName null, branch present):
  `expect(queryByTestId('worktree-chip')).not.toBeInTheDocument()`.
  Replacement: target the worktree-segment testid, not the outer chip
  (the outer chip still renders to show the branch):
  `expect(queryByTestId('git-ref-chip-wt-label')).not.toBeInTheDocument()`
  *and* (for explicitness)
  `expect(getByTestId('git-ref-chip-br-label')).toHaveTextContent('main')`.
- Old line 101 (positive — worktree-present case):
  `expect(getByTestId('worktree-chip')).toHaveTextContent(...)`.
  Replacement: `expect(getByTestId('git-ref-chip-wt-label')).toHaveTextContent('feat-jose')`.
- The text-content assertion for the branch name uses
  `git-ref-chip-br-label` for both worktree-present and worktree-null
  cases.

No behavioural change to `Header.test.tsx` beyond the testid migration —
all integration tests at the parent level still assert the same
worktree-present/absent decision tree.

### 5.4 Coverage target

PR-A targets 100 % line coverage on `GitRefChip.tsx` (the component is
small). `HeaderMetadata.tsx` and `Header.tsx` keep their existing
coverage. Reflects `rules/CLAUDE.md`'s 80 % minimum.

### 5.5 Out of scope for PR-A tests

- **Live `detached={true}` data path.** No production code passes
  `detached={true}` in PR-A; case 6 above exercises it via a mocked
  prop. PR-B's tests cover the hook → chip wiring.
- **Pixel ellipsis on long branch / worktree.** Class-only assertions
  (cases 4 and 5); JSDOM layout isn't reliable enough for pixel
  measurements.

## 6. PR-B forward contract (sketch)

PR-B has its own spec; this section only pins down the interfaces so
PR-A's component shape stays compatible.

### 6.1 New backend IPC: `git_head_state`

`crates/backend/src/git/mod.rs` adds an inner function + IPC entry.
The struct uses the repo's `ts_rs` gating convention (`ts-rs` is a
dev-dep, so derives are gated to `cfg(test)`):

```rust
#[derive(serde::Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export))]
pub struct GitHeadState {
    /// Some(branch name) when HEAD is a symbolic ref, None when detached
    /// or unborn (see semantics below).
    pub branch: Option<String>,
    /// 7-char short SHA. Some for branch-with-commits and detached
    /// states; None for unborn repos (HEAD points to a ref that has no
    /// commit yet).
    pub sha: Option<String>,
    /// True when symbolic-ref reports HEAD is not a branch (the existing
    /// detached path in `git_branch_inner`).
    pub detached: bool,
}
```

The inner function preserves the **same error semantics** as
`git_branch_inner` at HEAD `a34d467` — codex review pattern #25 in
`docs/reviews/patterns/error-surfacing.md` requires `symbolic-ref -q`
plus an empty-stderr-only fallback so real git errors don't get
masked as detached HEAD. The new function also captures the SHA in
the branch case (unlike `git_branch_inner` which only returned the
branch name) so callers can use it without a second round-trip; for
unborn repos the symbolic-ref still resolves the branch name even
though `rev-parse HEAD` fails, so the resulting state is
`{ branch: Some("main"), sha: None, detached: false }`.

The implementation reuses the existing `Command::new("git")` +
`run_git_with_timeout` pattern (see lines 1110-1158 of `git/mod.rs`
at HEAD `a34d467`) — no new helper functions are introduced:

```rust
pub(crate) async fn git_head_state_inner(cwd: String) -> Result<GitHeadState, String> {
    let safe_cwd = validate_cwd(&cwd)?;

    // 1. symbolic-ref -q --short HEAD
    //    The -q flag suppresses the "not a symbolic ref" stderr line
    //    so we can distinguish "detached" (empty stderr) from a real
    //    error (non-empty stderr).
    let mut sym = Command::new("git");
    sym.arg("-C").arg(&safe_cwd)
       .arg("symbolic-ref").arg("-q").arg("--short").arg("HEAD")
       .env("GIT_TERMINAL_PROMPT", "0");
    let sym_out = run_git_with_timeout(sym).await?;

    if sym_out.status.success() {
        let branch = String::from_utf8(sym_out.stdout)
            .map_err(|e| format!("git_head_state utf8: {}", e))?
            .trim()
            .to_string();
        // SHA in the branch case is best-effort. For unborn repos
        // (branch resolves but `refs/heads/<branch>` has no commit
        // yet) `rev-parse --verify HEAD` fails and we keep sha: None.
        let sha = rev_parse_short_head(&safe_cwd).await;
        return Ok(GitHeadState { branch: Some(branch), sha, detached: false });
    }

    let stderr = String::from_utf8_lossy(&sym_out.stderr);
    if !stderr.trim().is_empty() {
        return Err(format!("git_head_state: {stderr}"));
    }

    // 2. Empty stderr: HEAD is detached. rev-parse confirms there's a
    //    commit; if it fails we fall through to the corrupt-state
    //    fallback at the end (preserves existing `Ok(String::new())`
    //    behaviour from `git_branch_inner`).
    if let Some(sha) = rev_parse_short_head(&safe_cwd).await {
        return Ok(GitHeadState { branch: None, sha: Some(sha), detached: true });
    }

    // 3. Corrupt / unreachable HEAD — match the existing
    //    `Ok(String::new())` behaviour: neutral state, no error.
    Ok(GitHeadState { branch: None, sha: None, detached: false })
}

/// Helper inlined alongside `git_head_state_inner` in the same module.
/// Mirrors the rev-parse block at lines 1135-1156 of `git_branch_inner`;
/// returns `None` for both unborn repos and corrupt states.
async fn rev_parse_short_head(safe_cwd: &Path) -> Option<String> {
    let mut rev = Command::new("git");
    rev.arg("-C").arg(safe_cwd)
       .arg("rev-parse").arg("--short=7").arg("--verify").arg("HEAD")
       .env("GIT_TERMINAL_PROMPT", "0");
    let out = run_git_with_timeout(rev).await.ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8(out.stdout).ok().map(|s| s.trim().to_string())
}
```

The four observable states map to:

| State            | `branch`            | `sha`         | `detached` | How detected                                                       |
|------------------|---------------------|---------------|------------|--------------------------------------------------------------------|
| Normal branch    | `Some("feat/x")`    | `Some(sha)`   | `false`    | symbolic-ref succeeds; rev-parse succeeds.                         |
| Unborn repo      | `Some("main")`      | `None`        | `false`    | symbolic-ref succeeds (HEAD ref still resolves); rev-parse fails.  |
| Detached HEAD    | `None`              | `Some(sha)`   | `true`     | symbolic-ref fails with empty stderr; rev-parse succeeds.          |
| Corrupt / weird  | `None`              | `None`        | `false`    | symbolic-ref fails with empty stderr; rev-parse also fails.        |
| Real git error   | (Err propagated)    | —             | —          | symbolic-ref fails with non-empty stderr.                          |

Per `reference_new_ipc_checklist`, four files change for the IPC:

1. `crates/backend/src/git/mod.rs` — inner + public wrapper.
2. `crates/backend/src/runtime/state.rs` — `BackendState::git_head_state(cwd)`.
3. `crates/backend/src/runtime/ipc.rs` — router match arm.
4. `electron/backend-methods.ts` — allowlist entry.

`src/bindings/GitHeadState.ts` is generated by the existing `ts-rs`
flow during the test run (gated via `cfg_attr(test, ...)` like other
exported types in `crates/backend/src/agent/types.rs`).

The existing `git_branch` IPC is retained for backward compatibility
in PR-B; `useGitBranch` switches its implementation to call
`git_head_state` internally. A future PR-C can deprecate `git_branch`
once no caller depends on it.

### 6.2 Hook contract change: `useGitBranch`

```ts
// PR-B return shape — additive over PR-A's
export interface UseGitBranchReturn {
  branch: string | null  // branch name OR short SHA when detached === true
  detached: boolean
  loading: boolean
  error: Error | null
  refresh: () => void
  idle: boolean
}
```

The hook collapses `git_head_state`'s `{ branch, sha, detached }` into
two display fields:

- `branch`: the value to display in the chip's branch slot —
  branch name when `detached === false`, the short SHA when
  `detached === true`.
- `detached`: styling flag passed straight through to the chip.

The hook keeps preserving its last-known value through transitions, so
the chip never flickers blank during reactive refresh.

### 6.3 Caller wiring change (single site)

`TerminalPane.tsx` is the only call site that matters for the chip:

```ts
const { branch, detached } = useGitBranch(cwd)
// …
<Header
  worktreeName={worktreeName}
  branch={branch}
  detached={detached}   // ← new
  // …
/>
```

`Header` and `HeaderMetadata` forward `detached` to `GitRefChip` (where
PR-A already wired the prop and the coral branch). No other consumers
of `useGitBranch` need to read `detached` — they keep using `branch`
as before.

**Blast radius for typed mocks.** Making `detached: boolean` required on
`UseGitBranchReturn` is a TypeScript-level breaking change for any test
that constructs a mocked return value with the explicit type
annotation. PR-B audits the repo for `UseGitBranchReturn` usages
(`rg "UseGitBranchReturn" src/` at HEAD `a34d467`) and updates each
typed mock to include `detached: false` as the default. Runtime
callers that destructure only `branch` from the hook are unaffected.

## 7. Risks & open questions

### 7.1 Open question — worktree-without-branch display

§4.3 documents the behaviour change: when `worktreeName` is set but
`branch` is null/empty (typically the transient state during initial
load), the chip suppresses itself entirely. Today the worktree-only
label is visible during that ~100 ms window.

Two ways to preserve the worktree-only label:

- **A.** Render a worktree-only badge variant in `GitRefChip` when
  `worktreeName !== null && branch === null`. Adds a fifth chip render
  variant (×2 for detached) — six total.
- **B.** Keep PR-A as specced; accept the brief no-chip flash during
  initial load.

The spec ships with **B** because (a) the gap is < 100 ms in practice
(both hooks fire on mount), and (b) preserving the worktree-only label
mid-load arguably misleads — the worktree is visible but the branch is
unknown. Reviewers can flip this to **A** in PR-A if they prefer; the
choice does not affect PR-B.

### 7.2 Verified — Tailwind arbitrary-opacity syntax

The chip frame uses `bg-primary-container/[0.06]` and
`border-primary-container/20`. The `/[0.06]` arbitrary-opacity syntax
needs Tailwind ≥ 3.1. **Verified at HEAD `a34d467`:**
`@tailwindcss/postcss ^4.2.2` per `package.json`, and the same syntax
is already used in
`src/features/agent-status/components/ToolCallSummary.tsx`
(`bg-success/[0.06]`),
`src/features/agent-status/components/ContextBucket.tsx`
(`border-primary-container/[0.08]`), and `src/features/sessions/components/Tab.tsx`
(`hover:bg-on-surface/[0.06]`). No fallback needed.

### 7.3 Risk — `CHANGES.md` drift

`docs/design/git-chip/CHANGES.md` proposes adding
`worktree?: string` / `detached?: boolean` to `SessionState`. This spec
intentionally rejects that (§2.3). Future contributors reading
`CHANGES.md` standalone may re-litigate the decision; the §2.3
deviation paragraph is the canonical answer.

Mitigation: `CHANGES.md` is committed alongside this spec on
`feat/git-chip-migration` so the two are co-located and the deviation
context is one `grep` away.

### 7.4 Risk — narrow-pane visual regression

The 340 px chip cap plus 120 px worktree cap means an extremely long
branch name still gets ~145 px to ellipsize. On a 4-up SplitView at
1280 px viewport width, each pane header is < 320 px wide; the chip's
hard 340 px cap would overflow the pane header. PR-A's tests do not
catch this (JSDOM has no layout). **Acceptance gate:** manual QA at
1280 × 800 with a 4-pane SplitView, both worktree-present and
worktree-absent panes. If overflow shows, drop `max-w-[340px]` to
`max-w-full` and let flex math handle it.

### 7.5 Out of scope for PR-A

- **Click-to-open-diff on the chip.** PR-B may add it; PR-A's
  `<span>` is non-interactive.
- **Worktree-only fallback variant** (see §7.1 — decision deferred to
  PR-A reviewer or PR-B).
- **Telemetry on chip render state.** Not needed; the chip is
  presentational.

<!-- codex-reviewed: 2026-05-23T15:45:45Z -->

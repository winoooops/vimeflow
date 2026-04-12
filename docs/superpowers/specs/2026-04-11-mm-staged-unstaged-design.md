# Dual-Flag Staged/Unstaged Model for Diff Viewer

**Date:** 2026-04-11
**Status:** Proposed (not yet implemented)
**Depends on:** PR #47 (diff viewer v1)

## Problem

Git's porcelain `MM` status means a file has changes in both the index
(staged) and the worktree (unstaged). These are two independent diffs:

```bash
git diff --cached -- file   # staged: HEAD -> index
git diff -- file            # unstaged: index -> worktree
```

The current `ChangedFile` model uses a single `staged: boolean`. For MM
files this forces a choice: show one diff and hide the other. v1 defaults
to `staged: false` (shows unstaged) because working-tree changes are
unreviewed, but this silently hides staged changes.

## Design

### Data model change

Replace the single `staged` boolean with two flags:

**Rust (`src-tauri/src/git/mod.rs`):**

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub status: ChangedFileStatus,
    pub has_staged_changes: bool,
    pub has_unstaged_changes: bool,
}
```

**TypeScript (`src/features/diff/types/index.ts`):**

```ts
interface ChangedFile {
  path: string
  status: ChangedFileStatus
  hasStagedChanges: boolean
  hasUnstagedChanges: boolean
}
```

### Parsing rules

| Porcelain XY | `hasStagedChanges` | `hasUnstagedChanges` |
| ------------ | ------------------ | -------------------- |
| `M `         | true               | false                |
| ` M`         | false              | true                 |
| `MM`         | true               | true                 |
| `A `         | true               | false                |
| `AM`         | true               | true                 |
| `D `         | true               | false                |
| ` D`         | false              | true                 |
| `R `         | true               | false                |
| `??`         | false              | true                 |

General rule: X position non-space/? = staged changes exist; Y position
non-space/? = unstaged changes exist.

### UI: split file list

`ChangedFilesList` groups files into two collapsible sections:

```
STAGED (2)
  App.tsx          <- click -> git diff --cached
  utils.ts

UNSTAGED (3)
  App.tsx          <- click -> git diff (no --cached)
  config.ts
  README.md
```

- MM files appear in **both** groups.
- Clicking a staged entry passes `staged: true` to `useFileDiff`.
- Clicking an unstaged entry passes `staged: false`.
- The diff viewer renders the same way in both cases (green/red lines).
  The grouping header is the only indicator of which state is shown.
- Each section header shows a count badge.
- Empty sections are hidden (e.g. no staged changes = no "STAGED" header).

### Selection state

`DiffPanelContent` tracks selection as `{ path: string; staged: boolean }`
instead of just `path: string`. This disambiguates which entry the user
clicked when a file appears in both groups.

```ts
const [selected, setSelected] = useState<{
  path: string
  staged: boolean
} | null>(null)
```

### Auto-select priority

When the file list loads, auto-select the first **unstaged** entry (if any),
because unstaged changes are more likely to need attention. If no unstaged
entries exist, select the first staged entry.

## Files to change

| File                                                | Change                                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------- |
| `src-tauri/src/git/mod.rs`                          | `ChangedFile` struct: replace `staged` with dual flags; update `parse_git_status` |
| `src/features/diff/types/index.ts`                  | `ChangedFile` type: replace `staged` with dual flags                              |
| `src/features/diff/components/ChangedFilesList.tsx` | Split into Staged/Unstaged groups; accept `onSelectFile(path, staged)`            |
| `src/features/diff/components/DiffPanelContent.tsx` | Change `selectedFile` to `{ path, staged }` tuple                                 |
| `src/features/diff/services/gitService.ts`          | Update `MockGitService.getStatus()` mock data                                     |
| `src/features/diff/data/mockDiff.ts`                | Update `mockChangedFiles` to use new shape                                        |
| Tests for all of the above                          |                                                                                   |

## Out of scope

- Three-way diff view (HEAD vs index vs worktree in one panel)
- Inline staging/unstaging of individual hunks
- Color-coding by staged vs unstaged within the diff lines themselves
  (the section grouping handles disambiguation)

## Acceptance criteria

- [ ] `MM` files appear in both Staged and Unstaged groups
- [ ] Clicking staged entry shows `git diff --cached`; unstaged shows `git diff`
- [ ] Empty groups are hidden
- [ ] Auto-select picks first unstaged entry
- [ ] All existing tests updated and passing
- [ ] New tests for MM, AM, and single-state files

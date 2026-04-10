---
id: file-tree-paths
category: files
created: 2026-04-10
last_updated: 2026-04-10
ref_count: 0
---

# File Tree Path Handling

## Summary

The file explorer's recursive `FileTreeNode` rendering makes path handling
subtle: each node only knows its own basename, not its ancestry. Code that
constructs paths from `currentPath + node.name` at the consumer (FileExplorer)
gets it wrong for nested nodes, because `currentPath` is only updated on
directory navigation — NOT on recursive descent through already-expanded
children. The solution is to thread canonical full paths through the
recursion itself, so every node carries its ancestry. Canonical full paths
also solve React reconciliation: they make stable, unique `id` keys that
survive directory refreshes without remounting components and losing state.

## Findings

### 1. Nested file selection drops parent directories — opens wrong file

- **Source:** codex-adversarial | PR #38 | 2026-04-09
- **Severity:** HIGH
- **File:** `src/features/workspace/components/panels/FileExplorer.tsx`
- **Finding:** `handleNodeSelect` constructed file paths as `currentPath + node.name`. But `FileTree` renders children recursively via `FileTreeNode`, and `currentPath` is only updated when the user navigates via `navigateTo()` — NOT when a nested child is rendered. For a file like `src/middleware/auth.ts` auto-expanded under `currentPath = '~'`, clicking `auth.ts` produced `~/auth.ts` instead of `~/src/middleware/auth.ts`. The editor opened the wrong file (or nothing), and `:w` would write to the wrong path. A test locked in the broken behavior.
- **Fix:** Thread ancestry through the recursion. `FileTree` accepts a `rootPath` prop and forwards it to top-level `FileTreeNode`s as `parentPath`. Each node computes its own `fullPath = joinPath(parentPath, node.name)` and passes that down to its children as their `parentPath`. `onNodeSelect(node, fullPath)` now emits the canonical path, which `FileExplorer` uses directly.
- **Commit:** `4d5aed1 fix(files): thread canonical full paths through FileTree recursion`

### 2. `FileTree` `rootPath` default is empty string — silent relative-path footgun

- **Source:** github-claude | PR #38 round 5 | 2026-04-10
- **Severity:** LOW
- **File:** `src/features/files/components/FileTree.tsx`
- **Finding:** `FileTree` declared `rootPath = ''` as its default. `FileTreeNode.joinPath` short-circuits when `parent === ''` and returns just the bare filename (e.g. `'auth.ts'` instead of `'~/auth.ts'`). The current call site (`FileExplorer`) always passes `rootPath={currentPath}` so the bug was latent — but any future consumer (including `FilesPanel`) that omitted the prop would silently emit relative paths that reach the Rust `read_file`/`write_file` commands, where they'd be rejected as non-absolute with opaque "access denied" errors.
- **Fix:** Change the default to `rootPath = '~'` to match `FileExplorer`.
- **Commit:** `28027a5 fix: address Claude review round 5 findings`

### 3. `FilesPanel` adapter drops `fullPath` after FileTree signature change

- **Source:** github-claude | PR #38 round 3 | 2026-04-10
- **Severity:** LOW
- **File:** `src/features/workspace/components/panels/FilesPanel.tsx`
- **Finding:** `FileTree.onNodeSelect` changed from `(node) => void` to `(node, fullPath) => void`. The `FilesPanel` adapter was not updated — `onNodeSelect={(node) => onFileSelect?.(node)}` silently ignored the second argument. `FilesPanel` forwarded the raw mock id (`'file-1'`) instead of the canonical path. Invisible at type-check time because JavaScript allows ignoring extra callback args. Not runtime-broken today because `FilesPanel` only uses mock data.
- **Fix:** Update the adapter to forward `fullPath` matching `FileExplorer`'s pattern: `onNodeSelect={(node, fullPath) => onFileSelect?.({ ...node, id: fullPath })}`.
- **Commit:** `d2a67ed fix: address Claude review round 3 findings`

### 4. Module-level `nextMockId` yields unstable FileNode IDs — React remounts lose state

- **Source:** github-claude | PR #38 round 13 | 2026-04-10
- **Severity:** MEDIUM
- **File:** `src/features/files/services/fileSystemService.ts`
- **Finding:** `toFileNode` used a module-level counter `let nextMockId = 0` that incremented on every call. In Tauri mode every `listDir` call (navigating up, into a folder, refreshing) mapped entries through `toFileNode`, so the same file got `fs-0` on the first call and `fs-5` on the next. React's reconciler uses `node.id` as the `key` prop in `FileTree` — when the same node reappeared with a different key, React fully unmounted and remounted it, losing all local state (expand/collapse, rename input). The user clicks into a folder, clicks back up, and all folders collapse to their defaults. Tauri is the production path, so this was a real UX regression.
- **Fix:** Derive IDs from the canonical full path instead of a counter. Since `fullPath` is now the canonical identity throughout the stack (see finding #1), using it as the ID gives both stability and uniqueness. Thread `parentPath` through `toFileNode` recursion so nested children also receive canonical paths.
- **Commit:** `3999b50 fix: address Claude review round 13 findings`

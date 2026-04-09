---
id: async-race-conditions
category: react-patterns
created: 2026-04-09
last_updated: 2026-04-09
ref_count: 0
---

# Async Race Conditions

## Summary

Async operations (file fetches, syntax highlighting) can resolve out of order
when inputs change rapidly (tab switching, fast navigation). Always track the
current request and discard stale responses. Clear state on new requests to
prevent showing previous data.

## Findings

### 1. Stale file content renders when switching tabs quickly

- **Source:** github-codex | PR #23 | 2026-04-04
- **Severity:** HIGH
- **File:** `src/features/editor/hooks/useFileContent.ts`
- **Finding:** `useFileContent` keeps previous content while new fetch is in-flight and doesn't guard against out-of-order responses
- **Fix:** Track requested path via ref, ignore stale responses, clear content on new fetch
- **Commit:** `397353a feat: add IDE-style Editor view with file explorer and syntax highlighting (#23)`

### 2. Async syntax highlighting applies stale results

- **Source:** github-codex | PR #23 | 2026-04-04
- **Severity:** MEDIUM
- **File:** `src/features/editor/components/CodeEditor.tsx`
- **Finding:** Async `highlightCode` in useEffect has no cancellation — slower prior highlight can overwrite current
- **Fix:** Added cancellation flag in effect cleanup
- **Commit:** `397353a feat: add IDE-style Editor view with file explorer and syntax highlighting (#23)`

### 3. Selected file index out of range after refresh

- **Source:** github-codex | PR #21 | 2026-04-03
- **Severity:** MEDIUM
- **File:** `src/features/diff/DiffView.tsx`
- **Finding:** After staging/discarding, `refreshStatus()` shrinks `changedFiles` but index is never clamped
- **Fix:** Clamped `selectedFileIndex` when `changedFiles` updates
- **Commit:** `92eff2e feat: add lazygit-style git diff viewer (#21)`

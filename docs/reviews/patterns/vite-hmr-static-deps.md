---
id: vite-hmr-static-deps
category: code-quality
created: 2026-06-18
last_updated: 2026-06-18
ref_count: 1
---

# Vite HMR Static Dependencies

## Summary

Vite's `import.meta.hot.accept()` analyzes dependency arrays at transform time using
static AST inspection. Passing a runtime expression (such as `.map(...)`) prevents
Vite from recognizing the listed modules as accepted boundaries, so edits fall back
to a full reload instead of invoking the targeted HMR callback. Keep the dependency
list as an explicit array of string literals that match the dynamic import or module
paths, and keep any indexed callback logic consistent with the literal array's order.

## Findings

### 1. Dynamic import.meta.hot.accept dependency list breaks Vite theme HMR

- **Source:** github-codex-connector | PR #532 round 1 | 2026-06-18
- **Severity:** MEDIUM
- **File:** `src/theme/service.ts`
- **Finding:** The changed line passes `themeModules.map(({ path }) => path)` into
  `import.meta.hot.accept()`. Vite requires static string literal dependencies for
  HMR boundary analysis, so theme edits will no longer be registered as accepted
  dependencies and will fall back to broader reload behavior instead of live theme
  re-apply.
- **Fix:** Restored a static literal dependency array containing all four theme
  module paths in the same order as `themeModules`, keeping the existing indexed
  callback logic intact.
- **Commit:** same commit as this entry

### 2. themeModules.path undocumented coupling to static HMR accept array order

- **Source:** github-claude | PR #532 round 2 | 2026-06-18
- **Severity:** LOW
- **File:** `src/theme/service.ts`
- **Finding:** Each `themeModules` entry carries a `path` field that visually implies it drives the HMR dependency list, but `import.meta.hot.accept` indexes `mods` positionally via `mods[index]`; `path` is never accessed outside the object literal. The invariant that `themeModules` and the static accept-array remain in identical order is undocumented.
- **Fix:** Added a comment directly above the static dependency array stating that positions must match `themeModules` order and referencing the index → exportName mapping.
- **Commit:** same commit as this entry

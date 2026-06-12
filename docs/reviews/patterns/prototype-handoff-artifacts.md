---
id: prototype-handoff-artifacts
category: review-process
created: 2026-06-12
last_updated: 2026-06-12
ref_count: 0
---

# Prototype Handoff Artifacts

## Summary

Design handoff directories should contain only the markdown documentation and
static reference assets needed to communicate the spec. Prototype source files
(`*.html`, `*.jsx`, `*.js`, etc.) that were used to iterate on the design should
not be included in the production PR, because they carry no runtime value, are
not covered by tests, and add noise to the diff and repository size.

## Findings

### 1. Exclude prototype HTML from production PR

- **Source:** github-human | PR #433 round 1 | 2026-06-12
- **Severity:** HUMAN
- **File:** `docs/design/leftsidebar/Sidebar Chrome.html`
- **Finding:** A hand-authored HTML prototype was included in the production PR under `docs/design/leftsidebar/`; the reviewer requested it be excluded.
- **Fix:** Removed `docs/design/leftsidebar/Sidebar Chrome.html` from the PR.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 2. Exclude prototype JSX/JS source from handoff documentation PR

- **Source:** github-human | PR #433 round 1 | 2026-06-12
- **Severity:** HUMAN
- **File:** `docs/design/sidebar-toggle-handoff/src/activity.jsx`
- **Finding:** The handoff documentation directory contained React/JS prototype source files (`*.jsx`, `*.js`) alongside markdown docs; the reviewer requested only markdown documentation remain in the production PR.
- **Fix:** Deleted the entire `docs/design/sidebar-toggle-handoff/src/` directory, leaving only the markdown handoff notes.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

---
id: platform-metadata-semantics
category: cross-platform
created: 2026-06-22
last_updated: 2026-06-22
ref_count: 1
---

# Platform Metadata Semantics

## Summary

Platform APIs and command-line tools often return values that already encode a
stronger semantic filter than their display names reveal. Do not re-filter a
trusted metadata result with a weaker heuristic unless the source lacks the
metadata entirely. Keep source-specific trust boundaries explicit so fallback
paths can remain conservative without discarding valid data from richer sources.

## Findings

### 1. Fontconfig monospace metadata was narrowed again by a family-name heuristic

- **Source:** github-codex-connector | PR #607 round 1 | 2026-06-22
- **Severity:** P2 / MEDIUM
- **File:** `crates/backend/src/settings/system_fonts.rs`
- **Finding:** `fc-list :spacing=100 family` already asks fontconfig for monospace families, but `list_system_fonts` applied `looks_like_monospace_family` to every source afterward. Valid monospace fonts whose family names lack hard-coded substrings, such as Terminus, were dropped from the selector even though fontconfig had already classified them as monospace.
- **Fix:** Split system font discovery by source semantics. Fontconfig results are now trusted directly, while the name heuristic remains on Windows registry names and the macOS `system_profiler` fallback where real spacing metadata is unavailable. Added a regression test pinning that Terminus survives the fontconfig parser path.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 2. Broad font-family stems admitted proportional fallback fonts

- **Source:** github-claude | PR #607 round 2 | 2026-06-22
- **Severity:** MEDIUM
- **File:** `crates/backend/src/settings/system_fonts.rs`
- **Finding:** Fallback paths without spacing metadata used broad substring stems such as `fira` and `input`, so proportional families like Fira Sans, Input Sans, and Input Serif could appear in the terminal font picker.
- **Fix:** Replaced the broad stems with explicit monospace needles: `fira code`, `fira mono`, `firacode`, and `input mono`. Added regression tests proving the intended monospace variants still match while proportional Fira/Input variants are rejected.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

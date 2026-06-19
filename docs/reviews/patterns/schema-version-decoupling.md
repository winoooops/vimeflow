---
id: schema-version-decoupling
category: correctness
created: 2026-06-19
last_updated: 2026-06-19
ref_count: 0
---

# Schema Version Decoupling

## Summary

Durable file formats and the schemas of nested records they contain evolve on
separate timelines. Reusing a top-level file-format version constant to gate
nested record schemas couples the two lifecycles and silently rejects still-
valid nested records whenever the file format bumps. Each nested schema should
carry its own explicit version constant so migrations can advance the file
format without orphaning records that conform to an older nested schema.

## Findings

### 1. Rust schema_version check reused workspace format version constant

- **Source:** github-claude | PR #542 round 1 | 2026-06-19
- **Severity:** MEDIUM
- **File:** `crates/backend/src/terminal/workspace_layout.rs`
- **Finding:** `is_valid_custom_pane_layout` compared `definition.schema_version` against `CURRENT_WORKSPACE_LAYOUT_VERSION`, the constant that governs the workspace file format's `version` field. Both happened to be `1` today, but a future workspace-format v2 migration would silently reject every stored v1 `PaneLayoutDefinition`, causing all user-created custom layouts to vanish without error.
- **Fix:** Introduced a dedicated `PANE_LAYOUT_SCHEMA_VERSION` constant and used it for the pane-layout schema check, decoupling it from the workspace file-format version.
- **Commit:** same commit as this entry

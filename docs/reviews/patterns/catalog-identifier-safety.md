---
id: catalog-identifier-safety
category: correctness
created: 2026-06-18
last_updated: 2026-06-18
ref_count: 0
---

# Catalog Identifier Safety

## Summary

When a central catalog defines identifiers that other parts of the codebase reference by string, a typo in one of those references can compile successfully and only surface as silent runtime misbehavior. Derive a strict, closed union type from the catalog itself, then use that union for cross-references and relationship fields so the type checker rejects invalid identifiers before the change ships.

## Findings

### 1. intentionalShadowWith is stringly typed instead of constrained to catalog command IDs

- **Source:** local-codex | PR #523 round 2 | 2026-06-18
- **Severity:** MEDIUM / adjudication
- **File:** `src/features/keymap/catalog.ts` L21
- **Finding:** The new intentionalShadowWith field controls whether the conflict detector suppresses the deliberately shared palette/palette-leader binding, but it is declared as readonly string[]. A typo in a future catalog entry would compile and then make intentionallyShadowed return false, producing a spurious keymap conflict for a relationship the catalog intended to allow.
- **Fix:** Derived CommandId from a literal CATALOG_LITERAL array before declaring CommandDescriptor, then changed intentionalShadowWith to readonly CommandId[] so future shadow pairs are type-checked against the actual command ids.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

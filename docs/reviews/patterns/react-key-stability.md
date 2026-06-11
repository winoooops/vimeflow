---
id: react-key-stability
category: react-patterns
created: 2026-06-11
last_updated: 2026-06-11
ref_count: 0
---

# React Key Stability

## Summary

React list keys must be stable and unique for the identity of each child.
Time-based IDs can collide when events fire within the same millisecond, and
array indices produce duplicate or shifting identities whenever items reorder.
Prefer collision-free identifiers (`crypto.randomUUID()`, ref counters) and
stable composite keys derived from item identity.

## Findings

### 1. Date.now() for new-alias IDs risks React key collision

- **Source:** github-claude | PR #422 round 6 | 2026-06-11
- **Severity:** LOW
- **File:** `src/features/settings/components/panes/AgentsPane.tsx`
- **Finding:** `addAlias` generated new alias rows with `` `id: `a${Date.now()}` ``. A fast double-click or keyboard repeat could create two rows within the same millisecond, producing duplicate React `key` values and misapplied state updates.
- **Fix:** Switched to `` `id: `a${crypto.randomUUID()}` ``, which is collision-free in modern Electron renderer contexts.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 2. Array index used as key for Kbd chips in KeymapPane

- **Source:** github-claude | PR #422 round 6 | 2026-06-11
- **Severity:** LOW
- **File:** `src/features/settings/components/panes/KeymapPane.tsx`
- **Finding:** `b.keys.map((k, j) => <Kbd key={j}>{k}</Kbd>)` used the array index as the React key. If the key array is ever reordered (e.g., by a future preset editor), React may misplace chip DOM nodes and apply stale transitions.
- **Fix:** Replaced the index key with a stable composite key `` `key={\`${b.id}-${k}\`}` `` derived from the binding id and the key character.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

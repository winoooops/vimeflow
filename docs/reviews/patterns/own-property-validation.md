---
id: own-property-validation
category: correctness
created: 2026-06-22
last_updated: 2026-06-22
ref_count: 0
---

# Own Property Validation

## Summary

When validating user-controlled strings against an object-backed allowlist, use
an own-property check instead of the `in` operator. The `in` operator walks the
prototype chain, so values such as `toString` or `__proto__` can pass validation
even though they are not declared allowlist entries. This is especially risky
when the validated string is later used to index the same object.

## Findings

### 1. Swell variant resolver accepted prototype-chain keys

- **Source:** github-codex-connector | PR #604 | 2026-06-22
- **Severity:** MEDIUM
- **File:** `src/features/agent-status/hooks/useReservoirFlow.ts` L45-46
- **Finding:** `resolveSwellVariant` used `value in SWELL_PRESETS` to validate
  `reservoirSwell` from user-editable settings. Prototype-chain keys such as
  `toString` or `__proto__` passed the check, so the resolver could return a
  non-preset value that later produced undefined animation parameters.
- **Fix:** Replaced the `in` check with
  `Object.prototype.hasOwnProperty.call(SWELL_PRESETS, value)` and added a
  regression test for prototype-chain keys.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

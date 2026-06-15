---
id: boolean-sentinel-consistency
category: code-quality
created: 2026-06-15
last_updated: 2026-06-15
ref_count: 0
---

# Boolean Sentinel Consistency

## Summary

When a boolean prop must be explicitly set to `false` because the component's
default is `true`, prefer a single shared sentinel over ad-hoc module-level
constants. Scattering `const <name> = true` definitions across a codebase makes
the suppression pattern hard to discover, invites inconsistent naming, and
encourages future contributors to invent yet another name for the same intent.

## Findings

### 1. `showTooltip` suppression uses 12 differently named `true` constants

- **Source:** github-claude | PR #454 round 2 | 2026-06-15
- **Severity:** LOW
- **File:** 10 files, including `src/features/workspace/components/panels/FileExplorer.tsx`, `src/features/diff/components/toolbar/PriorityPlus.tsx`, `src/features/sessions/components/Card.tsx`
- **Finding:** Each `IconButton` that needed `showTooltip={false}` defined its own module-level `const <name> = true`, then passed `showTooltip={!<name>}`. Names mixed casing and rationale (`LABELLED_BY_OUTER_TOOLTIP`, `labelledByOuterTooltip`, `GUTTER_TOOLTIP_SUPPRESSED`, `suppressCopyTooltip`, `menuTriggerHasMenu`, etc.). The double negation and name proliferation made the pattern un-greppable.
- **Fix:** Removed all local constants, introduced a shared `TOOLTIP_SUPPRESSED = false` sentinel in `src/lib/constants.ts`, and imported it at every suppression site. Each call site now passes `showTooltip={TOOLTIP_SUPPRESSED}` with a short inline comment explaining why the outer tooltip owns the label.
- **Commit:** same commit as this entry

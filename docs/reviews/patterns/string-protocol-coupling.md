---
id: string-protocol-coupling
category: code-quality
created: 2026-06-19
last_updated: 2026-06-20
ref_count: 1
---

# String Protocol Coupling

## Summary

When one module owns a structured-string protocol (for example `prefix:<id>`
result keys or `type:<namespace>:<name>` identifiers), any other module that
parses the same format is a latent break. Renaming or extending the protocol in
its owner silently breaks the downstream parser with no type-checker warning and
often no runtime error until an accessibility or correctness path misfires.
Centralize the parser alongside the formatter so the protocol is authored and
consumed in one place.

## Findings

### 1. SettingsSidebar re-implements the section:/target: result-key protocol

- **Source:** github-claude | PR #544 round 2 | 2026-06-19
- **Severity:** MEDIUM
- **File:** `src/features/settings/components/SettingsSidebar.tsx` L19-29
- **Finding:** `resultIdFromKey` parsed `section:<id>` and `target:<id>` inline and converted the slice to a `SettingsSectionId` with `as SettingsSectionId`. The key format was already owned by `settingsSectionResultKey` / `settingsTargetResultKey` in `search.ts`. A future rename of either prefix would make `resultIdFromKey` return `undefined` for every key, silently clearing `aria-activedescendant` with no console error.
- **Fix:** Exported `resultKeyToAriaId(key: string): string | undefined` from `search.ts` next to the key constructors and replaced `resultIdFromKey` in `SettingsSidebar.tsx` with an import and call to the new helper.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

### 2. SettingsContent duplicated sidebar search-result DOM IDs

- **Source:** github-claude | PR #556 round 3 | 2026-06-20
- **Severity:** LOW
- **File:** `src/features/settings/SettingsContent.tsx` L50-55
- **Finding:** `settingsNavigationEntryElementId` independently constructed
  `settings-search-result-section-*` and `settings-search-result-subsection-*`
  IDs already owned by `SettingsSidebar`. If either copy changed, the content
  keyboard handler's `getElementById(...).focus()` path would silently stop
  syncing focus to the selected sidebar row.
- **Fix:** Promoted section, target, and subsection result ID helpers to
  `search.ts` next to the result-key helpers, then imported those shared helpers
  from both `SettingsSidebar` and `SettingsContent`.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

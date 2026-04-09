---
id: csp-configuration
category: security
created: 2026-04-09
last_updated: 2026-04-09
ref_count: 0
---

# CSP Configuration

## Summary

Content Security Policy in Tauri apps must be strict — no `unsafe-inline` for
styles or scripts. In Tauri v2, CSP config must be at the top level of
`tauri.conf.json`, not nested under `app`. Always verify the policy is actually
applied, not just declared.

## Findings

### 1. CSP allows unsafe-inline styles

- **Source:** github-codex | PR #27 | 2026-04-05
- **Severity:** HIGH
- **File:** `src-tauri/tauri.conf.json`
- **Finding:** CSP includes `style-src 'unsafe-inline'`, weakening XSS defenses by allowing injected inline styles
- **Fix:** Removed `unsafe-inline` from `style-src`, switched to class-based styles
- **Commit:** `9ce4d61 feat: Phase 1 - Tauri scaffold with v2 configuration (#27)`

### 2. CSP config nested under wrong key in Tauri v2

- **Source:** github-codex | PR #27 | 2026-04-05
- **Severity:** MEDIUM
- **File:** `src-tauri/tauri.conf.json`
- **Finding:** `security` nested under `app` which Tauri v2 doesn't read for CSP — policy likely not applied
- **Fix:** Moved `security` to top level of `tauri.conf.json`
- **Commit:** `9ce4d61 feat: Phase 1 - Tauri scaffold with v2 configuration (#27)`

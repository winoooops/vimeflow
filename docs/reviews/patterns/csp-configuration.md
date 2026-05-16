---
id: csp-configuration
category: security
created: 2026-04-09
last_updated: 2026-05-16
ref_count: 4
---

# CSP Configuration

## Summary

Content Security Policy in desktop app shells must be strict by default and
must keep dev-only relaxations explicit. In Tauri v2, CSP config must be at the
top level of `tauri.conf.json`, not nested under `app`. In Electron, dev and
E2E policies should stay separate so test-only inline-script permissions do not
silently leak into regular development sessions. Always verify the policy is
actually applied, not just declared.

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

### 3. Electron dev and E2E CSP policies collapsed

- **Source:** github-claude | PR #214 | 2026-05-16
- **Severity:** MEDIUM
- **File:** `electron/main.ts`, `vite.config.ts`
- **Finding:** Regular Electron dev and E2E both used a dev CSP with `script-src 'unsafe-inline'`, making the E2E runtime switch a no-op and allowing inline script execution in every `electron:dev` session.
- **Fix:** Split CSP construction into a tested Electron module. Regular dev now allows Vite React Refresh through a generated nonce on the injected preamble, while E2E keeps the separate `unsafe-inline` policy needed for WDIO injection.
- **Commit:** _(see git log for the PR #214 CSP review-fix commit)_

### 4. Dev CSP nonce committed as a source-known constant

- **Source:** github-claude | PR #214 | 2026-05-16
- **Severity:** MEDIUM
- **File:** `electron/csp.ts`, `vite.config.ts`
- **Finding:** The first Electron dev CSP fix used a compile-time nonce string, so any injected script that copied the source-known value could pass `script-src` and bypass the intended regular-dev hardening.
- **Fix:** Generate an opaque nonce per Vite dev-server process, store it in an environment variable inherited by Electron main, and use the same value for both the CSP header and the Vite React Refresh preamble transform.
- **Commit:** _(see git log for the PR #214 static-nonce review-fix commit)_

### 5. Dev CSP nonce accepted untrusted environment text into an HTML attribute

- **Source:** github-claude | PR #214 | 2026-05-16
- **Severity:** LOW
- **File:** `electron/csp.ts`
- **Finding:** The dev React Refresh nonce could come from `VIMEFLOW_DEV_REACT_REFRESH_NONCE` and was interpolated directly into both CSP and the transformed HTML script attribute. A value containing quotes or whitespace could break the attribute shape even though the generated nonce was safe.
- **Fix:** Validate all provided nonce values as non-empty base64url before using them in a CSP directive or HTML transform. Generated nonces already use Node's `base64url` encoding, so the validation pins the boundary between generated and environment-provided values.
- **Commit:** _(see git log for the PR #214 nonce-validation review-fix commit)_

### 6. React Refresh nonce transform matched only one Vite preamble import shape

- **Source:** github-codex-connector | PR #214 | 2026-05-16
- **Severity:** P2 / MEDIUM
- **File:** `electron/csp.ts`
- **Finding:** The nonce transform matched only a named `injectIntoGlobalHook` import from `@react-refresh`. If Vite emitted the React Refresh preamble with a default runtime import, the inline preamble would stay nonce-less and regular dev would regress to a blocked blank renderer.
- **Fix:** Match React Refresh preamble scripts by a leading module import whose source contains `@react-refresh`, covering both named and default runtime import shapes while leaving unrelated module scripts untouched.
- **Commit:** _(see git log for the PR #214 React Refresh nonce-transform review-fix commit)_

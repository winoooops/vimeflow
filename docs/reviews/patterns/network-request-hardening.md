---
id: network-request-hardening
category: security
created: 2026-06-08
last_updated: 2026-06-08
ref_count: 1
---

# Network Request Hardening

## Summary

Network helpers that enforce SSRF, private-network, credential, or redirect
policy need to re-apply the same checks to every URL that can influence the
final connection target. Blocking an unsafe redirect is correct; silently
blocking every redirect can also make a feature non-functional because CDN and
asset hosts commonly redirect first-party URLs.

## Findings

### 1. Favicon fetch discarded safe HTTP redirects instead of revalidating the target

- **Source:** github-claude | PR #404 final review | 2026-06-08
- **Severity:** MEDIUM
- **File:** `electron/browser-pane.ts`
- **Finding:** The vetted favicon fetch returned `null` for every 3xx response. That preserved SSRF safety but dropped common CDN favicon redirects, so many real favicons never appeared.
- **Fix:** Return a redirect result for 3xx responses with `Location`, resolve the location relative to the source URL, reject credentials and non-HTTP(S) schemes, then pass the redirect URL through the same DNS/PNA `resolveFaviconFetchTarget` gate before one retry. Added tests for a safe public redirect and a public page redirecting to a private target.
- **Commit:** same commit as this entry

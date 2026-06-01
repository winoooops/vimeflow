---
id: credential-leakage
category: security
created: 2026-05-31
last_updated: 2026-05-31
ref_count: 0
---

# Credential Leakage

## Summary

Secret files (OAuth tokens, API keys, bearer tokens) referenced in code must be explicitly ignored by version control. A common failure mode is adding a new secret-loading mechanism or env-file path without updating `.gitignore`, leaving the secret trackable. Even when the code comments claim the files are "gitignored", the actual ignore rules may lag behind, creating a silent credential-leakage risk on the next `git add .`.

## Findings

### 1. Add the agent token files to .gitignore

- **Source:** github-codex-connector | PR #321 round 1 | 2026-05-31
- **Severity:** P1 / HIGH
- **File:** `scripts/qa-runner/lib/linear-status.mjs`
- **Finding:** The new role token files (`linear-agent.env`, `linear-orchestrator.env`) are read as local OAuth secret stores, but only `linear.env` is covered in `.gitignore`. A normal `git add .` can commit the bearer token despite the comment saying the files are gitignored.
- **Fix:** Added `linear-*.env` to `.gitignore` so all role-specific Linear agent token files are ignored.
- **Commit:** same commit as this entry

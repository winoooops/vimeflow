---
id: service-privilege-boundary
category: security
created: 2026-06-04
last_updated: 2026-06-04
ref_count: 1
---

# Service Privilege Boundary

## Summary

Systemd units and persistent daemons must run with the least privilege required.
A unit without `User=` and `Group=` defaults to root. On a daemon that is
network-facing, spawns child processes, and holds orchestration secrets, root is
an unnecessary and high-impact blast radius.

Rules of thumb:

- **Always specify `User=` and `Group=` in systemd `[Service]` sections.**
- **Create the service account before enabling the unit.** Use `--system` for
  machine-wide services; ensure the home directory and working directory are
  owned by that user.
- **Bootstrap scripts that write secrets must `chown` files to the service user.**
  Secret env files with mode `0600` are unreadable by the service if created as
  root without changing ownership.
- **Document the account in the deployment runbook.** Future operators need to
  know the account exists and why.

## Findings

### 1. Systemd unit runs control daemon as root

- **Source:** github-claude | PR #349 round 1 | 2026-06-04
- **Severity:** HIGH
- **File:** `scripts/qa-runner/deploy/qa-runner.service`
- **Finding:** The `[Service]` section omitted `User=` and `Group=`, so systemd
  defaulted to root. This is a webhook-facing daemon that holds
  `GITHUB_WEBHOOK_SECRET`, spawns child processes, and dispatches remote
  commands. Any daemon, dependency, or webhook-handler compromise becomes full
  root compromise on the control host.
- **Fix:** Added `User=vimeflow-qa` and `Group=vimeflow-qa` to the `[Service]`
  section. Updated the bootstrap runbook to create the system user, set
  `WorkingDirectory` ownership, and ensure the bootstrap helper
  (`control-env-from-ssm.sh`) writes secret env files owned by the service
  account.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

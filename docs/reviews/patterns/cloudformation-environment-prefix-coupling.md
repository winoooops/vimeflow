---
id: cloudformation-environment-prefix-coupling
category: infrastructure
created: 2026-06-12
last_updated: 2026-06-12
ref_count: 0
---

# CloudFormation Environment Prefix Coupling

## Summary

Infrastructure parameters that scope shared resources (such as SSM Parameter Store
prefixes) must be explicitly coupled to the deployment environment. Defaulting an
environment-scoped parameter to a production path while leaving the environment name
configurable lets a non-prod stack silently inherit prod state. Prefer required
parameters with no prod default, or derive the scoped path directly from the
environment name, so operators must make the coupling visible at deploy time.

## Findings

### 1. Non-prod EnvironmentName can still use prod SSM parameter prefixes by default

- **Source:** github-claude | PR #435 round 3 | 2026-06-12
- **Severity:** MEDIUM
- **File:** `scripts/qa-runner/deploy/cloudformation/qa-runner-split-plane.yml`
- **Finding:** `ControlParameterPrefix` and `WorkerParameterPrefix` defaulted to `/vimeflow/qa-runner/prod/...` while `EnvironmentName` was independently configurable. A non-prod deployment could change `EnvironmentName` but leave the prefixes at prod defaults, causing the stack to read prod SSM paths.
- **Fix:** Removed the prod defaults from both prefix parameters so they are required, updated their descriptions to state the environment coupling, and updated `docs/architecture/qa-runner-split-plane-cloudformation.md` deployment examples to show explicit, environment-matched prefix overrides.
- **Commit:** same commit as this entry (see `git blame` / `git log` on this line)

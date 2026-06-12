---
id: cloudformation-stale-references
category: infrastructure
created: 2026-06-12
last_updated: 2026-06-12
ref_count: 1
---

# CloudFormation Stale Resource References

## Summary

Long-lived infrastructure defaults should not reference transient values
(feature-branch names, physical resource IDs, or WIP refs) that become invalid
after merge cleanup or resource replacement. CloudFormation parameter defaults
persist beyond the branch or resource lifecycle; stale defaults cause runtime
bootstrap failures even though the stack itself deploys successfully. Prefer
stable branch defaults (`main`) for git refs, stack-managed SSM parameters for
updateable resource lookups, and scope IAM permissions by stack-unique tags
rather than a single physical resource ARN.

## Findings

### 1. Control host persisted worker EC2 instance ID in UserData env file

- **Source:** github-codex-connector | PR #435 | 2026-06-12
- **Severity:** HIGH
- **File:** `scripts/qa-runner/deploy/cloudformation/qa-runner-split-plane.yml`
- **Finding:** The control host's UserData wrote `QA_WORKER_INSTANCE_ID=${WorkerInstance}` into `/etc/vimeflow/qa-runner/stack.env`; worker replacement would leave the control daemon targeting a terminated instance.
- **Fix:** Replaced the boot-time `QA_WORKER_INSTANCE_ID` value with `QA_WORKER_INSTANCE_ID_PARAMETER=${ControlParameterPrefix}worker-instance-id`, added a CloudFormation-managed `AWS::SSM::Parameter` that tracks `!Ref WorkerInstance`, added `scripts/qa-runner/lib/worker-instance.mjs` to resolve the current worker ID at runtime, and scoped control-role `ec2:StartInstances`/`ec2:StopInstances`/`ssm:SendCommand` by the stack-unique `Component` and `StackName` tags so worker replacement does not stale the IAM boundary.
- **Commit:** `6f6f103 fix(#435): address stale worker instance ID in qa runner cloudformation`

### 2. WorkerRunnerRef parameter defaulted to transient WIP branch

- **Source:** github-claude | PR #435 | 2026-06-12
- **Severity:** MEDIUM
- **File:** `scripts/qa-runner/deploy/cloudformation/qa-runner-split-plane.yml`
- **Finding:** The `WorkerRunnerRef` parameter defaulted to `wip/linear-wiring`, the active feature branch. After merge and branch deletion, default deployments would write a dead git ref into the worker's `stack.env` as `QA_WORKER_REF`, causing worker bootstrap/refresh steps to fail on `git checkout` or `git pull`.
- **Fix:** Changed the `WorkerRunnerRef` default from `wip/linear-wiring` to `main`. Operators can still override the parameter at deploy time for non-main refs.
- **Commit:** `0ce1e7b fix(#435): address review round 1 findings`

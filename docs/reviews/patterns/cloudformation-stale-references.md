---
id: cloudformation-stale-references
category: infrastructure
created: 2026-06-12
last_updated: 2026-06-12
ref_count: 0
---

# CloudFormation Stale Resource References

## Summary

Long-lived EC2 instances or daemons should not cache physical resource IDs
(such as another instance's ID) in boot-time configuration. When CloudFormation
replaces the referenced resource, the cached value becomes stale and the
consumer breaks. Prefer stack-managed SSM parameters for updateable lookups,
and scope IAM permissions by stack-unique tags rather than a single physical
resource ARN.

## Findings

### 1. Control host persisted worker EC2 instance ID in UserData env file

- **Source:** github-codex-connector | PR #435 | 2026-06-12
- **Severity:** HIGH
- **File:** `scripts/qa-runner/deploy/cloudformation/qa-runner-split-plane.yml`
- **Finding:** The control host's UserData wrote `QA_WORKER_INSTANCE_ID=${WorkerInstance}` into `/etc/vimeflow/qa-runner/stack.env`; worker replacement would leave the control daemon targeting a terminated instance.
- **Fix:** Replaced the boot-time `QA_WORKER_INSTANCE_ID` value with `QA_WORKER_INSTANCE_ID_PARAMETER=${ControlParameterPrefix}worker-instance-id`, added a CloudFormation-managed `AWS::SSM::Parameter` that tracks `!Ref WorkerInstance`, added `scripts/qa-runner/lib/worker-instance.mjs` to resolve the current worker ID at runtime, and scoped control-role `ec2:StartInstances`/`ec2:StopInstances`/`ssm:SendCommand` by the stack-unique `Component` and `StackName` tags so worker replacement does not stale the IAM boundary.
- **Commit:** `6f6f103 fix(#435): address stale worker instance ID in qa runner cloudformation`

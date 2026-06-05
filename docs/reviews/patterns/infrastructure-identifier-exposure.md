---
id: infrastructure-identifier-exposure
category: security
created: 2026-06-05
last_updated: 2026-06-05
ref_count: 0
---

# Infrastructure Identifier Exposure

## Summary

Operational documentation and runbooks often contain real infrastructure
identifiers — AWS account IDs, EC2 instance IDs, EBS volume IDs, load balancer
ARNs, and resource names. These are not credentials, but they materially assist
targeted reconnaissance: an attacker can craft valid ARNs, confirm resource
existence, and build an attack surface map without ever needing IAM credentials.
The fix is always the same: replace live identifiers with descriptive
placeholders in any source-controlled document, and maintain the live inventory
in a private ops channel or gitignored notes file.

## Findings

### 1. Live AWS account ID, instance IDs, and EBS volume ID in source

- **Source:** github-claude | PR #349 round 1 | 2026-06-05
- **Severity:** MEDIUM
- **File:** `docs/qa-runner-cloud-infra.md`
- **Finding:** The `## Live Inventory` section contained real production AWS identifiers: account `852499864701`, EC2 instances `i-01ae8a883476f5f7c` and `i-0a56358fbc68ba6b7`, EBS volume `vol-072f96adc91f9b7e8`. In a public GitHub repo these reveal the live infrastructure footprint and let an attacker craft valid IAM ARNs, confirm resource existence, or target reconnaissance.
- **Fix:** Replaced all live identifiers with descriptive placeholders (`<aws-account-id>`, `i-<control-host-id>`, `i-<existing-non-qa-host-id>`, `vol-<control-root-ebs-id>`).
- **Commit:** same commit as this entry

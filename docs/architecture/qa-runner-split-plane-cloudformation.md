# QA Runner Split-Plane CloudFormation Architecture

Tracking:

- Linear execution issue: `VIM-73` - deploy and smoke test QA runner cloud control and burst worker.
- Linear parent architecture issue: `VIM-18` - low-cost split-plane QA runner infrastructure.
- Existing sanitized runtime inventory: Linear document "VIM-70 Cloud Infrastructure Configuration - Sanitized".
- Template: [qa-runner-split-plane.yml](../../scripts/qa-runner/deploy/cloudformation/qa-runner-split-plane.yml)

This document records the repo-owned CloudFormation shape for the QA runner cloud runtime. It intentionally does not include token values, API keys, OAuth secrets, webhook secrets, Cloudflare tunnel tokens, or local auth JSON.

## Intent

The QA runner should keep a low always-on cost floor while still having enough compute for expensive fixer loops. The architecture uses a split-plane model:

- A small always-on control host owns webhook ingress, PR classification, queue state, Linear/GitHub comments, and approval/merge authority.
- A larger burst worker runs Kimi, Codex, npm/Rust checks, and fix pushes only when a PR reaches `NEEDS_FIX`.
- AWS Systems Manager is the operational access path. Public inbound SSH is optional and should normally remain closed.
- Cloudflare Tunnel handles public GitHub webhook ingress without an ALB, NLB, NAT Gateway, or Elastic IP.

## Diagram

<style scoped>.qa-arch{font-family:Inter,Arial,sans-serif;border:1px solid #cbd5e1;border-radius:8px;padding:16px;background:#f8fafc;color:#0f172a}.qa-arch h3{margin:0 0 12px 0;font-size:16px}.qa-layer{border:1px solid #dbe4ee;border-radius:8px;background:#fff;margin:10px 0;padding:10px}.qa-layer-title{font-weight:700;font-size:12px;text-transform:uppercase;color:#334155;margin-bottom:8px}.qa-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.qa-box{border:1px solid #cbd5e1;border-radius:6px;padding:8px;background:#f8fafc;font-size:12px;line-height:1.35}.qa-box strong{display:block;margin-bottom:3px;color:#111827}.qa-box small{color:#475569}.qa-highlight{border-color:#2563eb;background:#eff6ff}.qa-warning{border-color:#ca8a04;background:#fefce8}.qa-note{font-size:11px;color:#475569;margin-top:8px}</style>
<div class="qa-arch"><h3>Vimeflow QA Runner Cloud Runtime</h3><div class="qa-layer"><div class="qa-layer-title">Ingress and Control Plane</div><div class="qa-grid"><div class="qa-box"><strong>GitHub PR Events</strong><small>webhook events and polling fallback</small></div><div class="qa-box"><strong>Cloudflare Tunnel</strong><small>public hostname to local control port</small></div><div class="qa-box qa-highlight"><strong>Control EC2</strong><small>t2.micro, daemon, state, Linear/GitHub comments, merge authority</small></div></div></div><div class="qa-layer"><div class="qa-layer-title">Execution Plane</div><div class="qa-grid"><div class="qa-box"><strong>SSM Dispatch</strong><small>control starts worker and sends fixer command</small></div><div class="qa-box qa-highlight"><strong>Spot Worker EC2</strong><small>t3.medium default, Kimi/Codex/tests, fix pushes</small></div><div class="qa-box"><strong>Retained Auth EBS</strong><small>encrypted gp3 volume mounted for worker auth state</small></div></div></div><div class="qa-layer"><div class="qa-layer-title">Secrets and Guardrails</div><div class="qa-grid"><div class="qa-box"><strong>SSM Parameters</strong><small>control and worker prefixes; no secret values in template</small></div><div class="qa-box"><strong>No Public Ingress</strong><small>egress-only security groups; SSM for operators</small></div><div class="qa-box qa-warning"><strong>Cost Boundary</strong><small>always-on control, stopped worker when idle, retained EBS billed</small></div></div></div><div class="qa-note">CloudFormation owns IAM, security groups, EC2 instances, and the retained auth volume. Runtime bootstrap and secret material stay in SSM/runbooks.</div></div>

## CloudFormation Scope

The template creates:

- `ControlSecurityGroup` and `WorkerSecurityGroup` with no ingress rules and outbound access only.
- `ControlRole` and `WorkerRole` with `AmazonSSMManagedInstanceCore`.
- Control IAM permissions to start/stop the worker, describe worker state, send `AWS-RunShellScript` through SSM, and read only the configured control SSM parameter prefix.
- Worker IAM permissions to read only the configured worker SSM parameter prefix.
- `ControlInstance` with IMDSv2 required, encrypted gp3 root volume, and stack metadata written to `/etc/vimeflow/qa-runner/stack.env`.
- `WorkerInstance` with IMDSv2 required, encrypted gp3 root volume, optional Spot market settings, and stack metadata written to `/etc/vimeflow/qa-runner/stack.env`.
- `WorkerAuthVolume`, an encrypted gp3 EBS volume with `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain`.
- `WorkerAuthVolumeAttachment` at `/dev/sdf`.

The template deliberately does not create secret parameters. Operators should create or import the existing SecureString values under:

- `/vimeflow/qa-runner/prod/control/`
- `/vimeflow/qa-runner/prod/worker/`

## Parameter Strategy

The template avoids hardcoded resource IDs and physical names. Deployment supplies:

- `VpcId` and `SubnetId` for the target AWS network.
- `ControlAmiId` and `WorkerAmiId` for the chosen Linux images.
- `ControlInstanceType`, default `t2.micro`, so the control host can consume the existing `t2` Savings Plan in `us-west-1`.
- `WorkerInstanceType`, default `t3.medium`, for fixer/test workload headroom.
- `EnableWorkerSpot`, default `true`, for lower burst compute cost.
- `AssociatePublicIpAddress`, default `true`, to avoid a NAT Gateway when using a public subnet.
- `ControlParameterPrefix` and `WorkerParameterPrefix` to scope IAM reads.

## Deployment Flow

Recommended preflight:

```bash
cfn-lint scripts/qa-runner/deploy/cloudformation/qa-runner-split-plane.yml
aws cloudformation validate-template \
  --template-body file://scripts/qa-runner/deploy/cloudformation/qa-runner-split-plane.yml \
  --region us-west-1
```

Deploy:

```bash
aws cloudformation deploy \
  --stack-name vimeflow-qa-runner-prod \
  --template-file scripts/qa-runner/deploy/cloudformation/qa-runner-split-plane.yml \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-west-1 \
  --parameter-overrides \
    EnvironmentName=prod \
    VpcId=vpc-REPLACE \
    SubnetId=subnet-REPLACE \
    ControlAmiId=ami-REPLACE \
    WorkerAmiId=ami-REPLACE
```

Use a change set for the first production cutover if replacing existing hand-built resources:

```bash
aws cloudformation create-change-set \
  --stack-name vimeflow-qa-runner-prod \
  --change-set-name preview-qa-runner-prod \
  --template-body file://scripts/qa-runner/deploy/cloudformation/qa-runner-split-plane.yml \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-west-1 \
  --parameters file://parameters.json
```

If change-set creation fails, inspect validation events with:

```bash
aws cloudformation describe-events \
  --change-set-id CHANGE_SET_ARN \
  --region us-west-1
```

## Runtime Bootstrap Boundary

CloudFormation establishes the AWS resources and writes non-secret stack metadata. It does not fully configure the daemon. After stack creation:

1. Confirm SSM agent connectivity for both instances.
2. Create or verify SecureString parameters under the control and worker prefixes.
3. Clone or update the repository on the control host, normally under `/opt/vimeflow/repo`.
4. Install Node, git, GitHub CLI, cloudflared, and runner dependencies.
5. Install `qa-runner.service` and keep daemon state/logs outside the repo checkout.
6. Install Cloudflare Tunnel as a service and route `qa-runner.winoooops.com` to `127.0.0.1:8787`.
7. Configure the worker checkout and auth volume mount.
8. Run `auto-review` smoke tests with approval disabled before adding `auto-approve`.

## Cost and Security Notes

- The control host is the only intended always-on compute resource.
- The worker can stop between fixer cycles; EC2 compute stops billing while the instance is stopped.
- Attached EBS volumes still bill while the worker is stopped.
- The retained auth volume is deliberate; it preserves worker auth across stop/start and stack replacement.
- Avoid Elastic IPs, NAT Gateway, ALB, and NLB unless a later requirement justifies the fixed hourly cost.
- Keep no public inbound rules by default. Use SSM Session Manager for access.
- Never print secret values in SSM command output, systemd units, GitHub comments, Linear comments, or runbooks.

## PR-Linking Impact

This branch also changes the QA runner so an armed run patches PR bodies with a Linear identifier when one is missing. For infrastructure work, prefer linking to the existing `VIM-73` issue rather than creating a duplicate issue. If a PR has no issue reference and no existing matching issue can be found by the runner, it will create one and append `Refs VIM-N` to the PR body.

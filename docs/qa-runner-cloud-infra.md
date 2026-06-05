# QA Runner Cloud Infrastructure

VIM-70 owns the production split-plane rollout for the QA runner.

The target shape is one lightweight control host that owns webhooks, queue state,
Linear comments, and merge decisions, plus a burst worker that runs Kimi, Codex,
Lifeline, tests, and PR fix pushes only when a PR needs compute.

## Planes

### Control Host

- Region: `us-west-1`.
- Initial instance family: `t2.micro`, so the existing `t2` EC2 Savings Plan can
  cover the always-on floor.
- Runs:
  - `cloudflared`.
  - `node scripts/qa-runner/daemon.js`.
  - persistent `.state`, `.locks`, and logs.
  - GitHub webhook HMAC verification.
  - `/status` protected by `QA_STATUS_TOKEN`.
  - GitHub/Linear orchestrator credentials.
- Does not run Kimi/Codex/test compute in cloud mode.

### Burst Worker

- Starts as one worker slot; scale-out is a later step after one worker is proven.
- Runs a neutral checkout of the repo.
- Each PR cycle creates its own `.claude/worktrees/qa-pr-N` worktree.
- Holds the fixer credentials and tool auth needed by `run.js`.
- Keeps Kimi Code auth on a persistent encrypted EBS volume or a reusable worker
  image boundary. Do not copy the local developer auth directory ad hoc.
- May be stopped between runs. Stopped EC2 compute does not bill, but the worker
  EBS volume, snapshots, and any unattached Elastic IP still can.

## Credential Boundary

Control host credentials:

- `GITHUB_WEBHOOK_SECRET`
- `QA_STATUS_TOKEN`
- `orchestrator.env`
- `linear-orchestrator.env`
- Cloudflare Tunnel token or locally managed tunnel credentials

Worker credentials:

- `bot.env`
- `linear-agent.env`
- Codex auth
- Kimi Code auth
- GitHub CLI auth for the fixer account
- Lifeline installation/config

Shared rule: secrets live in SSM Parameter Store or root-owned env files with
`0600` permissions. Do not pass secrets through `QA_TICK_COMMAND`, SSM command
arguments, systemd unit text, GitHub comments, or Linear comments.

Use the checked-in bootstrap helpers to materialize role-specific env files:

```bash
# control host
sudo /opt/vimeflow/repo/scripts/qa-runner/deploy/control-env-from-ssm.sh

# worker host
sudo /opt/vimeflow/repo/scripts/qa-runner/deploy/worker-env-from-ssm.sh
```

The scripts fetch SecureString values with decryption and write only local env
files. They do not print secret values.

## Control Daemon Mode

Create the dedicated service account before installing the unit. The daemon must
not run as root:

```bash
sudo useradd --system --home-dir /opt/vimeflow/repo --user-group vimeflow-qa
sudo chown -R vimeflow-qa:vimeflow-qa /opt/vimeflow/repo
sudo install -d -m 0700 -o vimeflow-qa -g vimeflow-qa /etc/vimeflow/qa-runner
```

Use command mode so the control host forwards one claimed PR cycle to a worker:

```bash
sudo cp /opt/vimeflow/repo/scripts/qa-runner/deploy/qa-runner.service \
  /etc/systemd/system/qa-runner.service
sudo /opt/vimeflow/repo/scripts/qa-runner/deploy/control-env-from-ssm.sh
sudo systemctl daemon-reload
sudo systemctl enable --now qa-runner
```

The service receives its environment from
`/etc/vimeflow/qa-runner/control.env`. The equivalent daemon shape is:

```bash
QA_MAX_PARALLEL=1 \
QA_TICK_RUNNER=command \
QA_TICK_COMMAND="node /opt/vimeflow/repo/scripts/qa-runner/dispatch-worker.js" \
node /opt/vimeflow/repo/scripts/qa-runner/daemon.js
```

`auto-review` opts a PR into daemon work. `auto-approve` only arms approval and
merge for an already eligible PR.

## Worker Dispatch

The dispatcher supports three modes.

### Local Mode

Local mode is for smoke testing the command seam before using AWS:

```bash
QA_WORKER_MODE=local \
QA_WORKER_REPO=/opt/vimeflow/repo \
node /opt/vimeflow/repo/scripts/qa-runner/dispatch-worker.js
```

The daemon supplies the PR-cycle variables:

- `QA_PR`
- `QA_REASON`
- `QA_LABEL`
- `QA_APPROVE`
- `QA_LINEAR_DECISION_COMMENTS`
- `QA_LINEAR_CREATE_ISSUES`
- `QA_LINEAR_TEAM_KEY`
- `QA_MAX_CI_RERUNS`

### SSH Mode

SSH mode is simplest when the worker is already running:

```bash
QA_WORKER_MODE=ssh \
QA_WORKER_HOST=worker.internal \
QA_WORKER_USER=qa \
QA_WORKER_REPO=/opt/vimeflow/repo \
QA_WORKER_SSH_OPTIONS="-o BatchMode=yes -o StrictHostKeyChecking=accept-new" \
node /opt/vimeflow/repo/scripts/qa-runner/dispatch-worker.js
```

The remote command runs:

```bash
node /opt/vimeflow/repo/scripts/qa-runner/worker-cycle.js
```

### SSM Mode

SSM mode avoids inbound SSH and is the preferred AWS smoke target once the worker
has the SSM agent and instance role:

```bash
QA_WORKER_MODE=ssm \
QA_WORKER_INSTANCE_ID=i-xxxxxxxxxxxxxxxxx \
QA_WORKER_REGION=us-west-1 \
QA_WORKER_REPO=/opt/vimeflow/repo \
QA_WORKER_TIMEOUT_SECONDS=5400 \
node /opt/vimeflow/repo/scripts/qa-runner/dispatch-worker.js
```

The dispatcher calls `AWS-RunShellScript`, waits for the command invocation, then
exits with the worker command response code. The SSM payload contains only the
non-secret PR-cycle variables.

## Worker Cycle Entrypoint

On the worker, `worker-cycle.js` runs:

```bash
node scripts/qa-runner/watch.js tick \
  --pr "$QA_PR" \
  --execute \
  --linear-decisions \
  --reason "$QA_REASON" \
  --label "$QA_LABEL"
```

It appends:

- `--approve` when `QA_APPROVE=1`.
- `--linear-create-issues` when `QA_LINEAR_CREATE_ISSUES=1`.
- `--linear-team "$QA_LINEAR_TEAM_KEY"` when set.
- `--max-ci-reruns "$QA_MAX_CI_RERUNS"` when set.

Optional runner refresh:

```bash
QA_WORKER_REFRESH_RUNNER=1
QA_WORKER_REF=wip/linear-wiring
```

When enabled, the worker refuses to refresh if the root checkout has tracked
changes, fetches the configured ref, and checks out `FETCH_HEAD` detached before
running the PR cycle.

## AWS Bootstrap Order

1. Refresh AWS auth locally with `aws login`.
2. Inventory existing `us-west-1` EC2, IAM roles, security groups, SSM
   parameters, and EBS volumes.
3. Create or confirm the control host IAM role:
   - SSM managed instance access.
   - read-only access to the exact SSM parameters needed by the daemon.
   - no broad `iam:PassRole`.
4. Create or confirm the worker IAM role:
   - SSM managed instance access.
   - read-only access to worker-only SSM parameters.
   - no access to the control host's webhook secret unless required.
5. Start the control host from the neutral repo checkout.
6. Install `cloudflared` and map `qa-runner.winoooops.com` to
   `http://127.0.0.1:8787`.
7. Configure the GitHub repository webhook:
   - URL: `https://qa-runner.winoooops.com/webhooks/github`
   - content type: `application/json`
   - secret: same value as `GITHUB_WEBHOOK_SECRET`
8. Verify:
   - unsigned webhook request returns `401`.
   - signed GitHub ping returns `200`.
   - `/status` without token returns `401` or `404`.
   - `/status` with token returns queue state.
9. Bootstrap the worker runtime and persistent auth volume.
10. Run local dispatcher mode on the control host.
11. Run SSM dispatcher mode against the worker.
12. Smoke one PR with `auto-review` and no `auto-approve`.
13. Smoke one PR with `auto-review` and `auto-approve`.
14. Stop or idle the worker and record steady-state plus burst cost.

## Live Inventory

Read-only inventory on 2026-06-04 PDT / 2026-06-05 UTC found:

- Account: `<aws-account-id>`.
- Active Savings Plan: EC2 Instance, `t2`, `us-west-1`, active until
  2026-09-02.
- Control host: `i-<control-host-id>`, `t2.micro`, Amazon Linux 2023,
  `vimeflow-qa-control`, SSM online, instance profile
  `vimeflow-qa-control-profile`.
- Existing non-QA host: `i-<existing-non-qa-host-id>`, `t2.micro`, Ubuntu 24.04,
  SSM connection lost, no instance profile.
- QA security group: `vimeflow-qa-runner-sg`, no ingress, egress only HTTPS and
  Cloudflare Tunnel `7844` TCP/UDP.
- Control root EBS: `vol-<control-root-ebs-id>`, 20 GiB gp3, encrypted,
  delete-on-termination.
- No `Project=vimeflow,Role=worker` EC2 instance exists yet.
- No QA worker EBS volume exists yet.
- IAM roles exist:
  - `vimeflow-qa-control-role`
  - `vimeflow-qa-worker-role`
- Instance profiles exist:
  - `vimeflow-qa-control-profile`
  - `vimeflow-qa-worker-profile`
- SSM SecureString parameters exist under:
  - `/vimeflow/qa-runner/prod/control/*`
  - `/vimeflow/qa-runner/prod/worker/*`

Control host runtime gaps from read-only SSM inspection:

- `cloudflared` binary is installed, but `cloudflared.service` is not installed.
- `qa-runner.service` is not installed.
- Repo checkout is `/opt/vimeflow/repo`.
- Checkout is behind current `origin/wip/linear-wiring`; observed head was
  `0b12141` while the latest merged daemon head is `a6c5cfa`.
- Node is `v18.20.8`; the repo requires Node `>=22`.
- Amazon Linux package `nodejs22` is available.
- `scripts/qa-runner/config.json` exists and uses command mode, but
  `maxParallel` is `0`; set it to `1` before expecting queued work to run.
- `orchestrator.env` exists on the host.
- `bot.env`, `linear-orchestrator.env`, and `linear-agent.env` were not present
  in the repo checkout.

Separate cost note:

- Two Elastic IPs are attached to an `ALB-demo` load balancer ENI, not to the QA
  runner. They are out of scope for VIM-70, but should be reviewed separately if
  the ALB demo is no longer needed.

## Smoke Tests

### No-Approval Path

1. Open a dummy PR linked to VIM-70.
2. Add `auto-review`.
3. Confirm the daemon posts `WAITING`, `NEEDS_FIX`, or `GOOD_SHAPE` in Linear.
4. Confirm the worker runs remotely.
5. Confirm no merge happens without `auto-approve`.

### Fix Path

1. Add a deterministic lint/test failure.
2. Add `auto-review`.
3. Confirm the control host dispatches through SSM or SSH.
4. Confirm the worker pushes a fix with the fixer GitHub identity.
5. Confirm Kimi and orchestrator Linear comments use the expected bot identities.

### Approval Path

1. Add both `auto-review` and `auto-approve`.
2. Wait for CI and review adjudication to reach `GOOD_SHAPE`.
3. Confirm the orchestrator account approves, squash-merges, deletes the branch,
   and posts the merge-complete Linear thread.

## Current Blocker

Local AWS access currently reports an expired session:

```text
aws: [ERROR]: Your session has expired. Please reauthenticate using 'aws login'.
```

AWS inventory and provisioning should resume after reauth. Until then, local mode
can validate the dispatcher contract without creating resources or spending money.

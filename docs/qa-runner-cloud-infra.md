# QA Runner Cloud Infrastructure

VIM-70 owns the production split-plane rollout for the QA runner.

The target shape is one lightweight control host that owns webhooks, queue state,
Linear comments, and merge decisions, plus a burst worker that runs Kimi, Codex,
Lifeline, tests, and PR fix pushes only when a PR needs compute. The worker
plane can be a small fleet of reusable Spot instances for burst capacity.

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
- Runs only the lightweight Codex review adjudicator on the control plane.
  Kimi, fixer-side Codex verify, and tests stay on the worker.

### Burst Worker Fleet

- Uses one or more reusable SSM worker instances.
- Each worker can accept a bounded number of concurrent fixer passes; the
  control host leases slots before dispatching so PR spikes spread over the
  configured workers.
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
- `QA_WORKER_INSTANCE_ID`, stored under the control prefix so single-worker SSM
  dispatch knows which worker to run
- `QA_WORKER_INSTANCE_IDS`, optional comma/space separated SSM worker fleet;
  when present, the dispatcher leases local slots and starts the selected
  stopped worker on demand
- `QA_WORKER_CAPACITY_PER_INSTANCE`, optional fleet slot count per worker;
  defaults to 2 in fleet mode
- `QA_MAX_PARALLEL`, optional control daemon worker-pool size; set this to the
  desired burst cap, normally `worker count * QA_WORKER_CAPACITY_PER_INSTANCE`
- `GH_ORCH_TOKEN`, also materialized as ambient `GH_TOKEN` for daemon polling and
  PR status reads
- `orchestrator.env`
- `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, and `LINEAR_SCOPES` in
  `/etc/vimeflow/qa-runner/control.env`; `linear-orchestrator.env` remains a
  local/compatibility fallback
- `CODEX_HOME`, populated by an interactive `codex login` for the service user
  so review adjudication runs through the control account's Codex auth, not a
  usage-based API key
- Cloudflare Tunnel token or locally managed tunnel credentials

Worker credentials:

- `bot.env`
- `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, and `LINEAR_SCOPES` in
  `/etc/vimeflow/qa-runner/worker.env`; `linear-agent.env` remains a
  local/compatibility fallback
- `QA_WORKER_CODEX_AUTH_MODE`, sourced from
  `/vimeflow/qa-runner/prod/worker/QA_WORKER_CODEX_AUTH_MODE`; set it to
  `existing` for the mounted Codex auth EBS volume, or `api-key` for
  usage-based hot-swap
- `QA_WORKER_CODEX_HOME`, sourced from
  `/vimeflow/qa-runner/prod/worker/QA_WORKER_CODEX_HOME`; for the production EBS
  path this is `/var/lib/vimeflow/codex-auth`
- optional `CODEX_API_KEY`, sourced from
  `/vimeflow/qa-runner/prod/worker/CODEX_API_KEY`, consumed by
  `codex login --with-api-key` only when
  `QA_WORKER_CODEX_AUTH_MODE=api-key`
- optional `OPENAI_API_KEY`, sourced from
  `/vimeflow/qa-runner/prod/worker/openai-api-key`, for generic OpenAI SDK or
  provider usage outside `codex exec`
- optional `KIMI_MODEL_API_KEY`, sourced from
  `/vimeflow/qa-runner/prod/worker/KIMI-API-KEY` or
  `/vimeflow/qa-runner/prod/worker/KIMI_API_KEY`, and written into
  `KIMI_MODEL_*` env variables for official Kimi Code API-mode auth on clean
  burst workers
- optional `KIMI_MODEL_BASE_URL`, sourced from
  `/vimeflow/qa-runner/prod/worker/KIMI_MODEL_BASE_URL`; set it to
  `https://api.kimi.com/coding/v1` for `sk-kim...` Kimi Code keys
- optional `QA_LIFELINE_SKILLS_DIR`, sourced from
  `/vimeflow/qa-runner/prod/worker/QA_LIFELINE_SKILLS_DIR`, so clean burst
  workers can point `run.js` at a cloned Lifeline `skills/` directory instead
  of a user-specific Claude plugin cache
- `/vimeflow/qa-runner/prod/worker/OPENAPI-API-KEY` is a legacy typo parameter
  and is not read by the bootstrap scripts.
- GitHub CLI auth for the fixer account
- Lifeline installation/config

Shared rule: secrets live in SSM Parameter Store or root-owned env files with
`0600` permissions. Do not pass secrets through `QA_FIX_COMMAND`, SSM command
arguments, systemd unit text, GitHub comments, or Linear comments.

Use the checked-in bootstrap helpers to materialize role-specific env files:

```bash
# control host: run once before control-env-from-ssm.sh
sudo -u vimeflow-qa -H env CODEX_HOME=/etc/vimeflow/qa-runner/codex codex login

# control host
sudo /opt/vimeflow/repo/scripts/qa-runner/deploy/control-env-from-ssm.sh

# worker host
sudo /opt/vimeflow/repo/scripts/qa-runner/deploy/worker-env-from-ssm.sh
```

The scripts fetch SecureString values with decryption and write only local env
files. They do not print secret values.

`control-env-from-ssm.sh` does not fetch `CODEX_API_KEY` or `OPENAI_API_KEY`.
It validates `/etc/vimeflow/qa-runner/codex/auth.json` by default so the control
daemon keeps using browser-based Codex auth for adjudication. Worker bootstrap
remains the only place that consumes worker API keys, and only when the worker
auth mode is explicitly set to `api-key`.

On the worker, `worker-env-from-ssm.sh` also writes
`/etc/vimeflow/qa-runner/worker.env` with `0600` permissions. `worker-cycle.js`
loads that local file before running `run.js --push`, so `CODEX_HOME` points
`codex exec` at the root-owned Codex auth context. In the preferred production
mode, `CODEX_HOME=/var/lib/vimeflow/codex-auth` is backed by the retained EBS
volume and the script validates that `auth.json` exists before continuing. For
usage-based hot-swap, set `QA_WORKER_CODEX_AUTH_MODE=api-key`; bootstrap will
use the worker `CODEX_API_KEY` parameter and refresh the local Codex login.
Kimi Code state is kept under root-owned `KIMI_CODE_HOME`, and the Kimi API key
is exposed to the worker process through the official `KIMI_MODEL_NAME` /
`KIMI_MODEL_API_KEY` path without including raw API keys in SSM command
arguments or repo-controlled process environments. Clean burst workers should
clone `https://github.com/winoooops/lifeline` and set
`QA_LIFELINE_SKILLS_DIR=/opt/vimeflow/lifeline/skills` during bootstrap.

## Control Daemon Mode

Create the dedicated service account before installing the unit. The daemon must
not run as root:

```bash
sudo useradd --system --home-dir /opt/vimeflow/repo --user-group vimeflow-qa
sudo chown -R vimeflow-qa:vimeflow-qa /opt/vimeflow/repo
sudo install -d -m 0700 -o vimeflow-qa -g vimeflow-qa /etc/vimeflow/qa-runner
```

Use local tick mode so the control host owns classification, adjudication,
Linear decisions, and `GOOD_SHAPE` approval/merge. Only `NEEDS_FIX` fixer work
is forwarded to a worker:

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
QA_MAX_PARALLEL=6 \
QA_TICK_RUNNER=local \
QA_FIX_COMMAND="node /opt/vimeflow/repo/scripts/qa-runner/dispatch-worker.js" \
node /opt/vimeflow/repo/scripts/qa-runner/daemon.js
```

In SSM mode, `control-env-from-ssm.sh` requires
`/vimeflow/qa-runner/prod/control/QA_WORKER_INSTANCE_ID` for a single worker or
`/vimeflow/qa-runner/prod/control/QA_WORKER_INSTANCE_IDS` for a worker fleet and
writes the configured value into the local control env file. Fleet dispatch
defaults to two concurrent PRs per worker; override
`QA_WORKER_CAPACITY_PER_INSTANCE` only after the worker instance size and disk
can sustain it. Worker refresh is explicit, not a code default. To turn it on,
set both control SSM parameters:

```bash
QA_WORKER_REFRESH_RUNNER=1
QA_WORKER_REF=main
```

Those values are non-secret and are forwarded to the worker cycle. If refresh is
enabled without a ref, bootstrap fails before the daemon starts dispatching.

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
QA_WORKER_INSTANCE_IDS=i-xxxxxxxxxxxxxxxxx,i-yyyyyyyyyyyyyyyyy,i-zzzzzzzzzzzzzzzzz \
QA_WORKER_CAPACITY_PER_INSTANCE=2 \
QA_WORKER_REGION=us-west-1 \
QA_WORKER_REPO=/opt/vimeflow/repo \
QA_WORKER_TIMEOUT_SECONDS=5400 \
node /opt/vimeflow/repo/scripts/qa-runner/dispatch-worker.js
```

The dispatcher calls `AWS-RunShellScript`, waits for the command invocation, then
exits with the worker command response code. The SSM payload contains only the
non-secret fixer variables and structured `QA_FIX_CONTEXT`.

For a single worker, keep using `QA_WORKER_INSTANCE_ID`. When
`QA_WORKER_INSTANCE_IDS` is set, each `dispatch-worker.js` process first creates
an atomic lease under the qa-runner `.state/worker-leases` directory. This
coordinates separate dispatch processes on the control host. If all slots are
full, dispatch waits up to `QA_WORKER_LEASE_WAIT_SECONDS` before failing; stale
leases whose owning process is gone are removed automatically.

For burst workers that are stopped between PR fix cycles, enable the lifecycle
wrapper on the control host:

```bash
QA_WORKER_BURST=1
QA_WORKER_STOP_AFTER_RUN=1
QA_WORKER_READY_TIMEOUT_SECONDS=900
QA_WORKER_IDLE_STOP_SECONDS=2100
```

With `QA_WORKER_BURST=1`, the dispatcher starts a stopped worker instance,
waits until EC2 reports `running`, then retries the actual SSM fixer command
until the target accepts it. With `QA_WORKER_STOP_AFTER_RUN=1`, the daemon owns
the stop decision for SSM burst workers: it always sends
`QA_WORKER_KEEP_ALIVE=1` to the fixer contract so the dispatch layer never stops
the instance from a stale job-claim snapshot. When the queue drains, the daemon
waits `QA_WORKER_IDLE_STOP_SECONDS` and then performs a best-effort stop for
every configured burst worker. The default 35 minute grace keeps workers warm
through slow CI/Claude review rounds without keeping them alive indefinitely. A
stop failure is only logged as a warning; the dispatcher still exits with the
real fixer result.

Standalone `dispatch-worker.js` runs can still stop after their command reaches
a terminal SSM status unless they explicitly pass keep-alive.

Spot workers should use the same SSM dispatch path. For burst scale-out, create
multiple reusable EBS-backed Spot workers, put their instance IDs in
`QA_WORKER_INSTANCE_IDS`, and raise `QA_MAX_PARALLEL` to the fleet capacity.
Credentials should be materialized from SSM at bootstrap time, not copied from a
private AMI made from a live worker disk that already contains auth caches.

Use `scripts/qa-runner/deploy/worker-spot-user-data.sh` as the clean Spot worker
bootstrap user-data. Set `QA_RUNNER_REF` explicitly to the runner branch or tag
to install; branch smoke tests use the branch under test, and production should
pin the deployed runner ref rather than relying on a hidden WIP default.
The script installs Node 22, GitHub CLI, Codex CLI, the official
`@moonshot-ai/kimi-code` CLI, `libsecret`, the Vimeflow repo, Lifeline skills,
worker env files from SSM, and project npm dependencies. The fixer invokes Kimi
Code in non-interactive mode with `kimi --skills-dir <dir> -p <prompt>
--output-format stream-json`. Configured OAuth/model-alias hosts can set
`KIMI_MODEL` to add `-m <alias>`; clean API-key workers default the model to
`kimi-for-coding` through `KIMI_MODEL_NAME` and omit `-m` so the official
`KIMI_MODEL_*` temporary provider path is used.

## Worker Cycle Entrypoint

On the worker, `worker-cycle.js` loads the local worker env, optionally refreshes
the checkout, then runs:

```bash
node scripts/qa-runner/run.js "$QA_PR" --push
```

The worker never appends approval flags. It only fixes and replies as the fixer
identity; approval and merge remain on the control host under the orchestrator
identity.

`QA_MAX_CI_RERUNS` is forwarded in the environment for `run.js` to consume.

Before building that command, it loads
`/etc/vimeflow/qa-runner/worker.env` unless `QA_WORKER_ENV_FILE` points
elsewhere. Values already present in the SSM command environment win over the
local file, but the SSM command should not carry secrets.

Optional runner refresh:

```bash
QA_WORKER_REFRESH_RUNNER=1
QA_WORKER_REF=main
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
- Worker host: `i-07c6c3c9b818dbf37`, `t3.medium`, Amazon Linux 2023,
  `vimeflow-qa-worker-1`, SSM online, instance profile
  `vimeflow-qa-worker-profile`.
- Worker repo checkout is `/opt/vimeflow/repo`, branch `wip/linear-wiring`,
  observed head `98dfa58`.
- Worker toolchain exists: `git`, `gh`, Node `22.22.2`, npm `10.9.7`,
  Codex CLI `0.137.0`, Kimi `1.46.0`, AWS CLI `2.33.15`, and `jq`.
- No worker systemd unit is installed; the first worker pass uses SSM dispatcher
  mode rather than an always-running worker service.
- IAM roles exist:
  - `vimeflow-qa-control-role`
  - `vimeflow-qa-worker-role`
- Instance profiles exist:
  - `vimeflow-qa-control-profile`
  - `vimeflow-qa-worker-profile`
- SSM SecureString parameters exist under:
  - `/vimeflow/qa-runner/prod/control/*`
  - `/vimeflow/qa-runner/prod/worker/*`
- Worker OpenAI key parameter:
  `/vimeflow/qa-runner/prod/worker/openai-api-key`.

Control host runtime gaps from read-only SSM inspection:

- `cloudflared` binary is installed, but `cloudflared.service` is not installed.
- `qa-runner.service` is not installed.
- Repo checkout is `/opt/vimeflow/repo`.
- Checkout is behind current `origin/wip/linear-wiring`; observed head was
  `0b12141` while the latest merged daemon head is `a6c5cfa`.
- Node is `v18.20.8`; the repo requires Node `>=22`.
- Amazon Linux package `nodejs22` is available.
- `scripts/qa-runner/config.json` exists and uses command mode, but
  `maxParallel` is `0`; set it to `3` before expecting queued work to run.
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

The first worker node is online and has the required toolchain. Before relying
on SSM dispatcher mode, run a no-PR bootstrap check that verifies:

- `/etc/vimeflow/qa-runner/worker.env` exists with `0600` permissions.
- `CODEX_HOME` points to a root-owned Codex auth cache.
- `codex login status` succeeds under that `CODEX_HOME`.
- `bot.env` and `linear-agent.env` exist with `0600` permissions.

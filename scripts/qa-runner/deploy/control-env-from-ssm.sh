#!/usr/bin/env bash
set -euo pipefail

region="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-west-1}}"
repo="${QA_REPO:-/opt/vimeflow/repo}"
etc_dir="${QA_ETC_DIR:-/etc/vimeflow/qa-runner}"
prefix="${QA_CONTROL_PARAM_PREFIX:-/vimeflow/qa-runner/prod/control}"
worker_mode="${QA_WORKER_MODE:-ssm}"
worker_region="${QA_WORKER_REGION:-$region}"
worker_repo="${QA_WORKER_REPO:-/opt/vimeflow/repo}"

value() {
  aws ssm get-parameter \
    --region "$region" \
    --name "$prefix/$1" \
    --with-decryption \
    --query Parameter.Value \
    --output text
}

write_secret_file() {
  local path="$1"
  local mode="$2"
  local tmp
  tmp="$(mktemp "${path}.tmp.XXXXXX")"
  chmod "$mode" "$tmp"
  cat >"$tmp"
  mv "$tmp" "$path"
  chmod "$mode" "$path"
}

install -d -m 0700 "$etc_dir"
install -d -m 0700 "$repo/scripts/qa-runner"

write_secret_file "$etc_dir/control.env" 0600 <<EOF
GITHUB_WEBHOOK_SECRET=$(value GITHUB_WEBHOOK_SECRET)
QA_STATUS_TOKEN=$(value QA_STATUS_TOKEN)
QA_HOST=127.0.0.1
QA_PORT=8787
QA_LABEL=auto-review
QA_APPROVE_LABEL=auto-approve
QA_MAX_PARALLEL=1
QA_MAX_CI_RERUNS=3
QA_LINEAR_DECISION_COMMENTS=1
QA_LINEAR_CREATE_ISSUES=0
QA_LINEAR_TEAM_KEY=VIM
QA_TICK_RUNNER=command
QA_TICK_COMMAND="node $repo/scripts/qa-runner/dispatch-worker.js"
QA_WORKER_MODE=$worker_mode
QA_WORKER_REGION=$worker_region
QA_WORKER_REPO=$worker_repo
EOF

write_secret_file "$repo/scripts/qa-runner/orchestrator.env" 0600 <<EOF
GH_ORCH_TOKEN=$(value GH_ORCH_TOKEN)
GH_ORCH_USER=$(value GH_ORCH_USER)
GH_ORCH_EMAIL=$(value GH_ORCH_EMAIL)
EOF

write_secret_file "$repo/linear-orchestrator.env" 0600 <<EOF
LINEAR_CLIENT_ID=$(value LINEAR_CLIENT_ID)
LINEAR_CLIENT_SECRET=$(value LINEAR_CLIENT_SECRET)
LINEAR_SCOPES=read,write
EOF

echo "control env installed at $etc_dir/control.env"

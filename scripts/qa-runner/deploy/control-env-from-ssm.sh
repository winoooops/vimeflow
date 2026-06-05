#!/usr/bin/env bash
set -euo pipefail

region="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-west-1}}"
repo="${QA_REPO:-/opt/vimeflow/repo}"
etc_dir="${QA_ETC_DIR:-/etc/vimeflow/qa-runner}"
prefix="${QA_CONTROL_PARAM_PREFIX:-/vimeflow/qa-runner/prod/control}"
worker_mode="${QA_WORKER_MODE:-ssm}"
worker_region="${QA_WORKER_REGION:-$region}"
worker_repo="${QA_WORKER_REPO:-/opt/vimeflow/repo}"
worker_instance_id="${QA_WORKER_INSTANCE_ID:-}"
service_user="${QA_SERVICE_USER:-vimeflow-qa}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

. "$script_dir/ssm-lib.sh"

value() {
  aws ssm get-parameter \
    --region "$region" \
    --name "$prefix/$1" \
    --with-decryption \
    --query Parameter.Value \
    --output text
}

bool_enabled() {
  case "$(printf "%s" "$1" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | tr "[:upper:]" "[:lower:]")" in
    1 | true | yes | on) return 0 ;;
    *) return 1 ;;
  esac
}

if [ "$worker_mode" = "ssm" ] && [ -z "$worker_instance_id" ]; then
  worker_instance_id="$(value QA_WORKER_INSTANCE_ID)"
fi

worker_timeout_seconds="${QA_WORKER_TIMEOUT_SECONDS:-}"
if [ -z "$worker_timeout_seconds" ]; then
  worker_timeout_seconds="$(optional_value QA_WORKER_TIMEOUT_SECONDS)" || exit 1
fi

worker_refresh_runner="${QA_WORKER_REFRESH_RUNNER:-}"
if [ -z "$worker_refresh_runner" ]; then
  worker_refresh_runner="$(optional_value QA_WORKER_REFRESH_RUNNER)" || exit 1
fi

worker_ref="${QA_WORKER_REF:-}"
if [ -z "$worker_ref" ]; then
  worker_ref="$(optional_value QA_WORKER_REF)" || exit 1
fi

github_webhook_secret="$(value GITHUB_WEBHOOK_SECRET)"
qa_status_token="$(value QA_STATUS_TOKEN)"
gh_orch_token="$(value GH_ORCH_TOKEN)"
gh_orch_user="$(value GH_ORCH_USER)"
gh_orch_email="$(value GH_ORCH_EMAIL)"
linear_client_id="$(value LINEAR_CLIENT_ID)"
linear_client_secret="$(value LINEAR_CLIENT_SECRET)"

if bool_enabled "$worker_refresh_runner" && [ -z "$worker_ref" ]; then
  echo "error: QA_WORKER_REFRESH_RUNNER is set but QA_WORKER_REF is not set in env or SSM" >&2
  exit 1
fi

write_secret_file() {
  local path="$1"
  local mode="$2"
  local tmp
  tmp="$(mktemp "${path}.tmp.XXXXXX")"
  chmod "$mode" "$tmp"
  cat >"$tmp"
  mv "$tmp" "$path"
  chmod "$mode" "$path"
  chown "$service_user:$service_user" "$path"
}

install -d -m 0700 -o "$service_user" -g "$service_user" "$etc_dir" || {
  install -d -m 0700 "$etc_dir"
  chown "$service_user:$service_user" "$etc_dir"
}
install -d -m 0700 -o "$service_user" -g "$service_user" "$repo/scripts/qa-runner" || {
  install -d -m 0700 "$repo/scripts/qa-runner"
  chown "$service_user:$service_user" "$repo/scripts/qa-runner"
}

{
  cat <<EOF
GITHUB_WEBHOOK_SECRET=$github_webhook_secret
QA_STATUS_TOKEN=$qa_status_token
GH_PROMPT_DISABLED=1
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
  write_env_line GH_TOKEN "$gh_orch_token"
  write_env_line QA_WORKER_INSTANCE_ID "$worker_instance_id"
  write_env_line QA_WORKER_TIMEOUT_SECONDS "$worker_timeout_seconds"
  write_env_line QA_WORKER_REFRESH_RUNNER "$worker_refresh_runner"
  write_env_line QA_WORKER_REF "$worker_ref"
} | write_secret_file "$etc_dir/control.env" 0600

write_secret_file "$repo/scripts/qa-runner/orchestrator.env" 0600 <<EOF
GH_ORCH_TOKEN=$gh_orch_token
GH_ORCH_USER=$gh_orch_user
GH_ORCH_EMAIL=$gh_orch_email
EOF

write_secret_file "$repo/linear-orchestrator.env" 0600 <<EOF
LINEAR_CLIENT_ID=$linear_client_id
LINEAR_CLIENT_SECRET=$linear_client_secret
LINEAR_SCOPES=read,write
EOF

echo "control env installed at $etc_dir/control.env"

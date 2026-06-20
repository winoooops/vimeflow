#!/usr/bin/env bash
set -euo pipefail

region="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-west-1}}"
repo="${QA_REPO:-/opt/vimeflow/repo}"
etc_dir="${QA_ETC_DIR:-/etc/vimeflow/qa-runner}"
prefix="${QA_CONTROL_PARAM_PREFIX:-/vimeflow/qa-runner/prod/control}"
codex_home="${CODEX_HOME:-$etc_dir/codex}"
codex_auth_file="${QA_CODEX_AUTH_FILE:-$codex_home/auth.json}"
require_codex_auth="${QA_REQUIRE_CONTROL_CODEX_AUTH:-1}"
worker_mode="${QA_WORKER_MODE:-ssm}"
worker_region="${QA_WORKER_REGION:-$region}"
worker_repo="${QA_WORKER_REPO:-/opt/vimeflow/repo}"
worker_instance_id="${QA_WORKER_INSTANCE_ID:-}"
worker_instance_ids="${QA_WORKER_INSTANCE_IDS:-}"
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

qa_max_parallel="${QA_MAX_PARALLEL:-}"
if [ -z "$qa_max_parallel" ]; then
  qa_max_parallel="$(optional_value QA_MAX_PARALLEL)" || exit 1
fi
if [ -z "$qa_max_parallel" ]; then
  qa_max_parallel="2"
fi

fixer_engine="${QA_FIXER_ENGINE:-}"
if [ -z "$fixer_engine" ]; then
  fixer_engine="$(optional_value QA_FIXER_ENGINE | tr -d '\r\n')" || exit 1
fi
if [ -n "$fixer_engine" ]; then
  fixer_engine="$(printf "%s" "$fixer_engine" | tr "[:upper:]" "[:lower:]")"
  case "$fixer_engine" in
    kimi | codex) ;;
    *)
      echo "error: unsupported QA_FIXER_ENGINE '$fixer_engine' (expected kimi or codex)" >&2
      exit 1
      ;;
  esac
fi

codex_model="${QA_CODEX_MODEL:-}"
if [ -z "$codex_model" ]; then
  codex_model="$(optional_value QA_CODEX_MODEL | tr -d '\r\n')" || exit 1
fi

codex_sandbox="${QA_CODEX_SANDBOX:-}"
if [ -z "$codex_sandbox" ]; then
  codex_sandbox="$(optional_value QA_CODEX_SANDBOX | tr -d '\r\n')" || exit 1
fi
if [ -n "$codex_sandbox" ]; then
  case "$codex_sandbox" in
    read-only | workspace-write | danger-full-access) ;;
    *)
      echo "error: unsupported QA_CODEX_SANDBOX '$codex_sandbox'" >&2
      exit 1
      ;;
  esac
fi

fixer_timeout_ms="${QA_FIXER_TIMEOUT_MS:-}"
if [ -z "$fixer_timeout_ms" ]; then
  fixer_timeout_ms="$(optional_value QA_FIXER_TIMEOUT_MS | tr -d '\r\n')" || exit 1
fi
if [ -n "$fixer_timeout_ms" ] && [[ ! "$fixer_timeout_ms" =~ ^[1-9][0-9]*$ ]]; then
  echo "error: QA_FIXER_TIMEOUT_MS must be a positive integer number of milliseconds" >&2
  exit 1
fi

if [ "$worker_mode" = "ssm" ] && [ -z "$worker_instance_ids" ]; then
  worker_instance_ids="$(optional_value QA_WORKER_INSTANCE_IDS)" || exit 1
fi

if [ "$worker_mode" = "ssm" ] && [ -z "$worker_instance_id" ] && [ -z "$worker_instance_ids" ]; then
  worker_instance_id="$(value QA_WORKER_INSTANCE_ID)"
fi

worker_capacity_per_instance="${QA_WORKER_CAPACITY_PER_INSTANCE:-}"
if [ -z "$worker_capacity_per_instance" ]; then
  worker_capacity_per_instance="$(optional_value QA_WORKER_CAPACITY_PER_INSTANCE)" || exit 1
fi

worker_lease_wait_seconds="${QA_WORKER_LEASE_WAIT_SECONDS:-}"
if [ -z "$worker_lease_wait_seconds" ]; then
  worker_lease_wait_seconds="$(optional_value QA_WORKER_LEASE_WAIT_SECONDS)" || exit 1
fi

worker_lease_stale_seconds="${QA_WORKER_LEASE_STALE_SECONDS:-}"
if [ -z "$worker_lease_stale_seconds" ]; then
  worker_lease_stale_seconds="$(optional_value QA_WORKER_LEASE_STALE_SECONDS)" || exit 1
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

worker_burst="${QA_WORKER_BURST:-}"
if [ -z "$worker_burst" ]; then
  worker_burst="$(optional_value QA_WORKER_BURST)" || exit 1
fi

worker_stop_after_run="${QA_WORKER_STOP_AFTER_RUN:-}"
if [ -z "$worker_stop_after_run" ]; then
  worker_stop_after_run="$(optional_value QA_WORKER_STOP_AFTER_RUN)" || exit 1
fi

worker_ready_timeout_seconds="${QA_WORKER_READY_TIMEOUT_SECONDS:-}"
if [ -z "$worker_ready_timeout_seconds" ]; then
  worker_ready_timeout_seconds="$(optional_value QA_WORKER_READY_TIMEOUT_SECONDS)" || exit 1
fi

worker_idle_stop_seconds="${QA_WORKER_IDLE_STOP_SECONDS:-}"
if [ -z "$worker_idle_stop_seconds" ]; then
  worker_idle_stop_seconds="$(optional_value QA_WORKER_IDLE_STOP_SECONDS)" || exit 1
fi

worker_min_free_percent="${QA_WORKER_MIN_FREE_PERCENT:-}"
if [ -z "$worker_min_free_percent" ]; then
  worker_min_free_percent="$(optional_value QA_WORKER_MIN_FREE_PERCENT)" || exit 1
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
install -d -m 0700 -o "$service_user" -g "$service_user" "$codex_home" || {
  install -d -m 0700 "$codex_home"
  chown "$service_user:$service_user" "$codex_home"
}
install -d -m 0700 -o "$service_user" -g "$service_user" "$repo/scripts/qa-runner" || {
  install -d -m 0700 "$repo/scripts/qa-runner"
  chown "$service_user:$service_user" "$repo/scripts/qa-runner"
}

if [ -e "$codex_auth_file" ]; then
  chown "$service_user:$service_user" "$codex_auth_file"
  chmod 0600 "$codex_auth_file"
elif bool_enabled "$require_codex_auth"; then
  cat >&2 <<EOF
error: control Codex auth not found at $codex_auth_file
Run an interactive Codex login for the service user before installing control.env:
  sudo -u $service_user -H env CODEX_HOME=$codex_home codex login
Set QA_REQUIRE_CONTROL_CODEX_AUTH=0 only for non-adjudicating smoke installs.
EOF
  exit 1
fi

{
  cat <<EOF
GITHUB_WEBHOOK_SECRET=$github_webhook_secret
QA_STATUS_TOKEN=$qa_status_token
GH_PROMPT_DISABLED=1
CODEX_HOME=$codex_home
QA_HOST=127.0.0.1
QA_PORT=8787
QA_LABEL=auto-review
QA_APPROVE_LABEL=auto-approve
QA_MAX_PARALLEL=$qa_max_parallel
QA_MAX_CI_RERUNS=3
QA_LINEAR_DECISION_COMMENTS=1
QA_LINEAR_CREATE_ISSUES=1
QA_LINEAR_TEAM_KEY=VIM
QA_TICK_RUNNER=local
QA_FIX_COMMAND="node $repo/scripts/qa-runner/dispatch-worker.js"
QA_WORKER_MODE=$worker_mode
QA_WORKER_REGION=$worker_region
QA_WORKER_REPO=$worker_repo
EOF
  write_env_line QA_FIXER_ENGINE "$fixer_engine"
  write_env_line QA_CODEX_MODEL "$codex_model"
  write_env_line QA_CODEX_SANDBOX "$codex_sandbox"
  write_env_line QA_FIXER_TIMEOUT_MS "$fixer_timeout_ms"
  write_env_line GH_TOKEN "$gh_orch_token"
  write_env_line QA_WORKER_INSTANCE_ID "$worker_instance_id"
  write_env_line QA_WORKER_INSTANCE_IDS "$worker_instance_ids"
  write_env_line QA_WORKER_CAPACITY_PER_INSTANCE "$worker_capacity_per_instance"
  write_env_line QA_WORKER_LEASE_WAIT_SECONDS "$worker_lease_wait_seconds"
  write_env_line QA_WORKER_LEASE_STALE_SECONDS "$worker_lease_stale_seconds"
  write_env_line QA_WORKER_TIMEOUT_SECONDS "$worker_timeout_seconds"
  write_env_line QA_WORKER_REFRESH_RUNNER "$worker_refresh_runner"
  write_env_line QA_WORKER_REF "$worker_ref"
  write_env_line QA_WORKER_BURST "$worker_burst"
  write_env_line QA_WORKER_STOP_AFTER_RUN "$worker_stop_after_run"
  write_env_line QA_WORKER_READY_TIMEOUT_SECONDS "$worker_ready_timeout_seconds"
  write_env_line QA_WORKER_IDLE_STOP_SECONDS "$worker_idle_stop_seconds"
  write_env_line QA_WORKER_MIN_FREE_PERCENT "$worker_min_free_percent"
  write_env_line LINEAR_CLIENT_ID "$linear_client_id"
  write_env_line LINEAR_CLIENT_SECRET "$linear_client_secret"
  write_env_line LINEAR_SCOPES "read,write"
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

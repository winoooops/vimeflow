#!/usr/bin/env bash
set -euo pipefail

region="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-west-1}}"
repo="${QA_REPO:-/opt/vimeflow/repo}"
etc_dir="${QA_ETC_DIR:-/etc/vimeflow/qa-runner}"
prefix="${QA_WORKER_PARAM_PREFIX:-/vimeflow/qa-runner/prod/worker}"
codex_home="${CODEX_HOME:-$etc_dir/codex}"

value() {
  aws ssm get-parameter \
    --region "$region" \
    --name "$prefix/$1" \
    --with-decryption \
    --query Parameter.Value \
    --output text
}

optional_value() {
  local err
  local out
  local status
  err="$(mktemp)"
  if out="$(aws ssm get-parameter \
    --region "$region" \
    --name "$prefix/$1" \
    --with-decryption \
    --query Parameter.Value \
    --output text 2>"$err")"; then
    rm -f "$err"
    printf "%s" "$out"
    return 0
  else
    status=$?
  fi

  if grep -q "ParameterNotFound" "$err"; then
    rm -f "$err"
    return 0
  fi

  cat "$err" >&2
  rm -f "$err"
  return "$status"
}

single_line_value() {
  value "$1" | tr -d '\r\n'
}

single_line_optional_value() {
  optional_value "$1" | tr -d '\r\n'
}

write_env_line() {
  local key="$1"
  local value
  value="$(printf "%s" "$2" | tr -d "\r\n")"
  if [ -n "$value" ]; then
    printf "%s=%s\n" "$key" "$value"
  fi
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

install -d -m 0700 "$repo/scripts/qa-runner" "$etc_dir" "$codex_home"

write_secret_file "$repo/scripts/qa-runner/bot.env" 0600 <<EOF
GH_BOT_TOKEN=$(single_line_value GH_BOT_TOKEN)
GH_BOT_USER=$(single_line_value GH_BOT_USER)
GH_BOT_EMAIL=$(single_line_value GH_BOT_EMAIL)
EOF

write_secret_file "$repo/linear-agent.env" 0600 <<EOF
LINEAR_CLIENT_ID=$(single_line_value LINEAR_CLIENT_ID)
LINEAR_CLIENT_SECRET=$(single_line_value LINEAR_CLIENT_SECRET)
LINEAR_SCOPES=read,write
EOF

codex_api_key="$(single_line_value CODEX_API_KEY)"
printf "%s" "$codex_api_key" | CODEX_HOME="$codex_home" codex login --with-api-key >/dev/null

openai_api_key="${OPENAI_API_KEY:-$(single_line_optional_value openai-api-key)}"

{
  cat <<EOF
AWS_REGION=$region
AWS_DEFAULT_REGION=$region
CODEX_HOME=$codex_home
EOF
  write_env_line OPENAI_API_KEY "$openai_api_key"
} | write_secret_file "$etc_dir/worker.env" 0600

echo "worker env installed under $repo and $etc_dir"

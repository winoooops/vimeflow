#!/usr/bin/env bash
set -euo pipefail

region="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-west-1}}"
repo="${QA_REPO:-/opt/vimeflow/repo}"
etc_dir="${QA_ETC_DIR:-/etc/vimeflow/qa-runner}"
prefix="${QA_WORKER_PARAM_PREFIX:-/vimeflow/qa-runner/prod/worker}"
codex_home="${CODEX_HOME:-$etc_dir/codex}"
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

single_line_value() {
  value "$1" | tr -d '\r\n'
}

single_line_optional_value() {
  optional_value "$1" | tr -d '\r\n'
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

openai_api_key="${OPENAI_API_KEY:-}"
if [ -z "$openai_api_key" ]; then
  openai_api_key="$(single_line_optional_value openai-api-key)" || exit 1
fi

kimi_api_key="${KIMI_API_KEY:-}"
if [ -z "$kimi_api_key" ]; then
  kimi_api_key="$(single_line_optional_value KIMI-API-KEY)" || exit 1
fi
if [ -z "$kimi_api_key" ]; then
  kimi_api_key="$(single_line_optional_value KIMI_API_KEY)" || exit 1
fi

lifeline_skills_dir="${QA_LIFELINE_SKILLS_DIR:-}"
if [ -z "$lifeline_skills_dir" ]; then
  lifeline_skills_dir="$(single_line_optional_value QA_LIFELINE_SKILLS_DIR)" || exit 1
fi

{
  cat <<EOF
AWS_REGION=$region
AWS_DEFAULT_REGION=$region
CODEX_HOME=$codex_home
EOF
  write_env_line OPENAI_API_KEY "$openai_api_key"
  write_env_line KIMI_API_KEY "$kimi_api_key"
  write_env_line QA_LIFELINE_SKILLS_DIR "$lifeline_skills_dir"
  write_env_line LINEAR_CLIENT_ID "$(single_line_value LINEAR_CLIENT_ID)"
  write_env_line LINEAR_CLIENT_SECRET "$(single_line_value LINEAR_CLIENT_SECRET)"
  write_env_line LINEAR_SCOPES "read,write"
} | write_secret_file "$etc_dir/worker.env" 0600

echo "worker env installed under $repo and $etc_dir"

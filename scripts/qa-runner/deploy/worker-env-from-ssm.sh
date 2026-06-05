#!/usr/bin/env bash
set -euo pipefail

region="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-west-1}}"
repo="${QA_REPO:-/opt/vimeflow/repo}"
etc_dir="${QA_ETC_DIR:-/etc/vimeflow/qa-runner}"
prefix="${QA_WORKER_PARAM_PREFIX:-/vimeflow/qa-runner/prod/worker}"

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

install -d -m 0700 "$repo/scripts/qa-runner" "$etc_dir"

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

write_secret_file "$etc_dir/worker.env" 0600 <<EOF
AWS_REGION=$region
AWS_DEFAULT_REGION=$region
OPENAI_API_KEY=$(single_line_value openai-api-key)
EOF

echo "worker env installed under $repo and $etc_dir"

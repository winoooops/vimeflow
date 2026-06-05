#!/usr/bin/env bash
set -euo pipefail

region="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-west-1}}"
repo="${QA_REPO:-/opt/vimeflow/repo}"
prefix="${QA_WORKER_PARAM_PREFIX:-/vimeflow/qa-runner/prod/worker}"

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

install -d -m 0700 "$repo/scripts/qa-runner"

write_secret_file "$repo/scripts/qa-runner/bot.env" 0600 <<EOF
GH_BOT_TOKEN=$(value GH_BOT_TOKEN)
GH_BOT_USER=$(value GH_BOT_USER)
GH_BOT_EMAIL=$(value GH_BOT_EMAIL)
EOF

write_secret_file "$repo/linear-agent.env" 0600 <<EOF
LINEAR_CLIENT_ID=$(value LINEAR_CLIENT_ID)
LINEAR_CLIENT_SECRET=$(value LINEAR_CLIENT_SECRET)
LINEAR_SCOPES=read,write
EOF

echo "worker env installed under $repo"

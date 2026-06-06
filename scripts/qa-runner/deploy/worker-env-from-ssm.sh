#!/usr/bin/env bash
set -euo pipefail

region="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-west-1}}"
repo="${QA_REPO:-/opt/vimeflow/repo}"
etc_dir="${QA_ETC_DIR:-/etc/vimeflow/qa-runner}"
prefix="${QA_WORKER_PARAM_PREFIX:-/vimeflow/qa-runner/prod/worker}"
kimi_code_home="${KIMI_CODE_HOME:-$etc_dir/kimi-code}"
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

env_or_optional_value() {
  local env_name="$1"
  local param_name="${2:-$1}"
  local value="${!env_name-}"
  if [ -z "$value" ]; then
    value="$(single_line_optional_value "$param_name")" || exit 1
  fi
  printf "%s" "$value"
}

resolve_codex_home() {
  local value="${CODEX_HOME-}"
  if [ -z "$value" ]; then
    value="${QA_WORKER_CODEX_HOME-}"
  fi
  if [ -z "$value" ]; then
    value="$(single_line_optional_value QA_WORKER_CODEX_HOME)" || exit 1
  fi
  if [ -z "$value" ]; then
    value="$etc_dir/codex"
  fi
  printf "%s" "$value"
}

configure_codex_auth() {
  case "$codex_auth_mode" in
    existing)
      if [ ! -f "$codex_home/auth.json" ]; then
        echo "error: QA_WORKER_CODEX_AUTH_MODE=existing requires $codex_home/auth.json" >&2
        exit 1
      fi
      chmod 0700 "$codex_home"
      chmod 0600 "$codex_home/auth.json"
      ;;
    api-key)
      local codex_api_key="${CODEX_API_KEY-}"
      if [ -z "$codex_api_key" ]; then
        codex_api_key="$(single_line_value CODEX_API_KEY)"
      fi
      printf "%s" "$codex_api_key" | CODEX_HOME="$codex_home" codex login --with-api-key >/dev/null
      ;;
    *)
      echo "error: unsupported QA_WORKER_CODEX_AUTH_MODE '$codex_auth_mode' (expected existing or api-key)" >&2
      exit 1
      ;;
  esac
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

codex_home="$(resolve_codex_home)"
codex_auth_mode="$(env_or_optional_value QA_WORKER_CODEX_AUTH_MODE)"
if [ -z "$codex_auth_mode" ]; then
  codex_auth_mode="api-key"
fi

install -d -m 0700 "$repo/scripts/qa-runner" "$etc_dir" "$codex_home" "$kimi_code_home"

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

configure_codex_auth

openai_api_key="${OPENAI_API_KEY:-}"
if [ -z "$openai_api_key" ]; then
  openai_api_key="$(single_line_optional_value openai-api-key)" || exit 1
fi

kimi_api_key="${KIMI_MODEL_API_KEY:-${KIMI_API_KEY:-}}"
if [ -z "$kimi_api_key" ]; then
  kimi_api_key="$(single_line_optional_value KIMI-API-KEY)" || exit 1
fi
if [ -z "$kimi_api_key" ]; then
  kimi_api_key="$(single_line_optional_value KIMI_API_KEY)" || exit 1
fi
kimi_model_name="${KIMI_MODEL_NAME:-}"
if [ -z "$kimi_model_name" ]; then
  kimi_model_name="$(single_line_optional_value KIMI_MODEL_NAME)" || exit 1
fi
if [ -z "$kimi_model_name" ]; then
  kimi_model_name="kimi-for-coding"
fi

kimi_model_provider_type="${KIMI_MODEL_PROVIDER_TYPE:-}"
if [ -z "$kimi_model_provider_type" ]; then
  kimi_model_provider_type="$(single_line_optional_value KIMI_MODEL_PROVIDER_TYPE)" || exit 1
fi
if [ -z "$kimi_model_provider_type" ]; then
  kimi_model_provider_type="kimi"
fi

kimi_model_base_url="${KIMI_MODEL_BASE_URL:-}"
if [ -z "$kimi_model_base_url" ]; then
  kimi_model_base_url="$(single_line_optional_value KIMI_MODEL_BASE_URL)" || exit 1
fi
if [ -z "$kimi_model_base_url" ]; then
  kimi_model_base_url="$(single_line_optional_value KIMI_BASE_URL)" || exit 1
fi

kimi_model_capabilities="${KIMI_MODEL_CAPABILITIES:-}"
if [ -z "$kimi_model_capabilities" ]; then
  kimi_model_capabilities="$(single_line_optional_value KIMI_MODEL_CAPABILITIES)" || exit 1
fi
if [ -z "$kimi_model_capabilities" ]; then
  kimi_model_capabilities="image_in,thinking"
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
QA_WORKER_CODEX_AUTH_MODE=$codex_auth_mode
KIMI_CODE_HOME=$kimi_code_home
KIMI_DISABLE_TELEMETRY=1
EOF
  write_env_line OPENAI_API_KEY "$openai_api_key"
  write_env_line KIMI_MODEL_NAME "$kimi_model_name"
  write_env_line KIMI_MODEL_API_KEY "$kimi_api_key"
  write_env_line KIMI_MODEL_PROVIDER_TYPE "$kimi_model_provider_type"
  write_env_line KIMI_MODEL_BASE_URL "$kimi_model_base_url"
  write_env_line KIMI_MODEL_CAPABILITIES "$kimi_model_capabilities"
  write_env_line KIMI_API_KEY "$kimi_api_key"
  write_env_line QA_LIFELINE_SKILLS_DIR "$lifeline_skills_dir"
  write_env_line LINEAR_CLIENT_ID "$(single_line_value LINEAR_CLIENT_ID)"
  write_env_line LINEAR_CLIENT_SECRET "$(single_line_value LINEAR_CLIENT_SECRET)"
  write_env_line LINEAR_SCOPES "read,write"
} | write_secret_file "$etc_dir/worker.env" 0600

echo "worker env installed under $repo and $etc_dir"

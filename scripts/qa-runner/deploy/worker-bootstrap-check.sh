#!/usr/bin/env bash
set -euo pipefail

repo="${QA_REPO:-/opt/vimeflow/repo}"
etc_dir="${QA_ETC_DIR:-/etc/vimeflow/qa-runner}"
worker_env_file="${QA_WORKER_ENV_FILE:-$etc_dir/worker.env}"
failures=0

fail() {
  printf "FAIL %s\n" "$*" >&2
  failures=$((failures + 1))
}

pass() {
  printf "PASS %s\n" "$*"
}

check_secret_file() {
  local path="$1"
  local label="$2"
  local mode
  local owner
  local group

  if [ ! -f "$path" ]; then
    fail "$label missing at $path"
    return
  fi

  mode="$(stat -c "%a" "$path")"
  owner="$(stat -c "%U" "$path")"
  group="$(stat -c "%G" "$path")"

  if [ "$mode" != "600" ]; then
    fail "$label mode is $mode, expected 600"
  else
    pass "$label mode is 600"
  fi

  if [ "$owner" != "root" ] || [ "$group" != "root" ]; then
    fail "$label owner is $owner:$group, expected root:root"
  else
    pass "$label owner is root:root"
  fi
}

worker_env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$worker_env_file" | tail -n 1 | tr -d '\r'
}

check_secret_file "$worker_env_file" "worker.env"
check_secret_file "$repo/scripts/qa-runner/bot.env" "bot.env"
check_secret_file "$repo/linear-agent.env" "linear-agent.env"

codex_home=""
if [ -f "$worker_env_file" ]; then
  codex_home="$(worker_env_value CODEX_HOME)"
fi
if [ -z "$codex_home" ]; then
  fail "CODEX_HOME missing from worker.env"
else
  pass "CODEX_HOME is present in worker.env"

  if [ ! -d "$codex_home" ]; then
    fail "CODEX_HOME directory missing at $codex_home"
  else
    codex_owner="$(stat -c "%U" "$codex_home")"
    if [ "$codex_owner" != "root" ]; then
      fail "CODEX_HOME owner is $codex_owner, expected root"
    else
      pass "CODEX_HOME directory is root-owned"
    fi
  fi
fi

if ! command -v codex >/dev/null 2>&1; then
  fail "codex CLI is not on PATH"
elif [ -n "$codex_home" ]; then
  if CODEX_HOME="$codex_home" codex login status >/dev/null 2>&1; then
    pass "codex login status succeeds with worker CODEX_HOME"
  else
    fail "codex login status failed with worker CODEX_HOME"
  fi
fi

if [ "$failures" -gt 0 ]; then
  printf "worker bootstrap check failed: %s issue(s)\n" "$failures" >&2
  exit 1
fi

printf "worker bootstrap check passed\n"

#!/usr/bin/env bash

# Shared by deploy scripts after they define region and prefix.
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

write_env_line() {
  local key="$1"
  local value
  value="$(printf "%s" "$2" | tr -d "\r\n")"
  if [ -n "$value" ]; then
    printf "%s=%s\n" "$key" "$value"
  fi
}

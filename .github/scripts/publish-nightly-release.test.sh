#!/usr/bin/env bash

set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT

mkdir "$test_dir/bin" "$test_dir/runner-temp"
cat > "$test_dir/bin/gh" <<'EOF'
#!/usr/bin/env bash
printf '%q ' "$@" >> "$GH_CALL_LOG"
printf '\n' >> "$GH_CALL_LOG"
printf 'mock GitHub API failure\n' >&2
exit 1
EOF
chmod +x "$test_dir/bin/gh"

set +e
env \
  PATH="$test_dir/bin:$PATH" \
  GH_CALL_LOG="$test_dir/gh-calls" \
  GITHUB_REPOSITORY='winoooops/vimeflow' \
  GITHUB_RUN_ID='123' \
  GITHUB_RUN_ATTEMPT='1' \
  GITHUB_SHA='0123456789abcdef0123456789abcdef01234567' \
  RUNNER_TEMP="$test_dir/runner-temp" \
  "$script_dir/publish-nightly-release.sh" 2>/dev/null
status=$?
set -e

if [ "$status" -eq 0 ]; then
  printf 'expected the initial release lookup failure to abort publishing\n' >&2
  exit 1
fi

test "$(wc -l < "$test_dir/gh-calls")" -eq 1
if grep -Eq -- '--method (POST|PATCH|DELETE)|^release (create|upload|edit|delete)' "$test_dir/gh-calls"; then
  printf 'publish mutated GitHub state after the initial lookup failed\n' >&2
  exit 1
fi

printf 'publish-nightly-release failure transition: ok\n'

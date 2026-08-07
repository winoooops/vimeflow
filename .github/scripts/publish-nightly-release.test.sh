#!/usr/bin/env bash

set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
test_dir=$(mktemp -d)
trap 'rm -rf "$test_dir"' EXIT

old_sha='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
new_sha='0123456789abcdef0123456789abcdef01234567'
candidate_tag='nightly-123-1'
previous_tag="${candidate_tag}-previous"

mkdir "$test_dir/bin"
cat > "$test_dir/bin/gh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf '%q ' "$@" >> "$GH_STATE_DIR/calls"
printf '\n' >> "$GH_STATE_DIR/calls"

field_value() {
  name=$1
  shift
  while [ "$#" -gt 1 ]; do
    if { [ "$1" = '-f' ] || [ "$1" = '-F' ]; } && [[ $2 = "${name}="* ]]; then
      printf '%s\n' "${2#*=}"
      return
    fi
    shift
  done
}

if [ "$1 $2" = 'api graphql' ]; then
  if [[ $* = *release.databaseId* ]]; then
    tag=$(field_value tag "$@")
    for release in "$GH_STATE_DIR/releases"/*; do
      [ -d "$release" ] || continue
      if [ "$(cat "$release/tag")" = "$tag" ]; then
        basename "$release"
        exit
      fi
    done
  else
    ref=$(field_value ref "$@")
    tag=${ref#refs/tags/}
    [ ! -f "$GH_STATE_DIR/refs/$tag" ] || cat "$GH_STATE_DIR/refs/$tag"
  fi
  exit
fi

if [ "$1 $2" = 'release upload' ]; then
  tag=$3
  for release in "$GH_STATE_DIR/releases"/*; do
    [ -d "$release" ] || continue
    [ "$(cat "$release/tag")" != "$tag" ] || {
      mkdir -p "$GH_STATE_DIR/uploads"
      printf '%s\n' "${*:4}" > "$GH_STATE_DIR/uploads/$tag"
      exit
    }
  done
  printf 'release %s does not exist\n' "$tag" >&2
  exit 1
fi

method=$3
endpoint=$4
case "$method $endpoint" in
  'POST repos/winoooops/vimeflow/releases')
    tag=$(field_value tag_name "$@")
    sha=$(field_value target_commitish "$@")
    draft=$(field_value draft "$@")
    mkdir "$GH_STATE_DIR/releases/8"
    printf '%s\n' "$tag" > "$GH_STATE_DIR/releases/8/tag"
    printf '%s\n' "$draft" > "$GH_STATE_DIR/releases/8/draft"
    printf '%s\n' "$sha" > "$GH_STATE_DIR/refs/$tag"
    printf '8\n'
    ;;
  'POST repos/winoooops/vimeflow/git/refs')
    ref=$(field_value ref "$@")
    sha=$(field_value sha "$@")
    printf '%s\n' "$sha" > "$GH_STATE_DIR/refs/${ref#refs/tags/}"
    ;;
  PATCH\ repos/winoooops/vimeflow/releases/*)
    release_id=${endpoint##*/}
    tag=$(field_value tag_name "$@" || true)
    draft=$(field_value draft "$@" || true)
    if [ "$release_id" = 8 ] && [ "$tag" = nightly ] && [ "$GH_FAIL_PUBLISH" = true ]; then
      touch "$GH_STATE_DIR/publish-failure"
      printf 'mock publish failure\n' >&2
      exit 1
    fi
    [ -z "$tag" ] || printf '%s\n' "$tag" > "$GH_STATE_DIR/releases/$release_id/tag"
    [ -z "$draft" ] || printf '%s\n' "$draft" > "$GH_STATE_DIR/releases/$release_id/draft"
    ;;
  PATCH\ repos/winoooops/vimeflow/git/refs/tags/*)
    tag=${endpoint##*/}
    sha=$(field_value sha "$@")
    printf '%s\n' "$sha" > "$GH_STATE_DIR/refs/$tag"
    ;;
  DELETE\ repos/winoooops/vimeflow/releases/*)
    rm -r "$GH_STATE_DIR/releases/${endpoint##*/}"
    ;;
  DELETE\ repos/winoooops/vimeflow/git/refs/tags/*)
    rm "$GH_STATE_DIR/refs/${endpoint##*/}"
    ;;
  *)
    printf 'unexpected gh call: %q ' "$@" >&2
    printf '\n' >&2
    exit 1
    ;;
esac
EOF
chmod +x "$test_dir/bin/gh"

setup_case() {
  case_dir=$1
  mkdir -p "$case_dir/nightly-assets" "$case_dir/runner-temp" \
    "$case_dir/state/releases/7" "$case_dir/state/refs"
  printf 'nightly\n' > "$case_dir/state/releases/7/tag"
  printf 'false\n' > "$case_dir/state/releases/7/draft"
  printf '%s\n' "$old_sha" > "$case_dir/state/refs/nightly"
  touch "$case_dir/nightly-assets/Vimeflow.dmg"
  touch "$case_dir/runner-temp/nightly-release.md"
}

run_publisher() {
  case_dir=$1
  fail_publish=$2
  (
    cd "$case_dir"
    env \
      PATH="$test_dir/bin:$PATH" \
      GH_STATE_DIR="$case_dir/state" \
      GH_FAIL_PUBLISH="$fail_publish" \
      GITHUB_REPOSITORY='winoooops/vimeflow' \
      GITHUB_RUN_ID='123' \
      GITHUB_RUN_ATTEMPT='1' \
      GITHUB_SHA="$new_sha" \
      RUNNER_TEMP="$case_dir/runner-temp" \
      "$script_dir/publish-nightly-release.sh"
  )
}

success_dir="$test_dir/success"
setup_case "$success_dir"
run_publisher "$success_dir" false

test "$(cat "$success_dir/state/releases/8/tag")" = nightly
test "$(cat "$success_dir/state/releases/8/draft")" = false
test "$(cat "$success_dir/state/refs/nightly")" = "$new_sha"
test -f "$success_dir/state/uploads/$candidate_tag"
test ! -e "$success_dir/state/releases/7"
test ! -e "$success_dir/state/refs/$candidate_tag"
test ! -e "$success_dir/state/refs/$previous_tag"

rollback_dir="$test_dir/rollback"
setup_case "$rollback_dir"
if run_publisher "$rollback_dir" true 2>/dev/null; then
  printf 'expected the final publish mutation to fail\n' >&2
  exit 1
fi

test -f "$rollback_dir/state/publish-failure"
test "$(cat "$rollback_dir/state/releases/7/tag")" = nightly
test "$(cat "$rollback_dir/state/releases/7/draft")" = false
test "$(cat "$rollback_dir/state/refs/nightly")" = "$old_sha"
test -f "$rollback_dir/state/uploads/$candidate_tag"
test ! -e "$rollback_dir/state/releases/8"
test ! -e "$rollback_dir/state/refs/$candidate_tag"
test ! -e "$rollback_dir/state/refs/$previous_tag"

printf 'publish-nightly-release success and rollback transitions: ok\n'

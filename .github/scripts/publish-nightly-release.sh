#!/usr/bin/env bash

set -euo pipefail

: "${GITHUB_REPOSITORY:?}"
: "${GITHUB_RUN_ATTEMPT:?}"
: "${GITHUB_RUN_ID:?}"
: "${GITHUB_SHA:?}"
: "${RUNNER_TEMP:?}"

repository_owner=${GITHUB_REPOSITORY%/*}
repository_name=${GITHUB_REPOSITORY#*/}
candidate_tag="nightly-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
previous_tag="${candidate_tag}-previous"

lookup_release_id() {
  gh api graphql \
    -f query='query($owner: String!, $name: String!, $tag: String!) {
      repository(owner: $owner, name: $name) {
        release(tagName: $tag) { databaseId }
      }
    }' \
    -F owner="$repository_owner" \
    -F name="$repository_name" \
    -F tag="$1" \
    --jq '.data.repository.release.databaseId // empty'
}

lookup_ref_sha() {
  gh api graphql \
    -f query='query($owner: String!, $name: String!, $ref: String!) {
      repository(owner: $owner, name: $name) {
        ref(qualifiedName: $ref) { target { oid } }
      }
    }' \
    -F owner="$repository_owner" \
    -F name="$repository_name" \
    -F ref="refs/tags/$1" \
    --jq '.data.repository.ref.target.oid // empty'
}

previous_release_id=$(lookup_release_id nightly)
previous_sha=$(lookup_ref_sha nightly)
if [ -n "$previous_release_id" ] && [ -z "$previous_sha" ]; then
  printf 'nightly release %s has no matching tag ref\n' "$previous_release_id" >&2
  exit 1
fi

candidate_release_id=''
nightly_ref_change_attempted=false
previous_ref_create_attempted=false
previous_release_retag_attempted=false

cleanup() {
  status=$?
  trap - EXIT
  set +e
  delete_previous_ref=$previous_ref_create_attempted
  delete_candidate_ref=false
  rollback_ref_ready=true

  if [ "$status" -eq 0 ]; then
    delete_candidate_ref=true
    if [ -n "$previous_release_id" ]; then
      if ! gh api --method DELETE "repos/${GITHUB_REPOSITORY}/releases/${previous_release_id}"; then
        status=1
        delete_previous_ref=false
      fi
    fi
  else
    if [ -n "$candidate_release_id" ]; then
      if ! gh api --method DELETE "repos/${GITHUB_REPOSITORY}/releases/${candidate_release_id}"; then
        status=1
      else
        delete_candidate_ref=true
      fi
    fi
    if [ "$nightly_ref_change_attempted" = true ]; then
      if [ -n "$previous_sha" ]; then
        if ! gh api --method PATCH "repos/${GITHUB_REPOSITORY}/git/refs/tags/nightly" \
          -f sha="$previous_sha" \
          -F force=true; then
          status=1
          rollback_ref_ready=false
          delete_previous_ref=false
        fi
      else
        gh api --method DELETE "repos/${GITHUB_REPOSITORY}/git/refs/tags/nightly" || status=1
      fi
    fi
    if [ "$previous_release_retag_attempted" = true ] && [ "$rollback_ref_ready" = true ]; then
      if ! gh api --method PATCH "repos/${GITHUB_REPOSITORY}/releases/${previous_release_id}" \
        -f tag_name=nightly >/dev/null; then
        status=1
        delete_previous_ref=false
      fi
    fi
  fi

  if [ "$delete_previous_ref" = true ]; then
    gh api --method DELETE "repos/${GITHUB_REPOSITORY}/git/refs/tags/${previous_tag}" || status=1
  fi
  if [ "$delete_candidate_ref" = true ]; then
    gh api --method DELETE "repos/${GITHUB_REPOSITORY}/git/refs/tags/${candidate_tag}" || status=1
  fi

  exit "$status"
}
trap cleanup EXIT

candidate_release_id=$(
  gh api --method POST "repos/${GITHUB_REPOSITORY}/releases" \
    -f tag_name="$candidate_tag" \
    -f target_commitish="$GITHUB_SHA" \
    -f name=nightly \
    -F draft=true \
    -F prerelease=true \
    -f make_latest=false \
    -F body=@"$RUNNER_TEMP/nightly-release.md" \
    --jq '.id'
)
gh release upload "$candidate_tag" nightly-assets/*

if [ -n "$previous_release_id" ]; then
  previous_ref_create_attempted=true
  gh api --method POST "repos/${GITHUB_REPOSITORY}/git/refs" \
    -f ref="refs/tags/${previous_tag}" \
    -f sha="$previous_sha" >/dev/null
  previous_release_retag_attempted=true
  gh api --method PATCH "repos/${GITHUB_REPOSITORY}/releases/${previous_release_id}" \
    -f tag_name="$previous_tag" >/dev/null
fi

nightly_ref_change_attempted=true
if [ -n "$previous_sha" ]; then
  gh api --method PATCH "repos/${GITHUB_REPOSITORY}/git/refs/tags/nightly" \
    -f sha="$GITHUB_SHA" \
    -F force=true >/dev/null
else
  gh api --method POST "repos/${GITHUB_REPOSITORY}/git/refs" \
    -f ref='refs/tags/nightly' \
    -f sha="$GITHUB_SHA" >/dev/null
fi

gh api --method PATCH "repos/${GITHUB_REPOSITORY}/releases/${candidate_release_id}" \
  -f tag_name=nightly \
  -F draft=false >/dev/null

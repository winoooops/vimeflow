#!/usr/bin/env bash
set -euo pipefail

exec > >(tee -a /var/log/vimeflow-worker-bootstrap.log) 2>&1

region="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-west-1}}"
repo="${QA_REPO:-/opt/vimeflow/repo}"
repo_url="${QA_REPO_URL:-https://github.com/winoooops/vimeflow.git}"
runner_ref="${QA_RUNNER_REF:-}"
lifeline_dir="${QA_LIFELINE_DIR:-/opt/vimeflow/lifeline}"
lifeline_url="${QA_LIFELINE_URL:-https://github.com/winoooops/lifeline.git}"
lifeline_ref="${QA_LIFELINE_REF:-}"
codex_version="${QA_CODEX_VERSION:-}"
kimi_code_version="${QA_KIMI_CODE_VERSION:-}"
node_version="${QA_NODE_VERSION:-22}"
n_version="${QA_N_VERSION:-}"

if [ -z "$runner_ref" ]; then
  echo "error: QA_RUNNER_REF is required; set it to the exact runner branch or tag to bootstrap" >&2
  exit 1
fi

if [ -z "$codex_version" ]; then
  echo "error: QA_CODEX_VERSION is required; set it to the exact @openai/codex version to install" >&2
  exit 1
fi

if [ -z "$kimi_code_version" ]; then
  echo "error: QA_KIMI_CODE_VERSION is required; set it to the exact @moonshot-ai/kimi-code version to install" >&2
  exit 1
fi

if [ -z "$lifeline_ref" ]; then
  echo "error: QA_LIFELINE_REF is required; set it to the exact Lifeline branch or tag to clone" >&2
  exit 1
fi

# Require exact semver pins (e.g. 1.2.3 or 1.2.3-beta.1); reject dist-tags and ranges.
semver_re='^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?(\+[A-Za-z0-9.-]+)?$'
if [[ ! "$codex_version" =~ $semver_re ]]; then
  echo "error: QA_CODEX_VERSION must be an exact semver (e.g. 1.2.3 or 1.2.3-beta.1); got '${codex_version}'" >&2
  exit 1
fi

if [[ ! "$kimi_code_version" =~ $semver_re ]]; then
  echo "error: QA_KIMI_CODE_VERSION must be an exact semver (e.g. 1.2.3 or 1.2.3-beta.1); got '${kimi_code_version}'" >&2
  exit 1
fi

if [ -z "$n_version" ]; then
  echo "error: QA_N_VERSION is required; set it to the exact n version to install" >&2
  exit 1
fi

if [[ ! "$n_version" =~ $semver_re ]]; then
  echo "error: QA_N_VERSION must be an exact semver (e.g. 1.2.3 or 1.2.3-beta.1); got '${n_version}'" >&2
  exit 1
fi

# Require a full 40-char commit SHA for immutable Lifeline checkout.
sha_re='^[0-9a-fA-F]{40}$'
if [[ ! "$lifeline_ref" =~ $sha_re ]]; then
  echo "error: QA_LIFELINE_REF must be a full 40-character commit SHA; got '${lifeline_ref}'" >&2
  exit 1
fi

export AWS_REGION="$region"
export AWS_DEFAULT_REGION="$region"
export QA_LIFELINE_SKILLS_DIR="$lifeline_dir/skills"

install -d -m 0755 "$(dirname "$repo")"

dnf install -y \
  git \
  jq \
  nodejs \
  npm \
  dnf-plugins-core \
  libsecret \
  rust \
  cargo \
  gtk3-devel \
  librsvg2-devel \
  patchelf

if ! command -v gh >/dev/null 2>&1; then
  dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo
  dnf install -y gh
fi

npm install -g "n@${n_version}"
n "$node_version"
hash -r

npm install -g "@openai/codex@${codex_version}" "@moonshot-ai/kimi-code@${kimi_code_version}"

rm -rf "$repo" "$lifeline_dir"
git clone --branch "$runner_ref" "$repo_url" "$repo"
git init "$lifeline_dir"
git -C "$lifeline_dir" remote add origin "$lifeline_url"
git -C "$lifeline_dir" fetch --depth=1 origin "$lifeline_ref"
git -C "$lifeline_dir" checkout FETCH_HEAD

"$repo/scripts/qa-runner/deploy/worker-env-from-ssm.sh"

npm ci --prefix "$repo"

echo "vimeflow worker bootstrap complete: $(git -C "$repo" rev-parse --short HEAD)"

#!/usr/bin/env bash
set -euo pipefail

exec > >(tee -a /var/log/vimeflow-worker-bootstrap.log) 2>&1

region="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-west-1}}"
repo="${QA_REPO:-/opt/vimeflow/repo}"
repo_url="${QA_REPO_URL:-https://github.com/winoooops/vimeflow.git}"
runner_ref="${QA_RUNNER_REF:-wip/linear-wiring}"
lifeline_dir="${QA_LIFELINE_DIR:-/opt/vimeflow/lifeline}"
lifeline_url="${QA_LIFELINE_URL:-https://github.com/winoooops/lifeline.git}"
node_version="${QA_NODE_VERSION:-22}"

export AWS_REGION="$region"
export AWS_DEFAULT_REGION="$region"
export QA_LIFELINE_SKILLS_DIR="$lifeline_dir/skills"

install -d -m 0755 "$(dirname "$repo")"

dnf install -y git jq nodejs npm dnf-plugins-core libsecret

if ! command -v gh >/dev/null 2>&1; then
  dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo
  dnf install -y gh
fi

npm install -g n
n "$node_version"
hash -r

npm install -g @openai/codex kimi-code

rm -rf "$repo" "$lifeline_dir"
git clone --branch "$runner_ref" "$repo_url" "$repo"
git clone --depth=1 "$lifeline_url" "$lifeline_dir"

"$repo/scripts/qa-runner/deploy/worker-env-from-ssm.sh"

npm ci --prefix "$repo"

echo "vimeflow worker bootstrap complete: $(git -C "$repo" rev-parse --short HEAD)"

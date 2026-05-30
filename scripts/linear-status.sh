#!/usr/bin/env bash
# linear-status.sh — minimal Linear status helper over the GraphQL API.
# Lets an agent, a git hook, or you inspect and move Linear issue status without the SDK.
# API: https://api.linear.app/graphql  (rationale + sources: docs/explorations/linear-migration-analysis.html)
#
# NOTE: the GraphQL shapes below follow Linear's documented API but have not been run
# against a live workspace yet — use `--dry-run` to inspect the request, and verify the
# first real call once you have a workspace + LINEAR_API_KEY.
set -euo pipefail

API="https://api.linear.app/graphql"
DRY=0
if [[ "${1:-}" == "--dry-run" ]]; then DRY=1; shift; fi

usage() {
  cat <<'EOF'
linear-status.sh — minimal Linear status helper (GraphQL)

Usage: linear-status.sh [--dry-run] <command> [args]

  whoami                      Verify LINEAR_API_KEY; show the authenticated user
  states <TEAM_KEY>           List workflow states (uuid + name) for a team (e.g. VIM)
  find <ISSUE_ID>             Show an issue's uuid + current status (e.g. VIM-12)
  set <ISSUE_ID> <STATE_ID>   Move an issue to a state (STATE_ID = uuid from `states`)

Env:  LINEAR_API_KEY   Personal API key (Linear → Settings → Security & access → Personal API keys)
Deps: curl, jq         --dry-run prints the GraphQL request instead of sending it.
EOF
}

need() { command -v "$1" >/dev/null || { echo "error: '$1' is required" >&2; exit 1; }; }

gql() { # $1 query  $2 variables-json (optional)
  local query="$1" vars="${2:-}"
  [[ -z "$vars" ]] && vars='{}'
  local payload
  payload=$(jq -n --arg q "$query" --argjson v "$vars" '{query:$q, variables:$v}')
  if [[ "$DRY" -eq 1 ]]; then
    printf 'POST %s\n' "$API"
    printf '%s\n' "$payload" | jq .
    return 0
  fi
  : "${LINEAR_API_KEY:?set LINEAR_API_KEY (see scripts/linear.env.example)}"
  # --fail-with-body keeps Linear's JSON error body on 4xx/5xx (plain -f drops it);
  # --max-time / --connect-timeout stop a git-hook or CI call hanging if the API is unreachable.
  local resp
  resp=$(curl --fail-with-body -sS --max-time 10 --connect-timeout 5 \
    "$API" -H "Authorization: $LINEAR_API_KEY" -H 'Content-Type: application/json' -d "$payload") || {
    echo "error: Linear API request failed:" >&2
    printf '%s\n' "$resp" >&2
    return 1
  }
  # GraphQL can also return errors in an "errors" array with HTTP 200 — surface and fail.
  if jq -e 'has("errors") and (.errors | length > 0)' >/dev/null 2>&1 <<<"$resp"; then
    echo "error: Linear GraphQL returned errors:" >&2
    jq -r '.errors[].message' <<<"$resp" >&2
    return 1
  fi
  printf '%s\n' "$resp"
}

emit() { if [[ "$DRY" -eq 1 ]]; then cat; else jq -r "$1"; fi; }

main() {
  local cmd="${1:-}"; shift || true
  case "$cmd" in
    whoami)
      need curl; need jq
      gql 'query { viewer { id name email } }' \
        | emit '.data.viewer | "\(.name) <\(.email)>  id=\(.id)"' ;;
    states)
      need curl; need jq
      : "${1:?usage: states <TEAM_KEY>}"
      gql 'query($k:String!){ teams(filter:{key:{eq:$k}}){ nodes { states { nodes { id name type } } } } }' \
          "$(jq -n --arg k "$1" '{k:$k}')" \
        | emit '.data.teams.nodes[0].states.nodes[] | "\(.id)  [\(.type)]  \(.name)"' ;;
    find)
      need curl; need jq
      : "${1:?usage: find <ISSUE_ID>}"
      gql 'query($id:String!){ issue(id:$id){ id identifier title state { id name } } }' \
          "$(jq -n --arg id "$1" '{id:$id}')" \
        | emit '.data.issue | "\(.identifier)  \(.title)\n  uuid=\(.id)\n  status=\(.state.name)  state_id=\(.state.id)"' ;;
    set)
      need curl; need jq
      : "${1:?usage: set <ISSUE_ID> <STATE_ID>}"; : "${2:?usage: set <ISSUE_ID> <STATE_ID>}"
      gql 'mutation($id:String!,$s:String!){ issueUpdate(id:$id, input:{stateId:$s}){ success issue { identifier state { name } } } }' \
          "$(jq -n --arg id "$1" --arg s "$2" '{id:$id,s:$s}')" \
        | emit '.data.issueUpdate | "ok=\(.success)  \(.issue.identifier) → \(.issue.state.name)"' ;;
    ""|-h|--help) usage ;;
    *) echo "unknown command: $cmd" >&2; usage; exit 1 ;;
  esac
}

main "$@"

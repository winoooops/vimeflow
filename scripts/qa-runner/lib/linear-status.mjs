#!/usr/bin/env node
// Linear status helper — posts a comment (and optionally moves status) on a VIM
// issue via the GraphQL API. Headless ⇒ no interactive MCP (see
// rules/common/linear-workflow.md).
//
// Auth is role-aware: `--as fixer|orchestrator` posts as that role's Linear AGENT
// (OAuth token from linear-agent.env / linear-orchestrator.env → "Bearer …"), so
// comments carry the agent's identity, not yours. Without a linked agent it falls
// back to the personal LINEAR_API_KEY ($env or repo-root linear.env).
//
// Usage: node linear-status.mjs <VIM-N> "<comment>" [--state "<name>"] [--as <role>]

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const API = 'https://api.linear.app/graphql'

// Repo root (shared across linked worktrees via --git-common-dir) — where the
// gitignored Linear env files live.
const repoRoot = () =>
  dirname(
    execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8' }
    ).trim()
  )

// Pull a single KEY=value from a dotenv-style file, or undefined.
const readEnvVar = (file, key) => {
  if (!existsSync(file)) return undefined
  const m = readFileSync(file, 'utf8').match(
    new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.+?)\\s*$`, 'm')
  )
  return m ? m[1].replace(/^["']|["']$/g, '') : undefined
}

// Each role's Linear AGENT (OAuth) token lives in its own gitignored env file.
const ROLE_FILE = {
  fixer: 'linear-agent.env',
  orchestrator: 'linear-orchestrator.env',
}

// Authorization for a role: prefer that role's AGENT token (Bearer, posts as the
// agent), else the personal key (raw header, posts as you). Returns { header, who }.
const loadAuth = (role) => {
  const root = repoRoot()
  if (role) {
    const file = ROLE_FILE[role]
    if (!file)
      throw new Error(`unknown --as role "${role}" (fixer|orchestrator)`)
    const tok = readEnvVar(join(root, file), 'LINEAR_AGENT_TOKEN')
    if (tok && !/PASTE|xxxx/i.test(tok))
      return { header: `Bearer ${tok}`, who: `${role} agent` }
  }
  const key =
    process.env.LINEAR_API_KEY ||
    readEnvVar(join(root, 'linear.env'), 'LINEAR_API_KEY')
  if (key) return { header: key, who: 'you (personal key)' }
  throw new Error(
    'no Linear auth — link the agent (LINEAR_AGENT_TOKEN) or set LINEAR_API_KEY (env or repo-root linear.env). See rules/common/linear-workflow.md'
  )
}

const gql = async (auth, query, variables) => {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json()
  if (json.errors?.length) {
    throw new Error(
      `Linear GraphQL: ${json.errors.map((e) => e.message).join('; ')}`
    )
  }
  return json.data
}

const main = async () => {
  const [identifier, body, ...rest] = process.argv.slice(2)
  if (!identifier || !body) {
    throw new Error(
      'usage: linear-status.mjs <VIM-N> "<comment>" [--state "<name>"] [--as <role>]'
    )
  }
  const flag = (n) => (rest.includes(n) ? rest[rest.indexOf(n) + 1] : undefined)
  const stateName = flag('--state')
  const auth = loadAuth(flag('--as'))

  const d = await gql(
    auth.header,
    'query($id:String!){issue(id:$id){id identifier team{id}}}',
    { id: identifier }
  )
  if (!d.issue) throw new Error(`issue ${identifier} not found`)

  await gql(
    auth.header,
    'mutation($id:String!,$body:String!){commentCreate(input:{issueId:$id,body:$body}){success}}',
    { id: d.issue.id, body }
  )
  process.stdout.write(`commented on ${identifier} (as ${auth.who})\n`)

  if (stateName) {
    const s = await gql(
      auth.header,
      'query($t:ID!){workflowStates(filter:{team:{id:{eq:$t}}}){nodes{id name}}}',
      { t: d.issue.team.id }
    )
    const st = s.workflowStates.nodes.find(
      (n) => n.name.toLowerCase() === stateName.toLowerCase()
    )
    if (!st) throw new Error(`state "${stateName}" not found for the team`)
    await gql(
      auth.header,
      'mutation($id:String!,$s:String!){issueUpdate(id:$id,input:{stateId:$s}){success}}',
      { id: d.issue.id, s: st.id }
    )
    process.stdout.write(`moved ${identifier} → ${st.name}\n`)
  }
}

main().catch((e) => {
  process.stderr.write(`${e.message}\n`)
  process.exit(1)
})

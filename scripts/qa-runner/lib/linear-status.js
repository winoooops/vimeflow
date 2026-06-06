#!/usr/bin/env node
// Linear status helper — posts a comment (and optionally moves status) on a VIM
// issue via the GraphQL API. Headless ⇒ no interactive MCP (see
// rules/common/linear-workflow.md).
//
// Auth is role-aware: `--as fixer|orchestrator` posts as that role's Linear app
// (client credentials from linear-agent.env / linear-orchestrator.env -> app
// actor token), so comments carry the bot identity, not yours. A stored OAuth
// access token is kept as a compatibility fallback; without either, it falls back
// to the personal LINEAR_API_KEY ($env or repo-root linear.env).
//
// Usage: node linear-status.js <VIM-N> "<comment>" [--state "<name>"] [--as <role>] [--parent <comment-id>]

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const API = 'https://api.linear.app/graphql'
const TOKEN_API = 'https://api.linear.app/oauth/token'

// Repo root (shared across linked worktrees via --git-common-dir) — where the
// gitignored Linear env files live.
export const repoRoot = () =>
  dirname(
    execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8' }
    ).trim()
  )

const isRealSecret = (value) => value && !/PASTE|xxxx/i.test(value)

export const readEnvFile = (file) => {
  const env = {}
  let content
  try {
    if (!existsSync(file)) {
      return env
    }

    content = readFileSync(file, 'utf8')
  } catch (e) {
    if (['ENOENT', 'EACCES', 'EPERM', 'EISDIR'].includes(e?.code)) {
      return env
    }

    throw e
  }

  for (const line of content.split(/\r?\n/)) {
    const m = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/
    )
    if (!m) {
      continue
    }

    const [, key, rawValue] = m
    env[key] = rawValue.replace(/^["']|["']$/g, '')
  }

  return env
}

// Each role's Linear app credentials live in a separate gitignored env file.
const ROLE_FILE = {
  fixer: 'linear-agent.env',
  orchestrator: 'linear-orchestrator.env',
}

const readEnvVar = (file, key) => readEnvFile(file)[key]

const LINEAR_AUTH_ENV_KEYS = [
  'LINEAR_CLIENT_ID',
  'LINEAR_CLIENT_SECRET',
  'LINEAR_SCOPES',
  'LINEAR_ACCESS_TOKEN',
  'LINEAR_AGENT_TOKEN',
]

const pickProcessLinearAuth = (env = process.env) =>
  Object.fromEntries(
    LINEAR_AUTH_ENV_KEYS.filter((key) => env[key] != null).map((key) => [
      key,
      env[key],
    ])
  )

const roleFile = (root, role) => {
  const file = ROLE_FILE[role]
  if (!file) {
    throw new Error(`unknown --as role "${role}" (fixer|orchestrator)`)
  }

  return join(root, file)
}

const loadRoleAuthEnv = (root, role, processEnv = process.env) => ({
  ...readEnvFile(roleFile(root, role)),
  ...pickProcessLinearAuth(processEnv),
})

const mintClientCredentialsAuth = async (role, env, fetchImpl) => {
  if (
    !isRealSecret(env.LINEAR_CLIENT_ID) ||
    !isRealSecret(env.LINEAR_CLIENT_SECRET)
  ) {
    return null
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: env.LINEAR_SCOPES || 'read,write',
    client_id: env.LINEAR_CLIENT_ID,
    client_secret: env.LINEAR_CLIENT_SECRET,
  })

  const res = await fetchImpl(TOKEN_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const reason = json.error_description || json.error || `HTTP ${res.status}`
    throw new Error(`Linear ${role} client_credentials failed: ${reason}`)
  }
  if (!json.access_token) {
    throw new Error(
      `Linear ${role} client_credentials returned no access_token`
    )
  }

  return { header: `Bearer ${json.access_token}`, who: `${role} app` }
}

// Authorization for a role: prefer role app client credentials (Bearer, posts as
// the app), then a stored role access token, else the personal key (raw header,
// posts as you). Returns { header, who }.
export const loadAuthFromRoot = async (
  role,
  root,
  fetchImpl = fetch,
  processEnv = process.env
) => {
  if (role) {
    const env = loadRoleAuthEnv(root, role, processEnv)
    let clientCredentialsError
    try {
      const auth = await mintClientCredentialsAuth(role, env, fetchImpl)
      if (auth) {
        return auth
      }
    } catch (e) {
      clientCredentialsError = e
    }

    const tok = env.LINEAR_ACCESS_TOKEN || env.LINEAR_AGENT_TOKEN
    if (isRealSecret(tok)) {
      return { header: `Bearer ${tok}`, who: `${role} access token` }
    }
    if (clientCredentialsError) {
      throw clientCredentialsError
    }
  }

  const key =
    processEnv.LINEAR_API_KEY ||
    readEnvVar(join(root, 'linear.env'), 'LINEAR_API_KEY')
  if (key) {
    return { header: key, who: 'you (personal key)' }
  }
  throw new Error(
    'no Linear auth — configure role client credentials, set LINEAR_ACCESS_TOKEN / LINEAR_AGENT_TOKEN, or set LINEAR_API_KEY (env or repo-root linear.env). See rules/common/linear-workflow.md'
  )
}

const loadAuth = (role) => loadAuthFromRoot(role, repoRoot())

export const linearGql = async (auth, query, variables, fetchImpl = fetch) => {
  const res = await fetchImpl(API, {
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

export const parseLinearCommentId = (stdout) =>
  (stdout.match(/comment-id:\t([0-9a-f-]*)/) || [])[1] || null

export const createLinearComment = async (
  auth,
  { issueId, parentId, body },
  fetchImpl = fetch
) => {
  const data = parentId
    ? await linearGql(
        auth,
        'mutation($id:String!,$parentId:String!,$body:String!){commentCreate(input:{issueId:$id,parentId:$parentId,body:$body}){success comment{id}}}',
        { id: issueId, parentId, body },
        fetchImpl
      )
    : await linearGql(
        auth,
        'mutation($id:String!,$body:String!){commentCreate(input:{issueId:$id,body:$body}){success comment{id}}}',
        { id: issueId, body },
        fetchImpl
      )

  return data.commentCreate?.comment?.id ?? null
}

export const main = async () => {
  const [identifier, body, ...rest] = process.argv.slice(2)
  if (!identifier || !body) {
    throw new Error(
      'usage: linear-status.js <VIM-N> "<comment>" [--state "<name>"] [--as <role>] [--parent <comment-id>]'
    )
  }
  const flag = (n) => (rest.includes(n) ? rest[rest.indexOf(n) + 1] : undefined)
  const stateName = flag('--state')
  const parentId = flag('--parent')
  const auth = await loadAuth(flag('--as'))

  const d = await linearGql(
    auth.header,
    'query($id:String!){issue(id:$id){id identifier team{id}}}',
    { id: identifier }
  )
  if (!d.issue) {
    throw new Error(`issue ${identifier} not found`)
  }

  const commentId = await createLinearComment(auth.header, {
    issueId: d.issue.id,
    parentId,
    body,
  })
  process.stdout.write(
    `commented on ${identifier} (as ${auth.who}${commentId ? `, comment ${commentId}` : ''}${parentId ? `, parent ${parentId}` : ''})\n`
  )
  process.stdout.write(`comment-id:\t${commentId ?? ''}\n`)

  if (stateName) {
    const s = await linearGql(
      auth.header,
      'query($t:ID!){workflowStates(filter:{team:{id:{eq:$t}}}){nodes{id name}}}',
      { t: d.issue.team.id }
    )

    const st = s.workflowStates.nodes.find(
      (n) => n.name.toLowerCase() === stateName.toLowerCase()
    )
    if (!st) {
      throw new Error(`state "${stateName}" not found for the team`)
    }
    await linearGql(
      auth.header,
      'mutation($id:String!,$s:String!){issueUpdate(id:$id,input:{stateId:$s}){success}}',
      { id: d.issue.id, s: st.id }
    )
    process.stdout.write(`moved ${identifier} → ${st.name}\n`)
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main()
  } catch (e) {
    process.stderr.write(`${e.message}\n`)
    process.exit(1)
  }
}

#!/usr/bin/env node
// Linear status helper — posts a comment (and optionally moves status) on a VIM
// issue via the GraphQL API. Headless ⇒ scoped LINEAR_API_KEY (not interactive
// MCP — see rules/common/linear-workflow.md). The key comes from $LINEAR_API_KEY
// or the repo-root linear.env.
//
// Usage: node linear-status.mjs <VIM-N> "<comment markdown>" [--state "<name>"]

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const API = 'https://api.linear.app/graphql'

const loadKey = () => {
  if (process.env.LINEAR_API_KEY) return process.env.LINEAR_API_KEY
  const root = dirname(
    execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      {
        encoding: 'utf8',
      }
    ).trim()
  )
  const envFile = join(root, 'linear.env')
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, 'utf8').match(
      /^\s*(?:export\s+)?LINEAR_API_KEY\s*=\s*(.+?)\s*$/m
    )
    if (m) return m[1].replace(/^["']|["']$/g, '')
  }
  throw new Error(
    'LINEAR_API_KEY not set (env or repo-root linear.env). See rules/common/linear-workflow.md'
  )
}

const gql = async (key, query, variables) => {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: key },
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
      'usage: linear-status.mjs <VIM-N> "<comment>" [--state "<name>"]'
    )
  }
  const stateName = rest.includes('--state')
    ? rest[rest.indexOf('--state') + 1]
    : undefined
  const key = loadKey()

  const d = await gql(
    key,
    'query($id:String!){issue(id:$id){id identifier team{id}}}',
    { id: identifier }
  )
  if (!d.issue) throw new Error(`issue ${identifier} not found`)

  await gql(
    key,
    'mutation($id:String!,$body:String!){commentCreate(input:{issueId:$id,body:$body}){success}}',
    { id: d.issue.id, body }
  )
  process.stdout.write(`commented on ${identifier}\n`)

  if (stateName) {
    const s = await gql(
      key,
      'query($t:String!){workflowStates(filter:{team:{id:{eq:$t}}}){nodes{id name}}}',
      { t: d.issue.team.id }
    )
    const st = s.workflowStates.nodes.find(
      (n) => n.name.toLowerCase() === stateName.toLowerCase()
    )
    if (!st) throw new Error(`state "${stateName}" not found for the team`)
    await gql(
      key,
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

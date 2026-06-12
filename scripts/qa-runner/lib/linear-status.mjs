#!/usr/bin/env node
// Linear status helper — posts a comment (and optionally moves status) on a VIM
// issue via the GraphQL API. Headless ⇒ scoped LINEAR_API_KEY (not interactive
// MCP — see rules/common/linear-workflow.md). The key comes from $LINEAR_API_KEY
// or the repo-root linear.env.
//
// Usage: node linear-status.mjs <VIM-N> "<comment markdown>" [--state "<name>"]

import {
  commentIssue,
  issueByIdentifier,
  loadKey,
  updateIssueState,
  workflowStateByName,
} from './linear-client.mjs'

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

  const issue = await issueByIdentifier(key, identifier)
  if (!issue) throw new Error(`issue ${identifier} not found`)

  await commentIssue(key, issue.id, body)
  process.stdout.write(`commented on ${identifier}\n`)

  if (stateName) {
    const st = await workflowStateByName(key, issue.team.id, stateName)
    if (!st) throw new Error(`state "${stateName}" not found for the team`)
    await updateIssueState(key, issue.id, st.id)
    process.stdout.write(`moved ${identifier} → ${st.name}\n`)
  }
}

main().catch((e) => {
  process.stderr.write(`${e.message}\n`)
  process.exit(1)
})

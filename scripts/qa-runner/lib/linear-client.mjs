import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const API = 'https://api.linear.app/graphql'

export const loadKey = () => {
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

export const gql = async (key, query, variables) => {
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

export const issueByIdentifier = async (key, identifier) => {
  const d = await gql(
    key,
    'query($id:String!){issue(id:$id){id identifier team{id}}}',
    { id: identifier }
  )
  return d.issue
}

export const commentIssue = (key, issueId, body) =>
  gql(
    key,
    'mutation($id:String!,$body:String!){commentCreate(input:{issueId:$id,body:$body}){success}}',
    { id: issueId, body }
  )

export const workflowStateByName = async (key, teamId, stateName) => {
  const s = await gql(
    key,
    'query($t:String!){workflowStates(filter:{team:{id:{eq:$t}}}){nodes{id name}}}',
    { t: teamId }
  )
  return s.workflowStates.nodes.find(
    (n) => n.name.toLowerCase() === stateName.toLowerCase()
  )
}

export const updateIssueState = (key, issueId, stateId) =>
  gql(
    key,
    'mutation($id:String!,$s:String!){issueUpdate(id:$id,input:{stateId:$s}){success}}',
    { id: issueId, s: stateId }
  )

export const teamByKey = async (key, teamKey) => {
  const d = await gql(
    key,
    'query($key:String!){teams(filter:{key:{eqIgnoreCase:$key}},first:2){nodes{id key name}}}',
    { key: teamKey }
  )
  const team = d.teams.nodes[0]
  if (!team) throw new Error(`Linear team key "${teamKey}" not found`)
  return team
}

export const findIssueForPr = async (key, { teamKey, prNumber, prUrl }) => {
  const d = await gql(
    key,
    'query($teamKey:String!,$url:String!,$titlePrefix:String!){issues(filter:{team:{key:{eqIgnoreCase:$teamKey}},or:[{description:{contains:$url}},{title:{contains:$titlePrefix}}]},first:10){nodes{id identifier title url description}}}',
    { teamKey, url: `${prUrl}\n`, titlePrefix: `PR #${prNumber}:` }
  )
  const expectedPrLine = `PR: ${prUrl}\n`
  return (
    d.issues.nodes.find((candidate) => {
      const titleOk = candidate.title?.startsWith(`PR #${prNumber}:`) ?? false
      const descriptionOk =
        typeof candidate.description === 'string' &&
        candidate.description.includes(expectedPrLine)
      return titleOk || descriptionOk
    }) ?? null
  )
}

export const createIssueForPr = async (
  key,
  { teamId, prNumber, title, url, headRefName, repo }
) => {
  const d = await gql(
    key,
    'mutation($input:IssueCreateInput!){issueCreate(input:$input){success issue{id identifier title url}}}',
    {
      input: {
        teamId,
        title: `PR #${prNumber}: ${title}`,
        description: [
          `Created automatically for GitHub PR #${prNumber}.`,
          '',
          `PR: ${url}`,
          `Repository: ${repo}`,
          `Branch: ${headRefName}`,
        ].join('\n'),
      },
    }
  )
  if (!d.issueCreate.success || !d.issueCreate.issue) {
    throw new Error(`Linear issueCreate failed for PR #${prNumber}`)
  }
  return d.issueCreate.issue
}

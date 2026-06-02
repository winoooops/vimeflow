import { loadAuthFromRoot, linearGql, repoRoot } from './linear-status.js'

export const buildPrIssueInput = ({ teamId, pr, title, url, branch }) => ({
  teamId,
  title: `Review PR #${pr}: ${title || 'untitled pull request'}`,
  description: [
    'Created by the QA orchestrator because this pull request had no linked Linear issue.',
    '',
    `GitHub PR: ${url}`,
    `Branch: \`${branch || 'unknown'}\``,
  ].join('\n'),
})

export const createLinearIssueForPr = async (
  { teamKey, pr, title, url, branch },
  {
    role = 'orchestrator',
    root = repoRoot(),
    fetchImpl = fetch,
    gql = linearGql,
  } = {}
) => {
  const auth = await loadAuthFromRoot(role, root, fetchImpl)

  const teamData = await gql(
    auth.header,
    'query($key:String!){teams(filter:{key:{eq:$key}},first:1){nodes{id key name}}}',
    { key: teamKey },
    fetchImpl
  )
  const nodes = teamData?.teams?.nodes
  if (!nodes?.length) {
    throw new Error(
      teamData?.errors?.[0]?.message ?? `Linear team ${teamKey} not found`
    )
  }
  const team = nodes[0]

  const issueData = await gql(
    auth.header,
    'mutation($input:IssueCreateInput!){issueCreate(input:$input){success issue{id identifier url}}}',
    {
      input: buildPrIssueInput({
        teamId: team.id,
        pr,
        title,
        url,
        branch,
      }),
    },
    fetchImpl
  )
  const issue = issueData.issueCreate?.issue
  if (!issueData.issueCreate?.success || !issue?.identifier) {
    throw new Error('Linear issueCreate failed')
  }

  return issue
}

import { createLinearIssueForPr } from './linear-issue.js'

export const ORCHESTRATOR_TOOLS = [
  {
    name: 'create_linear_issue_for_pr',
    description:
      'Create a Linear issue for a GitHub PR that has no linked VIM issue, then use that issue for future QA comments.',
    execute: createLinearIssueForPr,
  },
]

export const orchestratorTool = (name) =>
  ORCHESTRATOR_TOOLS.find((tool) => tool.name === name)

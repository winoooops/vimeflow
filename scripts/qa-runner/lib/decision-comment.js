import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const QA_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const STATE_DIR = join(QA_DIR, '.state')

export const DEFAULT_DECISION_STORE = join(STATE_DIR, 'decision-comments.json')

export const decisionStorePath = (pr) =>
  join(STATE_DIR, `decision-pr-${pr}.json`)

const tableValue = (value) =>
  String(value ?? 'unknown')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')

const shortSha = (sha) => (sha ? `\`${sha.slice(0, 7)}\`` : '`unknown`')

export const actionForDecision = (state, { approve, execute } = {}) => {
  if (state === 'NEEDS_FIX') {
    return execute ? 'dispatch fixer' : 'none'
  }
  if (state === 'GOOD_SHAPE') {
    return approve ? 'approve/merge' : 'none'
  }

  return 'none'
}

export const explainDecision = (state, action) => {
  if (state === 'NEEDS_FIX') {
    return action === 'dispatch fixer'
      ? 'Review findings require a fixer cycle and execute is armed.'
      : 'Review findings require a fixer cycle, but execute is not armed.'
  }
  if (state === 'GOOD_SHAPE') {
    return action === 'approve/merge'
      ? 'PR meets success criteria and approve is armed.'
      : 'PR meets success criteria, but approve is not armed.'
  }
  if (state === 'CI_RED') {
    return 'Non-review CI is failing or canceled, so the fixer is not dispatched.'
  }
  if (state === 'WAITING') {
    return 'The runner is waiting for CI, review, mergeability, or a new event.'
  }

  return 'No action was selected for this state.'
}

export const decisionKey = ({
  pr,
  state,
  detail,
  headSha,
  action,
  approve,
  execute,
}) =>
  [
    pr,
    headSha || 'unknown-head',
    state,
    detail,
    action,
    approve ? 'approve' : 'no-approve',
    execute ? 'execute' : 'no-execute',
  ].join('|')

export const formatDecisionComment = ({
  pr,
  branch,
  state,
  detail,
  sourceEvent,
  action,
  approve,
  execute,
  headSha,
  ci,
  claude,
  threads,
  mergeable,
  mergeStateStatus,
}) => {
  const lines = [
    `## QA runner decision: ${state}`,
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| PR | #${tableValue(pr)} |`,
    `| Branch | \`${tableValue(branch)}\` |`,
    `| Source event | \`${tableValue(sourceEvent || 'manual')}\` |`,
    `| Decision | \`${tableValue(state)}\` |`,
    `| Detail | ${tableValue(detail)} |`,
    `| Action | ${tableValue(action)} |`,
    `| Execute armed | ${execute ? 'true' : 'false'} |`,
    `| Approve armed | ${approve ? 'true' : 'false'} |`,
    `| Head | ${shortSha(headSha)} |`,
    '',
    'Checks:',
    `- CI: ${ci ?? 'unknown'}`,
    `- Claude: ${claude ?? 'unknown'}`,
    `- Unresolved threads: ${threads ?? 'unknown'}`,
    `- Mergeable: ${mergeable ?? 'unknown'}${
      mergeStateStatus ? ` (${mergeStateStatus})` : ''
    }`,
    '',
    `Reason: ${explainDecision(state, action)}`,
  ]

  return lines.join('\n')
}

export const formatFixerCycleComment = ({
  pr,
  url,
  branch,
  headSha,
  result = 'fix pushed',
  kimiExit,
  stopMode,
  worktreeClean,
}) => {
  const lines = [
    '## QA fixer cycle: complete',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| PR | #${tableValue(pr)} |`,
    `| URL | ${tableValue(url)} |`,
    `| Branch | \`${tableValue(branch)}\` |`,
    `| Result | ${tableValue(result)} |`,
    `| Head | ${shortSha(headSha)} |`,
    `| Kimi exit | \`${tableValue(kimiExit)}\` |`,
    `| Stop mode | ${tableValue(stopMode)} |`,
    `| Worktree | ${worktreeClean ? 'clean' : 'dirty after run'} |`,
    '',
    'Action: pushed one `/lifeline:upsource-review` fixer cycle; re-review is pending.',
  ]

  return lines.join('\n')
}

export const readDecisionStore = (file) => {
  if (!existsSync(file)) {
    return {}
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

export const shouldPostDecision = (store, pr, key) => store[String(pr)] !== key

export const markDecisionPosted = (
  store,
  pr,
  key,
  file
) => {
  const next = { ...store, [String(pr)]: key }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`)

  return next
}

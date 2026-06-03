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
      ? 'Review or deterministic CI findings require a fixer cycle and execute is armed.'
      : 'Review or deterministic CI findings require a fixer cycle, but execute is not armed.'
  }
  if (state === 'GOOD_SHAPE') {
    return action === 'approve/merge'
      ? 'PR meets success criteria and approve is armed.'
      : 'PR meets success criteria, but approve is not armed.'
  }
  if (state === 'CI_RED') {
    return 'CI is red and no automatic action is available for this state.'
  }
  if (state === 'WAITING') {
    if (action === 'rerun check') {
      return 'A transient check was rerun and the runner is waiting for the new result.'
    }

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
  ciClassification,
  checkSummaries = [],
  rerunAttempt,
  rerunLimit,
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
  ]

  if (ciClassification) {
    lines.push(`| CI classification | ${tableValue(ciClassification)} |`)
  }
  if (rerunAttempt != null) {
    lines.push(
      `| Rerun attempt | ${tableValue(rerunAttempt)} / ${tableValue(rerunLimit)} |`
    )
  }

  lines.push(
    '',
    'Checks:',
    `- CI: ${ci ?? 'unknown'}`,
    `- Claude: ${claude ?? 'unknown'}`,
    `- Unresolved threads: ${threads ?? 'unknown'}`,
    `- Mergeable: ${mergeable ?? 'unknown'}${
      mergeStateStatus ? ` (${mergeStateStatus})` : ''
    }`
  )

  if (checkSummaries.length) {
    lines.push('', 'Affected checks:')
    for (const check of checkSummaries) {
      lines.push(
        `- ${tableValue(check.name)}${check.workflow ? ` (${tableValue(check.workflow)})` : ''}: ${tableValue(check.bucket)}${check.link ? ` — ${tableValue(check.link)}` : ''}`
      )
    }
  }

  lines.push('', `Reason: ${explainDecision(state, action)}`)

  return lines.join('\n')
}

export const formatMergedComment = (pr) =>
  `🎉 #${pr} merged — review loop complete.`

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

const decisionEntry = (store, pr) => {
  const entry = store[String(pr)]
  if (!entry) {
    return {}
  }
  if (typeof entry === 'string') {
    return { key: entry }
  }

  return entry
}

export const shouldPostDecision = (store, pr, key) => {
  const entry = decisionEntry(store, pr)

  return entry.key !== key || !('commentId' in entry)
}

export const decisionCommentId = (
  store,
  pr,
  { state, headSha, action } = {}
) => {
  const entry = decisionEntry(store, pr)
  if (!entry.commentId) {
    return null
  }
  if (state && entry.state !== state) {
    return null
  }
  if (headSha && entry.headSha !== headSha) {
    return null
  }
  if (action && entry.action !== action) {
    return null
  }

  return entry.commentId
}

export const hasMergeLinearPosted = (store, pr) =>
  Boolean(decisionEntry(store, pr).mergeLinearPosted)

const writeDecisionStore = (next, file) => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`)

  return next
}

export const markDecisionPosted = (
  store,
  pr,
  key,
  file,
  { commentId, state, headSha, action } = {}
) => {
  const next = {
    ...store,
    [String(pr)]: {
      ...decisionEntry(store, pr),
      key,
      ...(commentId !== undefined && { commentId }),
      ...(state !== undefined && { state }),
      ...(headSha !== undefined && { headSha }),
      ...(action !== undefined && { action }),
    },
  }

  return writeDecisionStore(next, file)
}

export const markMergeLinearPosted = (store, pr, file) => {
  const next = {
    ...store,
    [String(pr)]: {
      ...decisionEntry(store, pr),
      mergeLinearPosted: true,
    },
  }

  return writeDecisionStore(next, file)
}

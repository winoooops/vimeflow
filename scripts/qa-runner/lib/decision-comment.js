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

const conciseValue = (value, limit = 320) => {
  const text = tableValue(value)

  return text.length > limit ? `${text.slice(0, limit - 3)}...` : text
}

const shortSha = (sha) => (sha ? `\`${sha.slice(0, 7)}\`` : '`unknown`')

const shortKey = (key) => (key ? `\`${String(key).slice(0, 12)}\`` : '`none`')

const count = (items) => (Array.isArray(items) ? items.length : 0)

const formatCommentIds = (ids = []) =>
  ids.length ? ids.map((id) => `\`${id}\``).join(', ') : '`none`'

const findingTitle = (finding) =>
  `${finding?.severity || 'UNKNOWN'}: ${finding?.title || 'untitled finding'}`

const formatFindingLine = (finding) => {
  const basis = [
    finding?.real_world_risk && `risk=${finding.real_world_risk}`,
    finding?.fix_cost && `fix=${finding.fix_cost}`,
    finding?.confidence_score != null &&
      `confidence=${Number(finding.confidence_score).toFixed(2)}`,
  ]
    .filter(Boolean)
    .join(', ')

  const line = `- ${tableValue(findingTitle(finding))}${
    basis ? ` (${tableValue(basis)})` : ''
  } - ${conciseValue(finding?.reason || 'no reason provided')}`

  return finding?.fix_direction
    ? `${line} Direction: ${conciseValue(finding.fix_direction)}`
    : line
}

const appendFindings = (lines, heading, findings = []) => {
  lines.push('', `${heading}:`)
  if (!findings.length) {
    lines.push('- none')

    return
  }

  for (const finding of findings.slice(0, 5)) {
    lines.push(formatFindingLine(finding))
  }

  if (findings.length > 5) {
    lines.push(`- and ${findings.length - 5} more`)
  }
}

const appendReviewAdjudication = (lines, reviewAdjudication) => {
  if (!reviewAdjudication) {
    return
  }

  lines.push(
    '',
    'Review adjudication:',
    '',
    '| Field | Value |',
    '| --- | --- |',
    `| Decision | \`${tableValue(reviewAdjudication.decision)}\` |`,
    `| Confidence | ${tableValue(reviewAdjudication.confidenceScore)} |`,
    `| Cache | ${reviewAdjudication.cacheHit ? 'hit' : 'miss'} ${shortKey(reviewAdjudication.cacheKey)} |`,
    `| Reviewed comments | ${formatCommentIds(reviewAdjudication.reviewedCommentIds)} |`,
    `| Blocking findings | ${count(reviewAdjudication.blockingFindings)} |`,
    `| Non-blocking findings | ${count(reviewAdjudication.nonBlockingFindings)} |`,
    `| Summary | ${conciseValue(reviewAdjudication.summary)} |`
  )

  appendFindings(
    lines,
    'Blocking findings',
    reviewAdjudication.blockingFindings
  )

  appendFindings(
    lines,
    'Non-blocking findings',
    reviewAdjudication.nonBlockingFindings
  )
}

export const actionForDecision = (state, { approve, execute } = {}) => {
  if (state === 'NEEDS_FIX') {
    return execute ? 'dispatch fixer' : 'none'
  }
  if (state === 'REVOKE') {
    return 'request author rework'
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
  if (state === 'REVOKE') {
    return 'Review adjudication found blockers that require PR-author or operator rework; the fixer loop is intentionally not dispatched.'
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
  reviewAdjudication,
}) =>
  [
    pr,
    headSha || 'unknown-head',
    state,
    detail,
    action,
    approve ? 'approve' : 'no-approve',
    execute ? 'execute' : 'no-execute',
    reviewAdjudication?.cacheKey || 'no-adjudication',
    reviewAdjudication
      ? `${count(reviewAdjudication.blockingFindings)}-${count(reviewAdjudication.nonBlockingFindings)}`
      : 'no-findings',
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
  reviewAdjudication,
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

  appendReviewAdjudication(lines, reviewAdjudication)

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

// Linear thread policy:
// - NEEDS_FIX + dispatch fixer opens a fresh fix-cycle thread.
// - Kimi/progress replies can attach to that root while the fixer runs.
// - Post-fix decisions only attach after the worker records the pushed head.
// This keeps a new NEEDS_FIX cycle top-level and prevents stale-thread replies.
const FIX_CYCLE_CONTINUATION_STATES = new Set([
  'WAITING',
  'RETRYING',
  'GOOD_SHAPE',
])

const opensFixCycleThread = ({ state, action } = {}) =>
  state === 'NEEDS_FIX' && action === 'dispatch fixer'

const continuesFixCycleThread = ({ state } = {}) =>
  FIX_CYCLE_CONTINUATION_STATES.has(state)

const isFixCycleThread = (thread) =>
  Boolean(thread?.isFixCycle && thread.rootCommentId)

// `progressHeadSha` is written only after a fixer push is observed. Without this
// gate, unrelated WAITING/GOOD_SHAPE decisions could attach to an old fix thread.
const matchesProgressHead = (thread, { headSha } = {}) =>
  Boolean(thread.progressHeadSha) &&
  (!headSha || headSha === thread.progressHeadSha)

const canReplyToFixCycle = (thread, decision) =>
  isFixCycleThread(thread) &&
  matchesProgressHead(thread, decision) &&
  continuesFixCycleThread(decision)

export const shouldPostDecision = (store, pr, key) => {
  const entry = decisionEntry(store, pr)

  return entry.key !== key || !entry.commentId
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

export const shouldPostRevokeGithubDecision = (store, pr, key) => {
  const entry = decisionEntry(store, pr)

  return entry.revokeGithubKey !== key || !entry.revokeGithubCommentId
}

export const commentReplyTarget = (commentId) =>
  commentId
    ? { mode: 'reply', parentId: commentId }
    : { mode: 'top_level', parentId: null }

// Used by decision comments. Only post-fix continuation states should reply
// under the fix-cycle root; a new NEEDS_FIX decision always starts top-level.
export const decisionThreadTarget = (store, pr, decision = {}) => {
  const thread = decisionEntry(store, pr).activeThread
  if (!canReplyToFixCycle(thread, decision)) {
    return { mode: 'top_level', parentId: null }
  }

  return commentReplyTarget(thread.rootCommentId)
}

// Used by the fixer/progress paths while they are still operating on the head
// that originally triggered the fixer.
export const fixCycleThreadParentId = (store, pr, { headSha } = {}) => {
  const thread = decisionEntry(store, pr).activeThread
  if (!isFixCycleThread(thread)) {
    return null
  }
  if (headSha && thread.openedAtHeadSha !== headSha) {
    return null
  }

  return thread.rootCommentId
}

export const fixCycleThreadTarget = (store, pr, { headSha } = {}) => {
  const parentId = fixCycleThreadParentId(store, pr, { headSha })

  return commentReplyTarget(parentId)
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
  const previous = decisionEntry(store, pr)

  // NEEDS_FIX is the only decision that can open or replace the active thread.
  // If it does not dispatch a fixer, clear the prior thread instead of reusing it.
  // REVOKE is also terminal for a fixer cycle: future decisions must not reply
  // under an old fix root after the daemon has asked the PR author to rework.
  const activeThread =
    state === 'NEEDS_FIX'
      ? opensFixCycleThread({ state, action }) && commentId
        ? {
            isFixCycle: true,
            rootCommentId: commentId,
            openedAtHeadSha: headSha ?? null,
          }
        : null
      : state === 'REVOKE'
        ? null
        : previous.activeThread

  const next = {
    ...store,
    [String(pr)]: {
      ...previous,
      key,
      ...(commentId !== undefined && { commentId: commentId ?? null }),
      ...(state !== undefined && { state }),
      ...(headSha !== undefined && { headSha }),
      ...(action !== undefined && { action }),
      ...(activeThread !== undefined && { activeThread }),
    },
  }

  return writeDecisionStore(next, file)
}

export const markRevokeGithubDecisionPosted = (
  store,
  pr,
  key,
  file,
  { commentId } = {}
) => {
  const previous = decisionEntry(store, pr)

  const next = {
    ...store,
    [String(pr)]: {
      ...previous,
      revokeGithubKey: key,
      revokeGithubCommentId: commentId ?? null,
    },
  }

  return writeDecisionStore(next, file)
}

// Called after the worker sees the fixer pushed a new head. From that point,
// WAITING/RETRYING/GOOD_SHAPE decisions for that head can continue the thread.
export const markFixCycleProgress = (store, pr, file, { headSha } = {}) => {
  const previous = decisionEntry(store, pr)
  if (!isFixCycleThread(previous.activeThread)) {
    return store
  }

  const next = {
    ...store,
    [String(pr)]: {
      ...previous,
      activeThread: {
        ...previous.activeThread,
        progressHeadSha: headSha ?? null,
      },
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

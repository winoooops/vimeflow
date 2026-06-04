import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const STATE_DIR = join(SCRIPT_DIR, '.state', 'review-adjudication')
const SCHEMA_FILE = join(SCRIPT_DIR, 'review-adjudication.schema.json')
const DEFAULT_TIMEOUT_SECONDS = 300
const MAX_DIFF_CHARS = 80000
const MAX_REVIEW_CHARS = 60000

const hashText = (value) =>
  createHash('sha256').update(String(value)).digest('hex')

const truncate = (text, maxChars) => {
  const value = String(text || '')
  if (value.length <= maxChars) {
    return { text: value, truncated: false }
  }

  return {
    text: value.slice(0, maxChars),
    truncated: true,
  }
}

const cacheFile = (pr) => join(STATE_DIR, `pr-${pr}.json`)

const atomicWriteJson = (file, value) => {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  renameSync(tmp, file)
}

export const trustedClaudeReviewComments = (comments = []) =>
  comments.filter(
    (comment) =>
      comment.user?.login === 'github-actions[bot]' &&
      comment.user?.type === 'Bot' &&
      comment.performed_via_github_app?.slug === 'github-actions' &&
      typeof comment.body === 'string' &&
      comment.body.startsWith('## Claude Code Review')
  )

export const latestTrustedClaudeReview = (comments = []) =>
  trustedClaudeReviewComments(comments).at(-1) || null

export const adjudicationCacheKey = ({
  pr,
  headSha,
  reviewComments = [],
  diffText = '',
}) =>
  hashText(
    JSON.stringify({
      pr,
      headSha,
      reviews: reviewComments.map((comment) => ({
        id: comment.id,
        updatedAt: comment.updated_at || comment.updatedAt || '',
        bodyHash: hashText(comment.body || ''),
      })),
      diffHash: hashText(diffText),
    })
  )

export const normalizeAdjudication = (value) => {
  if (!value || typeof value !== 'object') {
    throw new Error('review adjudicator returned non-object JSON')
  }
  if (!['GOOD_SHAPE', 'NEEDS_FIX', 'WAITING'].includes(value.decision)) {
    throw new Error(
      `review adjudicator returned invalid decision '${value.decision}'`
    )
  }

  const blocking = Array.isArray(value.blocking_findings)
    ? value.blocking_findings
    : []

  const nonBlocking = Array.isArray(value.non_blocking_findings)
    ? value.non_blocking_findings
    : []

  const decision =
    value.decision === 'GOOD_SHAPE' && blocking.length
      ? 'NEEDS_FIX'
      : value.decision

  return {
    decision,
    summary: String(value.summary || ''),
    confidence_score: Number(value.confidence_score || 0),
    blocking_findings: blocking,
    non_blocking_findings: nonBlocking,
  }
}

export const summarizeBlockingFindings = (findings = []) =>
  findings
    .slice(0, 3)
    .map((finding) => `${finding.severity}: ${finding.title}`)
    .join('; ')

export const buildAdjudicationPrompt = ({
  owner,
  name,
  pr,
  headSha,
  reviewComments = [],
  diffText = '',
}) => {
  const diff = truncate(diffText, MAX_DIFF_CHARS)

  const reviews = truncate(
    reviewComments
      .map(
        (comment) =>
          `--- review comment ${comment.id || 'unknown'} (${comment.updated_at || comment.updatedAt || 'no timestamp'}) ---\n${comment.body}`
      )
      .join('\n\n'),
    MAX_REVIEW_CHARS
  )

  return `You are the Vimeflow QA runner review adjudicator.

Goal: decide whether PR #${pr} in ${owner}/${name} is actually GOOD_SHAPE or still NEEDS_FIX based on reviewer comments and the diff.

Repository policy:
- Apply agents/code-reviewer.md and rules/common/idea-framework.md.
- Only treat a finding as blocking if confidence is > 0.80 and it has plausible real-world impact or meaningful future-change cost.
- Apply the two implication checks explicitly: (1) how likely is the bug/problem to occur in real use while the system runs, and (2) what is the price/risk of fixing it now?
- Do not block on low-confidence, speculative, purely stylistic, or high-cost/low-impact findings.
- Use IDEA reasoning per blocking or non-blocking finding.
- Reviewer severity is evidence, not the final decision. A MEDIUM finding can be blocking when the reality and fix-cost checks justify fixing now; it can be non-blocking when the practical danger is weak or the fix cost is disproportionate.
- If reviewer output is missing, stale, contradictory, or cannot be evaluated, return WAITING.

Decision rules:
- Return NEEDS_FIX when one or more findings should be fixed before merge.
- Return GOOD_SHAPE only when no finding passes the project filter and the reviews/diff do not reveal a blocking issue.
- Return WAITING only for insufficient or stale review evidence, not as a way to avoid judgment.

PR head SHA observed by daemon: ${headSha}

Review comments:
${reviews.text || '(none)'}
${reviews.truncated ? '\n[review comments truncated by daemon]' : ''}

PR diff:
${diff.text || '(diff unavailable)'}
${diff.truncated ? '\n[diff truncated by daemon]' : ''}

Return only JSON matching the provided schema.`
}

const readCache = (pr, key) => {
  const file = cacheFile(pr)
  if (!existsSync(file)) {
    return null
  }
  try {
    const cached = JSON.parse(readFileSync(file, 'utf8'))

    return cached.key === key ? normalizeAdjudication(cached.result) : null
  } catch {
    return null
  }
}

const writeCache = (pr, key, result) => {
  atomicWriteJson(cacheFile(pr), {
    key,
    result,
    updatedAt: new Date().toISOString(),
  })
}

const runCodex = ({
  prompt,
  outputFile,
  spawnImpl = spawnSync,
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
  cwd = process.cwd(),
}) => {
  const args = [
    String(timeoutSeconds),
    'codex',
    'exec',
    '--sandbox',
    'read-only',
    '--output-schema',
    SCHEMA_FILE,
    '--output-last-message',
    outputFile,
    '-',
  ]

  return spawnImpl('timeout', args, {
    cwd,
    encoding: 'utf8',
    input: prompt,
    maxBuffer: 20 * 1024 * 1024,
  })
}

export const adjudicateReviews = (input, opts = {}) => {
  const key = adjudicationCacheKey(input)
  const cached = readCache(input.pr, key)
  if (cached) {
    return { ...cached, cacheHit: true }
  }

  mkdirSync(STATE_DIR, { recursive: true })
  const outputFile = join(STATE_DIR, `pr-${input.pr}-codex-result.json`)
  const prompt = buildAdjudicationPrompt(input)

  const result = runCodex({
    prompt,
    outputFile,
    spawnImpl: opts.spawnImpl,
    timeoutSeconds: opts.timeoutSeconds,
    cwd: opts.cwd,
  })

  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(
      `codex adjudicator exited ${result.status}: ${(result.stderr || result.stdout || '').trim().split('\n').at(-1) || 'no output'}`
    )
  }
  if (!existsSync(outputFile)) {
    throw new Error('codex adjudicator did not write structured output')
  }

  const parsed = normalizeAdjudication(
    JSON.parse(readFileSync(outputFile, 'utf8'))
  )
  writeCache(input.pr, key, parsed)

  return { ...parsed, cacheHit: false }
}

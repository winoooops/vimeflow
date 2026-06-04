/*
Typical adjudication flow:
1. watch.js waits until CI is green, Claude has posted, and review threads are clear.
2. It passes trusted Claude review comments plus the PR diff into adjudicateReviews().
3. adjudicateReviews() checks the cache keyed by PR head, review text, and diff.
4. On a cache miss, it renders review-adjudication.prompt.md and asks Codex for
   schema-constrained JSON.
5. GOOD_SHAPE is accepted only after normalized structured output has no blocking
   findings. NEEDS_FIX passes blocking findings into the fixer context. WAITING
   keeps the daemon in observation mode.
6. Malformed or missing structured output gets a bounded retry. Each failed attempt
   writes a JSON artifact under .state/review-adjudication/; after the last attempt
   the caller sees a transient error with that artifact path.
*/
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const STATE_DIR = join(SCRIPT_DIR, '.state', 'review-adjudication')
const SCHEMA_FILE = join(SCRIPT_DIR, 'review-adjudication.schema.json')
const MAX_DIFF_CHARS = 80000
const MAX_REVIEW_CHARS = 60000

export const CLAUDE_REVIEW_HEADING = '## Claude Code Review'

export const REVIEW_DECISIONS = Object.freeze({
  goodShape: 'GOOD_SHAPE',
  needsFix: 'NEEDS_FIX',
  waiting: 'WAITING',
})

const REVIEW_DECISION_SET = new Set(Object.values(REVIEW_DECISIONS))

// Step 1: accept only the real GitHub Actions Claude review comment as evidence.
export const trustedClaudeReviewComments = (comments = []) =>
  comments.filter(
    (comment) =>
      comment.user?.login === 'github-actions[bot]' &&
      comment.user?.type === 'Bot' &&
      comment.performed_via_github_app?.slug === 'github-actions' &&
      typeof comment.body === 'string' &&
      comment.body.startsWith(CLAUDE_REVIEW_HEADING)
  )

export const latestTrustedClaudeReview = (comments = []) =>
  trustedClaudeReviewComments(comments).at(-1) || null

// Step 2: own the full decision route: cache, prompt, Codex attempts, normalize.
export const adjudicateReviews = (input, opts = {}) => {
  const key = adjudicationCacheKey(input)
  const stateDir = opts.stateDir || STATE_DIR
  const cached = readCache(stateDir, input.pr, key)

  if (cached) {
    return { ...cached, cacheHit: true, cacheKey: key }
  }

  mkdirSync(stateDir, { recursive: true })

  const prompt = buildAdjudicationPrompt(input)
  const maxAttempts = opts.maxAttempts || 2
  let lastError = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { parsed } = runCodexAttempt({
        input,
        key,
        stateDir,
        prompt,
        opts,
        attempt,
      })

      writeCache(stateDir, input.pr, key, parsed)

      return { ...parsed, cacheHit: false, cacheKey: key }
    } catch (error) {
      const outputFile = attemptFile({
        stateDir,
        pr: input.pr,
        key,
        attempt,
        suffix: 'codex-result.json',
      })

      const artifactPath = writeFailureArtifact({
        stateDir,
        input,
        key,
        attempt,
        maxAttempts,
        kind: error.kind || 'unknown_attempt_failure',
        message: error.message,
        outputFile,
        result: error.result || null,
        rawOutput: error.rawOutput ?? readRawOutput(outputFile),
      })

      lastError = attemptError(error.message, artifactPath)
    }
  }

  throw lastError || new Error('codex adjudicator failed without error detail')
}

// Step 3: cache unchanged review evidence so routine polls do not re-run Codex.
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

const readCache = (stateDir, pr, key) => {
  const file = cacheFile(stateDir, pr)

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

const writeCache = (stateDir, pr, key, result) => {
  atomicWriteJson(cacheFile(stateDir, pr), {
    key,
    result,
    updatedAt: new Date().toISOString(),
  })
}

const cacheFile = (stateDir, pr) => join(stateDir, `pr-${pr}.json`)

// Step 4: render the prompt template with review bodies as untrusted evidence.
export const buildAdjudicationPrompt = ({
  owner,
  name,
  pr,
  headSha,
  reviewComments = [],
  diffText = '',
}) => {
  const diff = truncate(diffText, MAX_DIFF_CHARS)

  // GitHub Actions identity proves provenance of the review comment, not that the
  // comment body is safe to obey. Serialize bodies as evidence data and make the
  // prompt treat embedded instructions as hostile reviewer text.
  const reviews = truncate(
    reviewComments
      .map((comment) =>
        JSON.stringify(
          {
            id: comment.id || 'unknown',
            updatedAt: comment.updated_at || comment.updatedAt || '',
            body: comment.body || '',
          },
          null,
          2
        )
      )
      .join('\n\n'),
    MAX_REVIEW_CHARS
  )

  return renderTemplate(
    readFileSync(join(SCRIPT_DIR, 'review-adjudication.prompt.md'), 'utf8'),
    {
      PR_NUMBER: pr,
      REPO_FULL_NAME: `${owner}/${name}`,
      HEAD_SHA: headSha,
      GOOD_SHAPE: REVIEW_DECISIONS.goodShape,
      NEEDS_FIX: REVIEW_DECISIONS.needsFix,
      WAITING: REVIEW_DECISIONS.waiting,
      REVIEW_COMMENTS: reviews.text || '(none)',
      REVIEW_TRUNCATION_NOTE: reviews.truncated
        ? '[review comments truncated by daemon]'
        : '',
      PR_DIFF: diff.text || '(diff unavailable)',
      DIFF_TRUNCATION_NOTE: diff.truncated ? '[diff truncated by daemon]' : '',
    }
  )
}

const renderTemplate = (template, values) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(values[key] ?? ''))

// Step 5: run one Codex attempt and require parseable, schema-normalized output.
const runCodexAttempt = ({ input, key, stateDir, prompt, opts, attempt }) => {
  const outputFile = attemptFile({
    stateDir,
    pr: input.pr,
    key,
    attempt,
    suffix: 'codex-result.json',
  })

  rmSync(outputFile, { force: true })

  const result = runCodex({
    prompt,
    outputFile,
    spawnImpl: opts.spawnImpl,
    timeoutSeconds: opts.timeoutSeconds,
    cwd: opts.cwd,
  })

  if (result.error) {
    result.error.kind = 'codex_spawn_failed'

    throw result.error
  }

  if (result.status !== 0) {
    const error = new Error(
      `codex adjudicator exited ${result.status}: ${(result.stderr || result.stdout || '').trim().split('\n').at(-1) || 'no output'}`
    )
    error.kind = 'codex_exit_failed'
    error.result = result

    throw error
  }

  return {
    outputFile,
    result,
    ...parseCodexOutput(outputFile),
  }
}

const runCodex = ({
  prompt,
  outputFile,
  spawnImpl = spawnSync,
  timeoutSeconds = 300,
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

const parseCodexOutput = (outputFile) => {
  const rawOutput = readRawOutput(outputFile)

  if (rawOutput == null) {
    const error = new Error('codex adjudicator did not write structured output')
    error.kind = 'missing_structured_output'
    error.rawOutput = rawOutput

    throw error
  }

  try {
    return {
      rawOutput,
      parsed: normalizeAdjudication(JSON.parse(rawOutput)),
    }
  } catch (error) {
    error.kind =
      error instanceof SyntaxError
        ? 'parse_failed'
        : 'invalid_structured_output'
    error.rawOutput = rawOutput

    throw error
  }
}

export const normalizeAdjudication = (value) => {
  if (!value || typeof value !== 'object') {
    throw new Error('review adjudicator returned non-object JSON')
  }

  if (!REVIEW_DECISION_SET.has(value.decision)) {
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
    value.decision === REVIEW_DECISIONS.goodShape && blocking.length
      ? REVIEW_DECISIONS.needsFix
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

// Step 6: preserve failed attempt evidence for logs, Linear retry comments, and debugging.
const writeFailureArtifact = ({
  stateDir,
  input,
  key,
  attempt,
  maxAttempts,
  kind,
  message,
  outputFile,
  result,
  rawOutput,
}) => {
  const file = attemptFile({
    stateDir,
    pr: input.pr,
    key,
    attempt,
    suffix: 'codex-failure.json',
  })

  atomicWriteJson(file, {
    kind,
    message,
    pr: input.pr,
    headSha: input.headSha,
    key,
    attempt,
    maxAttempts,
    outputFile,
    status: result?.status ?? null,
    signal: result?.signal ?? null,
    error: result?.error?.message || null,
    stdout: truncate(result?.stdout || '', 20000).text,
    stderr: truncate(result?.stderr || '', 20000).text,
    rawStructuredOutput:
      rawOutput == null ? null : truncate(rawOutput, 20000).text,
    recordedAt: new Date().toISOString(),
  })

  return file
}

const attemptError = (message, artifactPath) => {
  const error = new Error(`${message} (artifact: ${artifactPath})`)
  error.artifactPath = artifactPath

  return error
}

const attemptFile = ({ stateDir, pr, key, attempt, suffix }) =>
  join(stateDir, `pr-${pr}-${key.slice(0, 12)}-attempt-${attempt}-${suffix}`)

const readRawOutput = (file) => {
  if (!existsSync(file)) {
    return null
  }

  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

const atomicWriteJson = (file, value) => {
  mkdirSync(dirname(file), { recursive: true })

  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  renameSync(tmp, file)
}

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

const hashText = (value) =>
  createHash('sha256').update(String(value)).digest('hex')

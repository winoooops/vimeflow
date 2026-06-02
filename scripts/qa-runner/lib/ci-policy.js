export const REVIEW_CHECKS = new Set([
  'Claude Code Review',
  'Codex Code Review',
  'Post Review Comment',
])

export const REVIEW_RERUN_CHECKS = REVIEW_CHECKS

const FAILED_BUCKETS = new Set(['fail', 'cancel'])

export const runIdFromCheck = (check) =>
  String(check?.link || '').match(/\/actions\/runs\/(\d+)/)?.[1] || null

export const isFailedCheck = (check) => FAILED_BUCKETS.has(check.bucket)

export const checkIdentity = (check) =>
  [
    check.name || 'unknown-check',
    check.workflow || 'unknown-workflow',
    runIdFromCheck(check) || check.link || 'unknown-run',
  ].join('|')

export const stableCheckIdentity = (check) =>
  [check.name || 'unknown-check', check.workflow || 'unknown-workflow'].join(
    '|'
  )

export const checkLabel = (check) =>
  [check.name || 'unknown check', check.workflow && `(${check.workflow})`]
    .filter(Boolean)
    .join(' ')

export const summarizeChecks = (checks) =>
  checks.map((check) => ({
    name: check.name || 'unknown check',
    workflow: check.workflow || null,
    bucket: check.bucket || 'unknown',
    link: check.link || null,
    runId: runIdFromCheck(check),
  }))

export const classifyChecks = (
  checks,
  { reviewChecks = REVIEW_CHECKS, reviewRerunChecks = REVIEW_RERUN_CHECKS } = {}
) => {
  const review = checks.filter((check) => reviewChecks.has(check.name))
  const nonReview = checks.filter((check) => !reviewChecks.has(check.name))
  const deterministicFailures = nonReview.filter(isFailedCheck)

  const reviewRerunFailures = review.filter(
    (check) => isFailedCheck(check) && reviewRerunChecks.has(check.name)
  )

  const reviewNonRerunFailures = review.filter(
    (check) => isFailedCheck(check) && !reviewRerunChecks.has(check.name)
  )

  const ci = deterministicFailures.length
    ? 'fail'
    : nonReview.some((check) => check.bucket === 'pending')
      ? 'pending'
      : 'green'

  return {
    ci,
    review,
    nonReview,
    deterministicFailures,
    reviewRerunFailures,
    reviewNonRerunFailures,
  }
}

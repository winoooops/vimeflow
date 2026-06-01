// GitHub webhook security + event parsing — the daemon's trust boundary.
import { createHmac, timingSafeEqual } from 'node:crypto'

// Constant-time HMAC-SHA256 check of the RAW body against X-Hub-Signature-256.
// Fail CLOSED: empty secret, missing/malformed header, or length mismatch ⇒ false.
export const verifySignature = (rawBody, signatureHeader, secret) => {
  if (!secret || !signatureHeader) {
    return false
  }
  const digest = createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(`sha256=${digest}`)
  const b = Buffer.from(String(signatureHeader))
  if (a.length !== b.length) {
    return false
  }

  return timingSafeEqual(a, b)
}

const prWork = (pr, reason) => (Number.isInteger(pr) ? { pr, reason } : null)

// Map a GitHub webhook event to the PR work it implies, or null to ignore. The
// comment command is the only user-injectable trigger, so it is gated on a
// configured trusted sender (the signature alone proves GitHub, not WHO).
export const parseEvent = (eventType, payload, opts = {}) => {
  const { trustedSenders = [], triggerPhrase = '/upsource-review' } = opts
  const p = payload || {}

  if (eventType === 'issue_comment') {
    const isCreateEdit = p.action === 'created' || p.action === 'edited'
    const onPr = Boolean(p.issue?.pull_request)
    const hasCmd = (p.comment?.body || '').includes(triggerPhrase)
    // Trust the ACTOR (sender), not the comment author: on an `edited` event the
    // editor differs from the author, so author-gating lets an untrusted editor inject the command.
    const trusted = trustedSenders.includes(p.sender?.login)
    if (isCreateEdit && onPr && hasCmd && trusted) {
      return prWork(p.issue?.number, `comment:${triggerPhrase}`)
    }

    return null
  }

  if (eventType === 'pull_request') {
    // `closed` (merge OR close) reaches runOne's terminal cleanup; `unlabeled` /
    // `converted_to_draft` reach its eligibility gate to FORGET an opted-out PR.
    // Both matter because the fallback poll only lists OPEN, labeled, non-draft PRs,
    // so without these a tracked PR's daemon-state would go stale after the change.
    const wanted = [
      'opened',
      'reopened',
      'synchronize',
      'ready_for_review',
      'labeled',
      'unlabeled',
      'converted_to_draft',
      'closed',
    ]

    return wanted.includes(p.action)
      ? prWork(p.pull_request?.number, `pr:${p.action}`)
      : null
  }

  if (eventType === 'pull_request_review') {
    return p.action === 'submitted'
      ? prWork(p.pull_request?.number, 'review')
      : null
  }

  if (eventType === 'pull_request_review_comment') {
    return p.action === 'created'
      ? prWork(p.pull_request?.number, 'review-comment')
      : null
  }

  if (eventType === 'pull_request_review_thread') {
    return ['resolved', 'unresolved'].includes(p.action)
      ? prWork(p.pull_request?.number, `thread:${p.action}`)
      : null
  }

  if (eventType === 'check_run' || eventType === 'workflow_run') {
    if (p.action !== 'completed') {
      return null
    }
    const node = p.check_run || p.workflow_run || {}

    return prWork((node.pull_requests || [])[0]?.number, `ci:${eventType}`)
  }

  return null
}

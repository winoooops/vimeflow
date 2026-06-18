// Shared PR helpers for the QA runner (used by watch.js + run.js).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const QA_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const STATE_DIR = join(QA_DIR, '.state')

// The Linear issue this PR is meant to update. Explicit link words are strongest,
// then the branch name, then generic body mentions. This keeps smoke-test logs or
// historical issue references in the PR body from stealing the status thread.
export const linkedVim = (...texts) => {
  const [body = '', ...rest] = texts
  const branchText = rest.filter(Boolean).join('\n')
  const b = texts.filter(Boolean).join('\n')

  const explicit = b.match(
    /\b(?:closes|fixes|resolves|refs|references)\s+(VIM-\d+)\b/i
  )
  const branch = branchText.match(/\bVIM-\d+\b/i)

  return (explicit?.[1] || branch?.[0] || genericBodyIssue(body))?.toUpperCase()
}

const genericBodyIssue = (body = '') => {
  let inFollowUps = false
  const eligibleLines = []

  for (const line of String(body || '').split('\n')) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)
    if (heading) {
      inFollowUps = /\bfollow[- ]?ups?\b/i.test(heading[1])
      if (inFollowUps) {
        continue
      }
    }

    if (!inFollowUps) {
      eligibleLines.push(line)
    }
  }

  return eligibleLines.join('\n').match(/\bVIM-\d+\b/i)?.[0] || null
}

export const linkedIssueStorePath = (pr) =>
  join(STATE_DIR, `linear-pr-${pr}.json`)

export const readLinkedIssueCacheRecord = (
  pr,
  file = linkedIssueStorePath(pr)
) => {
  if (!existsSync(file)) {
    return null
  }
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    const identifier = data.identifier || null

    return identifier
      ? {
          identifier,
          url: data.url || null,
        }
      : null
  } catch {
    return null
  }
}

export const readLinkedIssueCache = (pr, file = linkedIssueStorePath(pr)) =>
  readLinkedIssueCacheRecord(pr, file)?.identifier || null

export const writeLinkedIssueCache = (
  pr,
  issue,
  file = linkedIssueStorePath(pr)
) => {
  const identifier = issue?.identifier || issue
  if (!identifier) {
    return null
  }

  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        identifier,
        url: issue?.url || null,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    )}\n`
  )

  return identifier
}

export const linkedVimForPr = ({ body, branch, pr, cacheFile }) =>
  linkedVim(body, branch) ||
  (pr ? readLinkedIssueCache(pr, cacheFile || linkedIssueStorePath(pr)) : null)

// Append `Refs VIM-N` to the PR body so Linear's GitHub app links the auto-created
// issue. Re-reads the live body first so a concurrent description edit isn't clobbered.
export const backfillPrRef = ({ owner, name, pr, identifier }, { gh }) => {
  if (!identifier) {
    return { changed: false }
  }

  const path = `repos/${owner}/${name}/pulls/${pr}`
  const body = JSON.parse(gh(['api', path])).body || ''
  if (new RegExp(`\\b${identifier}\\b`, 'i').test(body)) {
    return { changed: false }
  }

  const next = body ? `${body}\n\nRefs ${identifier}` : `Refs ${identifier}`
  gh(['api', '--method', 'PATCH', path, '-f', `body=${next}`])

  return { changed: true, body: next }
}

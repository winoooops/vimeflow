// Shared PR helpers for the QA runner (used by watch.js + run.js).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const QA_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const STATE_DIR = join(QA_DIR, '.state')

// The Linear issue this PR closes — prefer the `Closes/Fixes/Resolves VIM-N` magic
// word, fall back to the first VIM-N mention. Deterministic so status never posts
// to a related/historical ticket mentioned earlier in the body.
export const linkedVim = (...texts) => {
  const b = texts.filter(Boolean).join('\n')
  const closing = b.match(/\b(?:closes|fixes|resolves)\s+(VIM-\d+)\b/i)

  return (closing?.[1] || b.match(/\bVIM-\d+\b/i)?.[0])?.toUpperCase()
}

export const linkedIssueStorePath = (pr) =>
  join(STATE_DIR, `linear-pr-${pr}.json`)

export const readLinkedIssueCache = (pr, file = linkedIssueStorePath(pr)) => {
  if (!existsSync(file)) {
    return null
  }
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))

    return data.identifier || null
  } catch {
    return null
  }
}

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

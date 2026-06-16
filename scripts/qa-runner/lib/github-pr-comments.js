import { execFileSync } from 'node:child_process'

const runGh = (args, env) =>
  execFileSync('gh', args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...(env ? { env } : {}),
  })

const firstLine = (value, fallback = 'gh failed') =>
  String(value || fallback)
    .trim()
    .split('\n')[0] || fallback

export const linearIssueGithubCommentMarker = (identifier) =>
  `<!-- qa-runner-linear-issue:${String(identifier || '').toUpperCase()} -->`

export const formatLinearIssueGithubComment = ({ identifier, url }) => {
  const id = String(identifier || '').toUpperCase()
  const issue = url ? `[${id}](${url})` : `\`${id}\``

  return [
    linearIssueGithubCommentMarker(id),
    `Linked Linear issue: ${issue}`,
    '',
    'The QA runner created this issue for the unlinked PR and will post future QA updates there.',
  ].join('\n')
}

export const postLinearIssueGithubComment = (
  { owner, name, pr, identifier, url, env },
  { gh = runGh } = {}
) => {
  if (!identifier) {
    return {
      ok: false,
      skipped: false,
      commentId: null,
      reason: 'missing Linear issue identifier',
    }
  }

  const path = `repos/${owner}/${name}/issues/${pr}/comments`
  const marker = linearIssueGithubCommentMarker(identifier)
  let existing = ''

  try {
    existing = gh(['api', path, '--paginate', '--jq', '.[].body'], env)
  } catch (e) {
    return {
      ok: false,
      skipped: false,
      commentId: null,
      reason: firstLine(e.stderr || e.message),
    }
  }

  if (String(existing || '').includes(marker)) {
    return { ok: true, skipped: true, commentId: null, reason: null }
  }

  try {
    const commentId =
      gh(
        [
          'api',
          path,
          '-f',
          `body=${formatLinearIssueGithubComment({ identifier, url })}`,
          '--jq',
          '.id',
        ],
        env
      ).trim() || null

    return { ok: true, skipped: false, commentId, reason: null }
  } catch (e) {
    return {
      ok: false,
      skipped: false,
      commentId: null,
      reason: firstLine(e.stderr || e.message),
    }
  }
}

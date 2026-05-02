interface BuildGitDiffArgsOptions {
  safePath: string
  staged: boolean
  baseBranch?: string | null
}

// Restrict to characters valid in a single git refname segment (letters,
// digits, plus the separators `_`, `/`, `-`, and `.` as a single character).
// Specifically blocks the range operators `..` and `...` — `git diff
// main..HEAD` produces a two-dot range diff (commits reachable from HEAD
// but not main) whose hunk list can differ from a plain `git diff main`,
// silently misrepresenting which hunks the UI is showing.
//
// First character is intentionally narrower than the rest: a leading `/`
// is invalid per `git check-ref-format` (refs can't begin with a slash).
// Slash remains in the trailing class so `feature/cleanup` and
// `refs/heads/main` still pass as internal-separator paths.
const SAFE_BASE_BRANCH_REGEX = /^[a-zA-Z0-9_][a-zA-Z0-9_/.-]*$/

const isSafeBaseBranch = (baseBranch: string): boolean =>
  baseBranch.length > 0 &&
  !baseBranch.startsWith('-') &&
  !baseBranch.includes('\0') &&
  !baseBranch.includes('..') &&
  SAFE_BASE_BRANCH_REGEX.test(baseBranch)

export const buildGitDiffArgs = ({
  safePath,
  staged,
  baseBranch = null,
}: BuildGitDiffArgsOptions): string[] => {
  if (staged) {
    return ['--cached', '--', safePath]
  }

  const trimmedBaseBranch = baseBranch?.trim()

  if (trimmedBaseBranch && isSafeBaseBranch(trimmedBaseBranch)) {
    return [trimmedBaseBranch, '--', safePath]
  }

  return ['--', safePath]
}

export const extractHunkPatch = (
  diffText: string,
  hunkIndex: unknown
): string | null => {
  if (
    typeof hunkIndex !== 'number' ||
    !Number.isInteger(hunkIndex) ||
    hunkIndex < 0 ||
    diffText.length === 0
  ) {
    return null
  }

  const hunks = diffText.split(/(?=^@@\s)/m)
  const header = hunks.shift() ?? ''

  if (hunkIndex >= hunks.length) {
    return null
  }

  return header + hunks[hunkIndex]
}

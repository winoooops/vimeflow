interface BuildGitDiffArgsOptions {
  safePath: string
  staged: boolean
  baseBranch?: string | null
}

// Restrict to characters valid in a single git refname segment (letters,
// digits, plus the separators `_`, `/`, `-`, and `.` as a single character).
// The first character class is intentionally narrower than the rest:
// - Excludes `-` (would be parsed as a git option flag)
// - Excludes `/` (a leading slash is invalid per `git check-ref-format`)
// - Excludes all non-ASCII / control characters including NUL (no
//   C-string termination injection)
//
// The `!includes('..')` check below is NOT redundant with the regex:
// the regex's trailing class permits a single `.`, but two-dot
// ranges (`main..HEAD`) and three-dot ranges (`main...HEAD`) are
// valid character sequences inside `[a-zA-Z0-9_/.-]*` and would be
// admitted by the regex alone. We block them explicitly because they
// change `git diff` semantics from "branch comparison" to "two-dot
// range" / "symmetric difference", silently misrepresenting which
// commits the displayed hunks come from.
const SAFE_BASE_BRANCH_REGEX = /^[a-zA-Z0-9_][a-zA-Z0-9_/.-]*$/

const isSafeBaseBranch = (baseBranch: string): boolean =>
  baseBranch.length > 0 &&
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

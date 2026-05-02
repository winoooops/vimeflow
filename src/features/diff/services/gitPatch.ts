interface BuildGitDiffArgsOptions {
  safePath: string
  staged: boolean
  baseBranch?: string | null
}

const isSafeBaseBranch = (baseBranch: string): boolean =>
  baseBranch.length > 0 &&
  !baseBranch.startsWith('-') &&
  !baseBranch.includes('\0')

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

// cspell:ignore worktree worktrees
export type AgentCwdSource = 'osc7' | 'prop' | 'text-hint' | 'user-input'

export const toComparablePath = (path: string): string =>
  path.replace(/\\/g, '/')

const trimTrailingSlashes = (path: string): string =>
  path === '/' ? path : path.replace(/\/+$/g, '')

export const isDescendantPath = (
  path: string,
  possibleParent: string
): boolean => {
  const normalizedPath = trimTrailingSlashes(toComparablePath(path))
  const normalizedParent = trimTrailingSlashes(toComparablePath(possibleParent))

  if (!normalizedParent) {
    return false
  }

  if (normalizedParent === '/') {
    return normalizedPath !== '/' && normalizedPath.startsWith('/')
  }

  return normalizedPath.startsWith(`${normalizedParent}/`)
}

const getWorktreeParentPath = (path: string): string | null => {
  const normalizedPath = trimTrailingSlashes(toComparablePath(path))
  const lastSeparatorIndex = normalizedPath.lastIndexOf('/')
  if (lastSeparatorIndex === -1) {
    return null
  }

  const parentPath = normalizedPath.slice(0, lastSeparatorIndex)
  const parentName = parentPath.slice(parentPath.lastIndexOf('/') + 1)

  const grandparentPath = parentPath.slice(0, parentPath.lastIndexOf('/'))

  const grandparentName = grandparentPath.slice(
    grandparentPath.lastIndexOf('/') + 1
  )

  return parentName === 'worktrees' && grandparentName === '.claude'
    ? parentPath
    : null
}

const isWorktreeSiblingPath = (
  path: string,
  possibleSibling: string
): boolean => {
  const normalizedPath = trimTrailingSlashes(toComparablePath(path))

  const normalizedSibling = trimTrailingSlashes(
    toComparablePath(possibleSibling)
  )

  const parentPath = getWorktreeParentPath(normalizedPath)

  return (
    normalizedPath !== normalizedSibling &&
    parentPath !== null &&
    parentPath === getWorktreeParentPath(normalizedSibling)
  )
}

export const shouldIgnoreStaleOsc7Cwd = (
  currentCwd: string,
  nextCwd: string,
  currentSource: AgentCwdSource
): boolean =>
  currentSource === 'text-hint' &&
  (isDescendantPath(currentCwd, nextCwd) ||
    isWorktreeSiblingPath(currentCwd, nextCwd))

export const stripCarriageReturnOverwrites = (output: string): string =>
  output
    .split('\n')
    .map((line, index, lines) => {
      if (index === lines.length - 1) {
        return line
      }

      const lineWithoutTerminator = line.endsWith('\r')
        ? line.slice(0, -1)
        : line

      const overwriteIndex = lineWithoutTerminator.lastIndexOf('\r')

      const visibleLine =
        overwriteIndex === -1
          ? lineWithoutTerminator
          : lineWithoutTerminator.slice(overwriteIndex + 1)

      return `${visibleLine}\n`
    })
    .join('')

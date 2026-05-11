/** Derive a human-readable tab name from a cwd. Falls back to a stable
 * index-based name when the cwd is empty or the home alias `~`. */
export const tabName = (cwd: string, index: number): string => {
  if (cwd === '~') {
    return `session ${index + 1}`
  }
  const parts = cwd.split('/').filter(Boolean)

  return parts[parts.length - 1] || `session ${index + 1}`
}

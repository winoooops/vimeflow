// Separator-agnostic path splitting so native POSIX, Windows-drive, and UNC
// paths all segment. Empty segments (leading/trailing/doubled separators) drop.
export const pathParts = (path: string): string[] =>
  path.split(/[/\\]+/).filter((segment) => segment.length > 0)

const BARE_ROOT = new Set(['~', '/'])

// Auto-tracked session name. The folder basename, falling back to 'session' for
// an empty basename or a bare root/home token (so names are never blank). The
// dialog prefill and createSession both call this, so they always agree.
export const deriveSessionName = (cwd: string): string => {
  const parts = pathParts(cwd)
  const last = parts[parts.length - 1]
  if (last === undefined) return 'session'
  // A bare home/root or a Windows drive root (e.g. 'C:') is not a folder name.
  if (BARE_ROOT.has(last) || /^[A-Za-z]:$/.test(last)) return 'session'
  return last
}

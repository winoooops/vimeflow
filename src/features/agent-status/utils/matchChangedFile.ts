import type { ChangedFile } from '../../diff/types'

// Tool paths are absolute (Claude Code) or relative; git status paths are
// repo-toplevel-relative. Strip the cwd prefix and match exactly — no suffix or
// basename guessing, which can resolve to the wrong file. Only an unstaged
// (working-tree) row represents a live edit's diff; a staged-only row is a
// pre-existing change, not the running tool's work, so it yields no match. A cwd
// below the repo root won't line up and also yields no match (the card then
// shows no diff and isn't clickable) rather than a wrong one.
export const matchChangedFile = (
  files: ChangedFile[],
  body: string,
  cwd: string
): ChangedFile | null => {
  const candidate = body.replace(/\\/g, '/')
  const root = cwd.replace(/\\/g, '/')

  const relative =
    root.length > 0 && candidate.startsWith(`${root}/`)
      ? candidate.slice(root.length + 1)
      : candidate

  return files.find((file) => file.path === relative && !file.staged) ?? null
}

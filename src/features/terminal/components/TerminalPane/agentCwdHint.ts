// cspell:ignore WORKTREE
import { parseOsc7Cwd } from './osc7'

const ANSI_ESCAPE_PATTERN =
  /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][\s\S]*?(?:\x07|\x1b\\))/g

const CLAUDE_WORKTREE_PATTERN =
  /(?:^|[\r\n])(?:[^\S\r\n]*(?:[^\w\s(/\\:]+[^\S\r\n]*)?)Entering worktree\(([^)\r\n]+)\)/g

export const parseAgentCwdHint = (data: string): string | null => {
  const normalizedData = data.replace(ANSI_ESCAPE_PATTERN, '')
  let latestPath: string | null = null

  for (const match of normalizedData.matchAll(CLAUDE_WORKTREE_PATTERN)) {
    const rawPath = match[1].trim()
    if (!rawPath) {
      continue
    }

    const path = parseOsc7Cwd(rawPath)
    if (path) {
      latestPath = path
    }
  }

  return latestPath
}

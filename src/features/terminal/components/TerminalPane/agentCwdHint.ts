// cspell:ignore WORKTREE
import { parseOsc7Cwd } from './osc7'

const ANSI_ESCAPE_PATTERN =
  /\x1b(?:\][\s\S]*?(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/g

const CLAUDE_WORKTREE_PATTERN =
  /(?:^|[\r\n])(?:[^\S\r\n]*(?:[^\w\s(/\\:]+[^\S\r\n]*)?)Entering worktree\(([^\r\n]+)\)[ \t]*(?=$|[\r\n])/g

const AGENT_CD_PATTERN =
  /(?:^|[\r\n])(?:[^\S\r\n]*(?:!\s*|[^\w\s(/\\:!$]+[^\S\r\n]*Ran\s+))cd(?:[ \t]+([^\r\n]+?))?[ \t]*(?=$|[\r\n])/g

const CLAUDE_CWD_RESET_PATTERN =
  /(?:^|[\r\n])(?:[^\S\r\n]*(?:[^\w\s(/\\:]+[^\S\r\n]*)?)Shell cwd was reset to ([^\r\n]+)/g

type CwdEvent =
  | { index: number; kind: 'absolute'; path: string }
  | { index: number; kind: 'cd'; target: string }

const readQuotedTarget = (
  source: string,
  quote: '"' | "'"
): { target: string; rest: string } | null => {
  let target = ''

  for (let index = 1; index < source.length; index += 1) {
    const char = source[index]

    if (char === quote) {
      return { target, rest: source.slice(index + 1) }
    }

    if (quote === '"' && char === '\\') {
      const next = source[index + 1]
      if (next) {
        target = `${target}${next}`
        index += 1

        continue
      }
    }

    target = `${target}${char}`
  }

  return null
}

const readBareTarget = (
  source: string
): { target: string; rest: string } | null => {
  const match = /^((?:\\.|[^\s])+)(.*)$/.exec(source)
  if (!match) {
    return null
  }

  return {
    target: match[1].replace(/\\(.)/g, '$1'),
    rest: match[2],
  }
}

const parseCdTarget = (rawCommand: string | undefined): string | null => {
  const source = rawCommand?.trim()
  if (!source || source === '-' || source.startsWith('~')) {
    return null
  }

  const parsed =
    source.startsWith("'") || source.startsWith('"')
      ? readQuotedTarget(source, source[0] as '"' | "'")
      : readBareTarget(source)

  if (!parsed || parsed.rest.trim()) {
    const rest = parsed?.rest.trim()
    if (!rest || rest.startsWith('&&') || rest.startsWith(';')) {
      return parsed?.target ?? null
    }

    return null
  }

  return parsed.target
}

const normalizePosixPath = (path: string): string => {
  const parts: string[] = []

  for (const part of path.split('/')) {
    if (!part || part === '.') {
      continue
    }

    if (part === '..') {
      parts.pop()

      continue
    }

    parts.push(part)
  }

  return `/${parts.join('/')}`
}

const normalizePath = (path: string): string =>
  path.startsWith('/') ? normalizePosixPath(path) : path

const resolveCdPath = (target: string, currentCwd?: string): string | null => {
  const absoluteTarget = parseOsc7Cwd(target)
  if (absoluteTarget) {
    return normalizePath(absoluteTarget)
  }

  if (!currentCwd?.startsWith('/')) {
    return null
  }

  return normalizePosixPath(`${currentCwd}/${target}`)
}

export const parseAgentCwdHint = (
  data: string,
  currentCwd?: string
): string | null => {
  const normalizedData = data.replace(ANSI_ESCAPE_PATTERN, '')
  const events: CwdEvent[] = []

  for (const match of normalizedData.matchAll(CLAUDE_WORKTREE_PATTERN)) {
    const rawPath = match[1].trim()
    if (!rawPath) {
      continue
    }

    const path = parseOsc7Cwd(rawPath)
    if (path) {
      events.push({ index: match.index, kind: 'absolute', path })
    }
  }

  for (const match of normalizedData.matchAll(CLAUDE_CWD_RESET_PATTERN)) {
    const path = parseOsc7Cwd(match[1].trim())
    if (path) {
      events.push({ index: match.index, kind: 'absolute', path })
    }
  }

  for (const match of normalizedData.matchAll(AGENT_CD_PATTERN)) {
    const target = parseCdTarget(match[1])
    if (target) {
      events.push({ index: match.index, kind: 'cd', target })
    }
  }

  events.sort((first, second) => first.index - second.index)

  let nextCwd = currentCwd
  let latestPath: string | null = null

  for (const event of events) {
    const path =
      event.kind === 'absolute'
        ? normalizePath(event.path)
        : resolveCdPath(event.target, nextCwd)

    if (path) {
      nextCwd = path
      latestPath = path
    }
  }

  return latestPath
}

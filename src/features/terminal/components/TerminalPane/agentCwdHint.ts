// cspell:ignore WORKTREE
import { parseOsc7Cwd, WINDOWS_DRIVE_PATH } from './osc7'

const ANSI_ESCAPE_PATTERN =
  /\x1b(?:\][\s\S]*?(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/g

const CLAUDE_WORKTREE_PATTERN =
  /(?:^|[\r\n])(?:[^\S\r\n]*(?:[^\w\s(/\\:]+[^\S\r\n]*)?)Entering worktree\(([^\r\n]+)\)[ \t]*(?=$|[\r\n])/g

const AGENT_CD_PATTERN =
  /(?:^|[\r\n])(?:[^\S\r\n]*(?:!\s*|[^\w\s(/\\:!$]+[^\S\r\n]*Ran\s+))cd(?:[ \t]+([^\r\n]+?))?[ \t]*(?=$|[\r\n])/g

const CLAUDE_CWD_RESET_PATTERN =
  /(?:^|[\r\n])(?:[^\S\r\n]*(?:[^\w\s(/\\:]+[^\S\r\n]*)?)Shell cwd was reset to (\S+)/g

const CLAUDE_STARTUP_HOME_CWD_PATTERN =
  /(?:^|[\r\n])[^\S\r\n]*(~[\\/][^\r\n]+?)[ \t]*(?=$|[\r\n])/g

const CLAUDE_STARTUP_HEADER_PATTERN = /^Claude Code v\d/

const CLAUDE_STARTUP_CONTEXT_HEADER_PATTERN =
  /(?:^|[\r\n])Claude Code v\d[^\r\n]*/g

type CwdEvent =
  | { index: number; kind: 'path'; path: string }
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
      if (next === '\\') {
        target = `${target}\\`
        index += 1

        continue
      }

      if (next && !/[\\A-Za-z0-9._-]/.test(next)) {
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
    target: match[1].replace(/\\([^\\A-Za-z0-9._-])/g, '$1'),
    rest: match[2],
  }
}

const parseCdTarget = (rawCommand: string | undefined): string | null => {
  const source = rawCommand?.trim()
  if (!source || source === '-' || source === '~' || /^~[^\\/]/.test(source)) {
    return null
  }

  const parsed =
    source.startsWith("'") || source.startsWith('"')
      ? readQuotedTarget(source, source[0] as '"' | "'")
      : readBareTarget(source)

  if (!parsed) {
    return null
  }

  if (parsed.rest.trim()) {
    const rest = parsed.rest.trim()
    if (rest.startsWith('&&') || rest.startsWith(';')) {
      return parsed.target
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

const normalizeWindowsDrivePath = (path: string): string => {
  const separator = path.includes('\\') && !path.includes('/') ? '\\' : '/'
  const slashPath = path.replace(/\\/g, '/')
  const drive = slashPath.slice(0, 2)
  const parts: string[] = []

  for (const part of slashPath.slice(2).split('/')) {
    if (!part || part === '.') {
      continue
    }

    if (part === '..') {
      parts.pop()

      continue
    }

    parts.push(part)
  }

  const normalized = `${drive}/${parts.join('/')}`

  return separator === '\\' ? normalized.replace(/\//g, '\\') : normalized
}

const normalizePath = (path: string): string =>
  path.startsWith('/')
    ? normalizePosixPath(path)
    : WINDOWS_DRIVE_PATH.test(path)
      ? normalizeWindowsDrivePath(path)
      : path

const posixHomeFromCwd = (currentCwd: string): string | null => {
  const match = /^\/(?:home|Users)\/[^/]+/.exec(currentCwd)

  return match?.[0] ?? null
}

const windowsHomeFromCwd = (currentCwd: string): string | null => {
  const match = /^[A-Za-z]:[\\/]Users[\\/][^\\/]+/.exec(currentCwd)

  return match?.[0] ?? null
}

const resolveHomePath = (path: string, currentCwd?: string): string | null => {
  if (!currentCwd || (!path.startsWith('~/') && !path.startsWith('~\\'))) {
    return null
  }

  const currentHome = currentCwd.startsWith('/')
    ? posixHomeFromCwd(currentCwd)
    : WINDOWS_DRIVE_PATH.test(currentCwd)
      ? windowsHomeFromCwd(currentCwd)
      : null

  if (!currentHome) {
    return null
  }

  const suffix = path.slice(2)
  if (currentHome.startsWith('/')) {
    return `${currentHome}/${suffix.replace(/\\/g, '/')}`
  }

  const separator =
    currentHome.includes('\\') && !currentHome.includes('/') ? '\\' : '/'

  return `${currentHome}${separator}${suffix}`
}

const resolvePathHint = (path: string, currentCwd?: string): string | null => {
  const absolutePath = parseOsc7Cwd(path)
  if (absolutePath) {
    return normalizePath(absolutePath)
  }

  const homePath = resolveHomePath(path, currentCwd)
  if (homePath) {
    return normalizePath(homePath)
  }

  return null
}

const resolveCdPath = (target: string, currentCwd?: string): string | null => {
  const pathHint = resolvePathHint(target, currentCwd)
  if (pathHint) {
    return pathHint
  }

  if (currentCwd?.startsWith('/')) {
    return normalizePosixPath(`${currentCwd}/${target}`)
  }

  if (currentCwd && WINDOWS_DRIVE_PATH.test(currentCwd)) {
    const separator =
      currentCwd.includes('\\') && !currentCwd.includes('/') ? '\\' : '/'

    return normalizeWindowsDrivePath(`${currentCwd}${separator}${target}`)
  }

  return null
}

const nonEmptyLinesBefore = (data: string, index: number): string[] =>
  data
    .slice(0, index)
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter(Boolean)

const isSafeClaudeStartupLine = (line: string): boolean =>
  !line.startsWith('!') &&
  !line.startsWith('$') &&
  !line.includes('Entering worktree') &&
  !line.includes('Shell cwd was reset to') &&
  !line.includes('Ran cd ')

const isClaudeStartupHomeCwd = (data: string, index: number): boolean => {
  const lines = nonEmptyLinesBefore(data, index)
  let headerIndex = -1

  for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
    if (CLAUDE_STARTUP_HEADER_PATTERN.test(lines[lineIndex])) {
      headerIndex = lineIndex

      break
    }
  }

  if (headerIndex === -1) {
    return false
  }

  const startupLines = lines.slice(headerIndex + 1)

  return (
    startupLines.length <= 3 &&
    startupLines.every((line) => isSafeClaudeStartupLine(line))
  )
}

export const getAgentCwdHintContext = (data: string): string => {
  const normalizedData = data.replace(ANSI_ESCAPE_PATTERN, '')
  let headerStart = -1

  for (const match of normalizedData.matchAll(
    CLAUDE_STARTUP_CONTEXT_HEADER_PATTERN
  )) {
    headerStart = match.index + (match[0].startsWith('Claude Code') ? 0 : 1)
  }

  if (headerStart === -1) {
    return ''
  }

  const context = normalizedData.slice(headerStart)

  const startupLines = context
    .split(/\r\n|\r|\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)

  if (
    startupLines.length > 3 ||
    startupLines.some((line) => !isSafeClaudeStartupLine(line))
  ) {
    return ''
  }

  return context
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

    events.push({ index: match.index, kind: 'path', path: rawPath })
  }

  for (const match of normalizedData.matchAll(CLAUDE_CWD_RESET_PATTERN)) {
    events.push({ index: match.index, kind: 'path', path: match[1].trim() })
  }

  for (const match of normalizedData.matchAll(
    CLAUDE_STARTUP_HOME_CWD_PATTERN
  )) {
    if (!isClaudeStartupHomeCwd(normalizedData, match.index)) {
      continue
    }

    events.push({ index: match.index, kind: 'path', path: match[1].trim() })
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
      event.kind === 'path'
        ? resolvePathHint(event.path, nextCwd)
        : resolveCdPath(event.target, nextCwd)

    if (path) {
      nextCwd = path
      latestPath = path
    }
  }

  return latestPath
}

// cspell:ignore WORKTREE LOOKBACK polyrepo worktrees
import {
  normalizePosixPath,
  normalizeWindowsDrivePath,
  parseOsc7Cwd,
  WINDOWS_DRIVE_PATH,
} from './osc7'

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

const CLAUDE_STARTUP_MAX_CONTEXT_LINES = 6

// `- Path: <abs-path>` — Claude Code superpowers / EnterWorktree-style skill
// reports announce the new worktree directory through a stable key-value line
// even when the interactive shell deliberately does NOT receive an `cd` (to
// avoid mutating the user's $PWD).
const PATH_LABEL_PATTERN =
  /(?:^|[\r\n])[^\S\r\n]*[-•*][ \t]+Path:[ \t]+([^\r\n]+?)[ \t]*(?=$|[\r\n])/g

// Verb-phrase anchors that announce a worktree change. The absolute path is
// emitted on a SUBSEQUENT line (possibly with intervening noise such as
// `[ERROR] - (starship::print): Under a 'dumb' terminal`) so we match the
// anchor as a position and then scan forward for the path token.
const WORKTREE_ANCHOR_PATTERN =
  /(?:^|[\r\n])[^\S\r\n]*(?:[^\w\s(/\\:]+[^\S\r\n]*)?(?:Created\s+and\s+entered(?:\s+the\s+\S+)?\s+worktree:|Switched\s+to\s+worktree(?:\s+on\s+branch\s+\S+)?)[ \t]*(?=$|[\r\n])/g

// `Ran pwd` — Codex prints the command header on its own line and then
// captures stdout below. The path is the first absolute-path-shaped token in
// the captured block.
const RAN_PWD_PATTERN =
  /(?:^|[\r\n])(?:[^\S\r\n]*(?:[^\w\s(/\\:]+[^\S\r\n]*)?)Ran\s+pwd[ \t]*(?=$|[\r\n])/g

const ANCHOR_LOOKAHEAD_LINES = 6

// Worktree-related phrases that gate the PATH_LABEL_PATTERN handler. The
// `- Path:` shape is generic enough that an agent's summary or file-listing
// block can match it, so we require one of these anchor phrases within
// `PATH_LABEL_LOOKBACK_LINES` lines preceding the `- Path:` match. The
// anchors mirror the verb phrases the EnterWorktree / superpowers worktree
// skills emit just before their report block.
const WORKTREE_CONTEXT_ANCHOR_PATTERN =
  /(?:Worktree\s+ready|Switched\s+to\s+worktree|Created\s+and\s+entered(?:\s+\S+)?\s+worktree|Entered\s+worktree|Entering\s+worktree\()/i

const PATH_LABEL_LOOKBACK_LINES = 10

const hasWorktreeContextNearby = (
  data: string,
  anchorIndex: number
): boolean => {
  const head = data.slice(0, anchorIndex)
  const lines = head.split(/\r\n|\r|\n/).reverse()
  let scanned = 0
  for (const line of lines) {
    if (!line.trim()) {
      continue
    }
    if (WORKTREE_CONTEXT_ANCHOR_PATTERN.test(line)) {
      return true
    }
    scanned += 1
    if (scanned >= PATH_LABEL_LOOKBACK_LINES) {
      break
    }
  }

  return false
}

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

const normalizePath = (path: string): string =>
  path.startsWith('//') && !path.startsWith('///')
    ? path
    : path.startsWith('/')
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
    return normalizePath(`${currentCwd}/${target}`)
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

const isAbsolutePathToken = (token: string): boolean =>
  token.startsWith('/') ||
  WINDOWS_DRIVE_PATH.test(token) ||
  token.startsWith('\\\\')

// Source / config / docs file extensions that should NEVER appear in an
// agent's worktree directory name. When the last segment of an extracted
// path ends in one of these, it's almost certainly a file reference in
// error / log output rather than a cwd announcement.
//
// Denylist rather than heuristic: an earlier regex
// (`/^[^.][^.\\/]*\.[A-Za-z][A-Za-z0-9]*$/`) tried to detect file-shaped
// extensions structurally, which (a) misclassified semver dirs with
// purely-numeric suffixes (`release-1.5`, `v2.0`) and (b) over-matched
// real directory names like `project.api`, `feature.web`,
// `vimeflow.service` — common in polyrepo / service-mesh layouts.
// Enumerating the source/config extensions we expect to see in agent
// transcripts is narrower and less prone to silent drops.
const FILE_EXTENSION_DENYLIST = new Set([
  // JS / TS family
  'js',
  'jsx',
  'ts',
  'tsx',
  'mjs',
  'cjs',
  'mts',
  'cts',
  // System languages
  'rs',
  'go',
  'c',
  'cc',
  'cpp',
  'cxx',
  'h',
  'hh',
  'hpp',
  'm',
  'mm',
  'java',
  'kt',
  'swift',
  'zig',
  // Dynamic languages
  'py',
  'pyi',
  'rb',
  'php',
  'pl',
  'lua',
  // Shell / scripts
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  // Markup / docs
  'md',
  'mdx',
  'rst',
  'txt',
  // Config / data
  'json',
  'jsonc',
  'json5',
  'yaml',
  'yml',
  'toml',
  'ini',
  'xml',
  'html',
  'htm',
  'css',
  'scss',
  'sass',
  'less',
  // Locks / generated / misc
  'lock',
  'log',
  'snap',
])

// True when the last segment of `path` looks like a file. A segment that
// starts with `.` (e.g. `.claude`) is a hidden directory and never matches
// even if its suffix happens to be in the denylist — that's correct: the
// agent's cwd inside `.claude/worktrees/<x>` is structurally distinct from
// touching a `.eslintrc`-style dotfile, which would never appear as the
// trailing segment of a worktree path.
const looksLikeFilePath = (path: string): boolean => {
  const lastSegment = path.split(/[/\\]/).pop() ?? ''
  if (lastSegment === '' || lastSegment.startsWith('.')) {
    return false
  }

  const dotIndex = lastSegment.lastIndexOf('.')
  if (dotIndex <= 0) {
    return false
  }

  const ext = lastSegment.slice(dotIndex + 1).toLowerCase()

  return FILE_EXTENSION_DENYLIST.has(ext)
}

// Tree-renderer prefixes that may appear before a path on its own line
// in agent transcripts (e.g. `└ /abs/path`, `| /abs/path`, `L /abs/path`).
// Match either a single prefix char + whitespace OR a tight run of prefix
// chars (e.g. `└──`). The trailing `\s*$` is intentionally absent — see
// `extractAbsPathFromLine` for how this gets used.
const PATH_LINE_PREFIX_PATTERN = /^[|└─\-*•L]+\s+/

// Reject paths whose content past the leading drive (Unix `/...` or
// Windows `C:/...`) carries a `:` outside that drive offset. Lines like
// `/repo/src/main.rs: error[E0123]` would otherwise be matched whole by
// the rewritten extractor below; the colon is a high-signal indicator
// that the trailing portion is error/output formatting, not a directory.
// Real Unix paths CAN contain `:` but it's vanishingly rare.
const hasSuspiciousColon = (path: string): boolean => {
  const driveColonOffset = WINDOWS_DRIVE_PATH.test(path) ? 1 : -1
  for (let index = 0; index < path.length; index += 1) {
    if (path[index] === ':' && index !== driveColonOffset) {
      return true
    }
  }

  return false
}

// Extract a path from a single line. The path is allowed to contain
// spaces (e.g. `/Users/alice/Code Projects/repo`) because the path is
// expected to occupy the WHOLE trimmed line minus an optional tree-
// renderer prefix. This is stricter than `path-as-last-whitespace-token`
// (which fails on spaces) but is gated by `hasSuspiciousColon` so error
// lines like `/repo/main.rs: error[E0123]` are still rejected.
const extractAbsPathFromLine = (line: string): string | null => {
  const trimmed = line.trim()
  if (!trimmed) {
    return null
  }

  const prefixMatch = PATH_LINE_PREFIX_PATTERN.exec(trimmed)
  const body = prefixMatch ? trimmed.slice(prefixMatch[0].length) : trimmed

  if (!isAbsolutePathToken(body)) {
    return null
  }

  if (hasSuspiciousColon(body)) {
    return null
  }

  if (looksLikeFilePath(body)) {
    return null
  }

  return body
}

// Scan forward from `startIndex` in `data` up to `ANCHOR_LOOKAHEAD_LINES`
// non-empty lines and return the first that contains an absolute-path
// token at the trailing end of the line. Ignores empty lines, so noise
// such as the `[ERROR] - (starship::print): Under a 'dumb' terminal`
// preamble Codex emits before captured stdout does not consume the
// budget.
const findAbsPathAfter = (data: string, startIndex: number): string | null => {
  const tail = data.slice(startIndex)
  const lines = tail.split(/\r\n|\r|\n/)
  let scanned = 0

  // `lines[0]` is the remainder of the anchor's line — skip it.
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim()) {
      continue
    }

    const path = extractAbsPathFromLine(line)
    if (path) {
      return path
    }

    scanned += 1
    if (scanned >= ANCHOR_LOOKAHEAD_LINES) {
      break
    }
  }

  return null
}

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
    startupLines.length <= CLAUDE_STARTUP_MAX_CONTEXT_LINES &&
    startupLines.every((line) => isSafeClaudeStartupLine(line))
  )
}

export const getAgentCwdHintContext = (data: string): string => {
  const normalizedData = data.replace(ANSI_ESCAPE_PATTERN, '')
  let headerStart = -1

  for (const match of normalizedData.matchAll(
    CLAUDE_STARTUP_CONTEXT_HEADER_PATTERN
  )) {
    headerStart = match.index + match[0].indexOf('Claude Code')
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
    startupLines.length > CLAUDE_STARTUP_MAX_CONTEXT_LINES ||
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

  for (const match of normalizedData.matchAll(PATH_LABEL_PATTERN)) {
    const candidate = match[1].trim()
    if (!isAbsolutePathToken(candidate)) {
      continue
    }

    // Symmetric with `extractAbsPathFromLine`: reject paths whose last
    // segment looks like a file name. A skill that reports
    // `- Path: /repo/src/main.rs` should NOT update pane.cwd.
    if (looksLikeFilePath(candidate)) {
      continue
    }

    // `- Path:` is a generic enough shape that file-listings and skill
    // summaries can match it. Require a worktree-context anchor within
    // `PATH_LABEL_LOOKBACK_LINES` to confirm this label is part of an
    // EnterWorktree-style report block — otherwise pane.cwd can jump
    // to an arbitrary path the user never asked for.
    if (!hasWorktreeContextNearby(normalizedData, match.index)) {
      continue
    }

    events.push({ index: match.index, kind: 'path', path: candidate })
  }

  for (const match of normalizedData.matchAll(WORKTREE_ANCHOR_PATTERN)) {
    const anchorEnd = match.index + match[0].length
    const path = findAbsPathAfter(normalizedData, anchorEnd)
    if (path) {
      events.push({ index: match.index, kind: 'path', path })
    }
  }

  for (const match of normalizedData.matchAll(RAN_PWD_PATTERN)) {
    const anchorEnd = match.index + match[0].length
    const path = findAbsPathAfter(normalizedData, anchorEnd)
    if (path) {
      events.push({ index: match.index, kind: 'path', path })
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

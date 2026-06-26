export const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/
const WINDOWS_FILE_URL_DRIVE_PATH = /^\/[A-Za-z]:[\\/]/

export interface ParseOsc7CwdOptions {
  preserveFileUrlHost?: boolean
}

const OSC7_CWD_SEQUENCE_PATTERN = /\x1b\]7;([^\x07]*?)(?:\x07|\x1b\\)/g
const OSC7_CWD_SEQUENCE_START = '\x1b]7;'
const OSC7_CWD_BUFFER_LIMIT = 8192

export const extractOsc7CwdValues = (data: string): string[] =>
  [...data.matchAll(OSC7_CWD_SEQUENCE_PATTERN)].map((match) => match[1])

export interface Osc7CwdExtractor {
  push: (data: string) => string[]
  reset: () => void
}

const trailingStartPrefix = (data: string): string => {
  const maxLength = Math.min(data.length, OSC7_CWD_SEQUENCE_START.length - 1)

  for (let length = maxLength; length > 0; length -= 1) {
    const suffix = data.slice(-length)
    if (OSC7_CWD_SEQUENCE_START.startsWith(suffix)) {
      return suffix
    }
  }

  return ''
}

export const createOsc7CwdExtractor = (): Osc7CwdExtractor => {
  let pending = ''

  return {
    push: (data): string[] => {
      const output: string[] = []
      const input = `${pending}${data}`
      let cursor = 0
      pending = ''

      while (cursor < input.length) {
        const start = input.indexOf(OSC7_CWD_SEQUENCE_START, cursor)
        if (start === -1) {
          pending = trailingStartPrefix(input.slice(cursor))

          break
        }

        const payloadStart = start + OSC7_CWD_SEQUENCE_START.length
        const bel = input.indexOf('\x07', payloadStart)
        const st = input.indexOf('\x1b\\', payloadStart)
        const end = bel === -1 ? st : st === -1 ? bel : Math.min(bel, st)

        if (end === -1) {
          pending = input.slice(start).slice(-OSC7_CWD_BUFFER_LIMIT)

          break
        }

        output.push(input.slice(payloadStart, end))
        cursor = end + (end === st ? 2 : 1)
      }

      return output
    },
    reset: (): void => {
      pending = ''
    },
  }
}

export const normalizePosixPath = (path: string): string => {
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

export const normalizeWindowsDrivePath = (path: string): string => {
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

const decodePathname = (pathname: string): string => {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return pathname
  }
}

const normalizeAbsolutePath = (pathname: string): string | null => {
  const path = WINDOWS_FILE_URL_DRIVE_PATH.test(pathname)
    ? pathname.slice(1)
    : pathname

  if (path.startsWith('//') && !path.startsWith('///')) {
    return path
  }

  if (path.startsWith('/')) {
    return normalizePosixPath(path)
  }

  if (WINDOWS_DRIVE_PATH.test(path)) {
    return normalizeWindowsDrivePath(path)
  }

  if (path.startsWith('\\\\')) {
    return path
  }

  return null
}

const fileUrlPathname = (url: URL, options: ParseOsc7CwdOptions): string => {
  const pathname = decodePathname(url.pathname)
  const shouldPreserveHost = options.preserveFileUrlHost ?? true

  if (
    !shouldPreserveHost ||
    !url.hostname ||
    url.hostname === 'localhost' ||
    WINDOWS_FILE_URL_DRIVE_PATH.test(pathname) ||
    (pathname.startsWith('//') && !pathname.startsWith('///'))
  ) {
    return pathname
  }

  return `//${url.hostname}${pathname.startsWith('/') ? pathname : `/${pathname}`}`
}

export const parseOsc7Cwd = (
  data: string,
  options: ParseOsc7CwdOptions = {}
): string | null => {
  const plainPath = normalizeAbsolutePath(data)
  if (plainPath) {
    return plainPath
  }

  let url: URL
  try {
    url = new URL(data)
  } catch {
    return null
  }

  if (url.protocol !== 'file:') {
    return null
  }

  return normalizeAbsolutePath(fileUrlPathname(url, options))
}

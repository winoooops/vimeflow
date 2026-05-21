export const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/
const WINDOWS_FILE_URL_DRIVE_PATH = /^\/[A-Za-z]:[\\/]/

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

export const parseOsc7Cwd = (data: string): string | null => {
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

  return normalizeAbsolutePath(decodePathname(url.pathname))
}

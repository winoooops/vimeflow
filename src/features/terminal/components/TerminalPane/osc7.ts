const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[\\/]/
const WINDOWS_FILE_URL_DRIVE_PATH = /^\/[A-Za-z]:[\\/]/

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

  if (
    path.startsWith('/') ||
    path.startsWith('\\\\') ||
    WINDOWS_DRIVE_PATH.test(path)
  ) {
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

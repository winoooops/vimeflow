export type FaviconTone = 'cyan' | 'mauve' | 'coral'

export interface FaviconPlaceholder {
  glyph: string
  tone: FaviconTone
}

const PR_PATH = /\/(pull|pulls|merge_requests)(\/|$)/
const ISSUE_PATH = /\/issues(\/|$)/

// Deterministic placeholder favicon derived from the URL — no network, no real
// favicon (that is L3). PR-like URLs read as merge/mauve, issue-like as
// adjust/coral, everything else (and unparseable input) as public/cyan.
export const faviconPlaceholder = (url: string): FaviconPlaceholder => {
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    return { glyph: 'public', tone: 'cyan' }
  }

  if (PR_PATH.test(pathname)) {
    return { glyph: 'merge', tone: 'mauve' }
  }
  if (ISSUE_PATH.test(pathname)) {
    return { glyph: 'adjust', tone: 'coral' }
  }

  return { glyph: 'public', tone: 'cyan' }
}

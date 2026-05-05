export interface ParsedQuery {
  verbToken: string
  args: string
}

export const parseQuery = (query: string): ParsedQuery => {
  const trimmed = query.trim()
  const spaceIdx = trimmed.indexOf(' ')
  if (spaceIdx === -1) {
    return { verbToken: trimmed, args: '' }
  }

  return {
    verbToken: trimmed.slice(0, spaceIdx),
    args: trimmed.slice(spaceIdx + 1).trim(),
  }
}

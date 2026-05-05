export interface ParsedQuery {
  commandVerb: string
  args: string
}

export const parseQuery = (query: string): ParsedQuery => {
  const trimmed = query.trim()
  const spaceIdx = trimmed.indexOf(' ')
  if (spaceIdx === -1) {
    return { commandVerb: trimmed, args: '' }
  }

  return {
    commandVerb: trimmed.slice(0, spaceIdx),
    args: trimmed.slice(spaceIdx + 1).trim(),
  }
}

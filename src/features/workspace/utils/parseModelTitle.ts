export interface ParsedModelTitle {
  /** Model name with any trailing context-window suffix stripped. */
  name: string
  /** Compact context-window label (e.g. "1M", "200K"), or null when absent. */
  contextLabel: string | null
}

// Claude Code reports the model display name with the context window folded
// into a trailing parenthetical, e.g. "Opus 4.8 (1M context)". Rendered as a
// single string it truncates ("Opus 4.8 (1M cont…"); splitting the size out
// lets the card show the name plus a compact badge. Only a parenthetical that
// actually names the *context* window is peeled off — other parenthetical
// notes (e.g. "(beta)") and plain fallbacks (a session name, "No session")
// stay whole.
const CONTEXT_SUFFIX = /^(.*?)\s*\(\s*(\S+)\s+context\s*\)\s*$/iu

export const parseModelTitle = (title: string): ParsedModelTitle => {
  const match = CONTEXT_SUFFIX.exec(title)
  if (!match) {
    return { name: title, contextLabel: null }
  }

  const name = match[1].trim()
  const contextLabel = match[2].trim()
  if (name.length === 0 || contextLabel.length === 0) {
    return { name: title, contextLabel: null }
  }

  return { name, contextLabel }
}

// cspell:ignore ghostty libghostty
/**
 * Answers terminal OSC color queries (`OSC 10` = default foreground,
 * `OSC 11` = default background) for the Ghostty native render path.
 *
 * libghostty-vt parses PTY output for render state but never writes responses
 * back to the PTY. Agents like Codex query the terminal's default background
 * (`\x1b]11;?`) and tint their input composer from the reply — with no answer
 * they render a degraded, bar-less composer. `@xterm/xterm` answers these
 * queries itself, so this only matters for the Ghostty surface; it restores
 * parity by replying with the active terminal theme color.
 */

export type TerminalColorQueryTarget = 'foreground' | 'background'

// OSC 10;? (fg) or OSC 11;? (bg), terminated by BEL (\x07) or ST (\x1b\\).
const COLOR_QUERY_PATTERN = /\x1b\]1([01]);\?(?:\x07|\x1b\\)/g

const HEX_COLOR_PATTERN = /^#?([0-9a-fA-F]{6})$/

/** Detect OSC 10/11 color queries in a chunk of raw PTY output. */
export const scanTerminalColorQueries = (
  data: string
): readonly TerminalColorQueryTarget[] => {
  const targets: TerminalColorQueryTarget[] = []

  for (const match of data.matchAll(COLOR_QUERY_PATTERN)) {
    targets.push(match[1] === '0' ? 'foreground' : 'background')
  }

  return targets
}

/** Convert `#1e1e2e` to the xterm OSC color form `rgb:1e1e/1e1e/2e2e`. */
export const hexToOscColor = (hex: string): string | null => {
  const match = HEX_COLOR_PATTERN.exec(hex.trim())

  if (!match) {
    return null
  }

  const channels = match[1]
  const red = channels.slice(0, 2)
  const green = channels.slice(2, 4)
  const blue = channels.slice(4, 6)

  return `rgb:${red}${red}/${green}${green}/${blue}${blue}`
}

/** Build the OSC color report a terminal sends in answer to an OSC 10/11 query. */
export const formatTerminalColorResponse = (
  target: TerminalColorQueryTarget,
  hex: string
): string | null => {
  const oscColor = hexToOscColor(hex)

  if (!oscColor) {
    return null
  }

  const code = target === 'foreground' ? '10' : '11'

  return `\x1b]${code};${oscColor}\x1b\\`
}

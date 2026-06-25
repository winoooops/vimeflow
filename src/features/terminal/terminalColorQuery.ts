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

export interface TerminalColorQueryScanResult {
  targets: readonly TerminalColorQueryTarget[]
  carry: string
}

const COLOR_QUERY_CODES = ['10', '11'] as const
const COLOR_QUERY_TERMINATORS = ['\x07', '\x1b\\'] as const

const MAX_COLOR_QUERY_SEQUENCE_LENGTH = Math.max(
  ...COLOR_QUERY_CODES.flatMap((code) =>
    COLOR_QUERY_TERMINATORS.map(
      (terminator) => `\x1b]${code};?${terminator}`.length
    )
  )
)

// OSC 10;? (fg) or OSC 11;? (bg), terminated by BEL (\x07) or ST (\x1b\\).
// Keep this paired with matchAll; a global exec loop would leak lastIndex
// across calls and miss boundary-spanning queries.
const COLOR_QUERY_PATTERN = /\x1b\]1([01]);\?(?:\x07|\x1b\\)/g
const MAX_COLOR_QUERY_CARRY_LENGTH = MAX_COLOR_QUERY_SEQUENCE_LENGTH - 1

const HEX_COLOR_PATTERN = /^#?([0-9a-fA-F]{6})$/

/** Detect OSC 10/11 color queries in a chunk of raw PTY output. */
export const scanTerminalColorQueries = (
  data: string
): readonly TerminalColorQueryTarget[] =>
  scanTerminalColorQueriesWithCarry(data, '').targets

/**
 * Detect OSC 10/11 color queries across arbitrary PTY event boundaries.
 *
 * The carry is at most one byte shorter than the longest query sequence, and
 * starts after the last complete match so already-answered queries do not
 * repeat on the next scan.
 */
export const scanTerminalColorQueriesWithCarry = (
  data: string,
  previousCarry: string
): TerminalColorQueryScanResult => {
  const scannedData = `${previousCarry}${data}`
  const targets: TerminalColorQueryTarget[] = []
  let lastConsumedIndex = 0

  for (const match of scannedData.matchAll(COLOR_QUERY_PATTERN)) {
    targets.push(match[1] === '0' ? 'foreground' : 'background')
    lastConsumedIndex = match.index + match[0].length
  }

  const unconsumed = scannedData.slice(lastConsumedIndex)

  return {
    targets,
    carry: unconsumed.slice(-MAX_COLOR_QUERY_CARRY_LENGTH),
  }
}

/**
 * Preserve enough trailing data to retry a complete query when the responder
 * cannot send yet, for example before terminal CSS variables are available.
 */
export const retainTerminalColorQueryRetryCarry = (
  data: string,
  previousCarry: string
): string => {
  const scannedData = `${previousCarry}${data}`
  const matches = [...scannedData.matchAll(COLOR_QUERY_PATTERN)]
  const completedQueries = matches.map((match) => match[0])

  if (completedQueries.length > 0) {
    const lastMatch = matches[matches.length - 1]

    const trailingCarry = scannedData
      .slice(lastMatch.index + lastMatch[0].length)
      .slice(-MAX_COLOR_QUERY_CARRY_LENGTH)

    return `${completedQueries.join('')}${trailingCarry}`
  }

  return scannedData.slice(-MAX_COLOR_QUERY_SEQUENCE_LENGTH)
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

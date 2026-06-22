// cspell:ignore ghostty libghostty
/**
 * Tracks DEC private mode 2026 (synchronized output) across PTY chunks.
 *
 * Agents like Codex wrap each atomic screen redraw in `\x1b[?2026h` …
 * `\x1b[?2026l` (begin/end synchronized update). The Ghostty render path
 * snapshots libghostty after every PTY chunk, so a chunk that ends *inside* a
 * frame — after a clear-screen but before the redraw — produces a torn/blank
 * snapshot that flashes the terminal blank (e.g. Codex's input bar "collapsing"
 * while MCP servers load). Honoring 2026 lets the renderer hold the last
 * complete frame until the in-progress one closes.
 */

const ESC = 0x1b
// bytes after ESC for `[?2026`
const SEQUENCE_PREFIX = [0x5b, 0x3f, 0x32, 0x30, 0x32, 0x36]
const SET_FINAL = 0x68 // 'h' — begin synchronized update
const RESET_FINAL = 0x6c // 'l' — end synchronized update
const SYNC_FRAME_SEQUENCE_LENGTH = SEQUENCE_PREFIX.length + 2
const MAX_CARRY_LENGTH = SYNC_FRAME_SEQUENCE_LENGTH - 1

export interface SyncFrameParserState {
  insideFrame: boolean
  carryBytes: Uint8Array
}

/**
 * Fold a chunk of raw PTY bytes into the running synchronized-output state.
 * Returns whether, after this chunk, the stream is inside an open 2026 frame
 * plus enough trailing bytes to recognize a marker split across the next chunk.
 */
export const readSyncFrameState = (
  bytes: Uint8Array,
  previousState: SyncFrameParserState
): SyncFrameParserState => {
  let insideFrame = previousState.insideFrame
  const scannedBytes = appendCarryBytes(previousState.carryBytes, bytes)

  // last index where ESC + 6 prefix bytes + 1 final byte all fit
  const lastStart = scannedBytes.length - SYNC_FRAME_SEQUENCE_LENGTH
  for (let index = 0; index <= lastStart; index += 1) {
    if (scannedBytes[index] !== ESC) {
      continue
    }

    let matchesPrefix = true
    for (let offset = 0; offset < SEQUENCE_PREFIX.length; offset += 1) {
      if (scannedBytes[index + 1 + offset] !== SEQUENCE_PREFIX[offset]) {
        matchesPrefix = false
        break
      }
    }

    if (!matchesPrefix) {
      continue
    }

    const final = scannedBytes[index + 1 + SEQUENCE_PREFIX.length]

    if (final === SET_FINAL) {
      insideFrame = true
    } else if (final === RESET_FINAL) {
      insideFrame = false
    }
  }

  return {
    insideFrame,
    carryBytes: sliceCarryBytes(scannedBytes),
  }
}

export const createSyncFrameParserState = (): SyncFrameParserState => ({
  insideFrame: false,
  carryBytes: new Uint8Array(),
})

const appendCarryBytes = (
  carryBytes: Uint8Array,
  bytes: Uint8Array
): Uint8Array => {
  if (carryBytes.length === 0) {
    return bytes
  }

  const combined = new Uint8Array(carryBytes.length + bytes.length)
  combined.set(carryBytes)
  combined.set(bytes, carryBytes.length)

  return combined
}

const sliceCarryBytes = (bytes: Uint8Array): Uint8Array => {
  if (bytes.length <= MAX_CARRY_LENGTH) {
    return bytes.slice()
  }

  return bytes.slice(bytes.length - MAX_CARRY_LENGTH)
}

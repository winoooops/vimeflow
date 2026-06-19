// cspell:ignore ghostty
import type { TerminalParserEngineOutput } from './terminalParserEngine'

export interface GhosttyVtRenderSnapshotCursor {
  readonly rowIndex: number
  readonly columnOffset: number
}

export interface GhosttyVtRenderSnapshot {
  readonly rows: readonly string[]
  readonly cursor?: GhosttyVtRenderSnapshotCursor
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

const readSnapshotText = (snapshot: GhosttyVtRenderSnapshot): string =>
  snapshot.rows.join('\n')

const readSnapshotCursorOffset = (
  snapshot: GhosttyVtRenderSnapshot,
  text: string
): number => {
  const cursor = snapshot.cursor

  if (!cursor || snapshot.rows.length === 0) {
    return text.length
  }

  const rowIndex = clamp(cursor.rowIndex, 0, snapshot.rows.length - 1)

  const columnOffset = clamp(
    cursor.columnOffset,
    0,
    snapshot.rows[rowIndex]?.length ?? 0
  )

  const precedingRowsLength = snapshot.rows
    .slice(0, rowIndex)
    .reduce((length, row) => length + row.length + 1, 0)

  return precedingRowsLength + columnOffset
}

export const createGhosttyVtRenderSnapshotOutput = (
  snapshot: GhosttyVtRenderSnapshot
): TerminalParserEngineOutput => {
  const text = readSnapshotText(snapshot)
  const cursorOffset = readSnapshotCursorOffset(snapshot, text)

  return {
    visibleText: text,
    displayDelta: {
      operations: [
        {
          type: 'replace',
          text,
          cursorOffset,
        },
      ],
    },
  }
}

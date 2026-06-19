import type { ReactElement } from 'react'
import type { PaneLayoutId } from '../../../sessions/types'
import {
  isBuiltinPaneLayoutId,
  type PaneLayoutDefinition,
} from '../../layout-registry'

export interface LayoutGlyphProps {
  layoutId: PaneLayoutId
  definition?: PaneLayoutDefinition | undefined
}

const GenericLayoutGlyph = ({
  definition,
}: {
  definition: PaneLayoutDefinition
}): ReactElement => {
  const frameX = 1
  const frameY = 1
  const frameWidth = 12
  const frameHeight = 9
  const columns = definition.tracks.columns.map((track) => track.units)
  const rows = definition.tracks.rows.map((track) => track.units)
  const colTotal = columns.reduce((total, unit) => total + unit, 0) || 1
  const rowTotal = rows.reduce((total, unit) => total + unit, 0) || 1

  const offset = (
    tracks: readonly number[],
    total: number,
    start: number,
    span: number
  ): { readonly start: number; readonly size: number } => {
    const leading = tracks.slice(0, start).reduce((sum, unit) => sum + unit, 0)

    const size = tracks
      .slice(start, start + span)
      .reduce((sum, unit) => sum + unit, 0)

    return { start: leading / total, size: size / total }
  }

  return (
    <svg
      width="14"
      height="11"
      viewBox="0 0 14 11"
      aria-hidden="true"
      focusable="false"
    >
      {definition.slots.map((slot, slotIndex) => {
        const col = offset(columns, colTotal, slot.rect.col, slot.rect.colSpan)
        const row = offset(rows, rowTotal, slot.rect.row, slot.rect.rowSpan)
        const x = frameX + col.start * frameWidth
        const y = frameY + row.start * frameHeight
        const width = col.size * frameWidth
        const height = row.size * frameHeight

        return (
          <rect
            key={slot.id}
            x={x}
            y={y}
            width={width}
            height={height}
            rx="0.9"
            fill="currentColor"
            fillOpacity={0.18 + (slotIndex % 3) * 0.1}
            stroke="currentColor"
            strokeWidth="0.8"
          />
        )
      })}
    </svg>
  )
}

export const LayoutGlyph = ({
  layoutId,
  definition = undefined,
}: LayoutGlyphProps): ReactElement => {
  if (definition && !isBuiltinPaneLayoutId(layoutId)) {
    return <GenericLayoutGlyph definition={definition} />
  }

  const sw = 1.4
  const r = 1.4

  const frame = (
    <rect
      x="1"
      y="1"
      width="12"
      height="9"
      rx={r}
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
    />
  )

  const v = (
    <line
      x1="7"
      y1="1.5"
      x2="7"
      y2="9.5"
      stroke="currentColor"
      strokeWidth={sw}
    />
  )

  const h = (
    <line
      x1="1.5"
      y1="5.5"
      x2="12.5"
      y2="5.5"
      stroke="currentColor"
      strokeWidth={sw}
    />
  )

  const threeR1 = (
    <line
      x1="8"
      y1="1.5"
      x2="8"
      y2="9.5"
      stroke="currentColor"
      strokeWidth={sw}
    />
  )

  const threeR2 = (
    <line
      x1="8"
      y1="5.5"
      x2="12.5"
      y2="5.5"
      stroke="currentColor"
      strokeWidth={sw}
    />
  )

  const grid3x2V1 = (
    <line
      x1="5.15"
      y1="1.5"
      x2="5.15"
      y2="9.5"
      stroke="currentColor"
      strokeWidth={sw}
    />
  )

  const grid3x2V2 = (
    <line
      x1="8.85"
      y1="1.5"
      x2="8.85"
      y2="9.5"
      stroke="currentColor"
      strokeWidth={sw}
    />
  )

  return (
    <svg
      width="14"
      height="11"
      viewBox="0 0 14 11"
      aria-hidden="true"
      focusable="false"
    >
      {frame}
      {layoutId === 'vsplit' && v}
      {layoutId === 'hsplit' && h}
      {layoutId === 'threeRight' && (
        <>
          {threeR1}
          {threeR2}
        </>
      )}
      {layoutId === 'quad' && (
        <>
          {v}
          {h}
        </>
      )}
      {layoutId === 'grid3x2' && (
        <>
          {grid3x2V1}
          {grid3x2V2}
          {h}
        </>
      )}
    </svg>
  )
}

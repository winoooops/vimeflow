import type { ReactElement } from 'react'
import type { LayoutId } from '../../../sessions/types'

export interface LayoutGlyphProps {
  layoutId: LayoutId
}

export const LayoutGlyph = ({ layoutId }: LayoutGlyphProps): ReactElement => {
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
    </svg>
  )
}

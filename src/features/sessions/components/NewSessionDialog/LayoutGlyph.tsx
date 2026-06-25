import { type ReactElement } from 'react'
import type { PaneLayoutId } from '../../types'

interface LayoutGlyphProps {
  id: PaneLayoutId
  active?: boolean
}

const W = 16
const H = 12
const SW = 1.4

// Inline-SVG miniature of each layout shape. Color comes from `currentColor`,
// so the caller controls active/inactive hue via text color.
export const LayoutGlyph = ({ id, active = false }: LayoutGlyphProps): ReactElement => {
  const lines: Partial<Record<PaneLayoutId, ReactElement>> = {
    vsplit: <line x1={W / 2} y1="1" x2={W / 2} y2={H - 1} stroke="currentColor" strokeWidth={SW} />,
    hsplit: <line x1="1" y1={H / 2} x2={W - 1} y2={H / 2} stroke="currentColor" strokeWidth={SW} />,
    threeRight: (
      <>
        <line x1="9.4" y1="1" x2="9.4" y2={H - 1} stroke="currentColor" strokeWidth={SW} />
        <line x1="9.4" y1={H / 2} x2={W - 1} y2={H / 2} stroke="currentColor" strokeWidth={SW} />
      </>
    ),
    quad: (
      <>
        <line x1={W / 2} y1="1" x2={W / 2} y2={H - 1} stroke="currentColor" strokeWidth={SW} />
        <line x1="1" y1={H / 2} x2={W - 1} y2={H / 2} stroke="currentColor" strokeWidth={SW} />
      </>
    ),
  }

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className={active ? 'text-primary' : 'text-on-surface-muted'}
      aria-hidden="true"
    >
      <rect x="1" y="1" width={W - 2} height={H - 2} rx="1.4" fill="none" stroke="currentColor" strokeWidth={SW} />
      {lines[id]}
    </svg>
  )
}

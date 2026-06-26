import { isValidElement, type ReactElement, type ReactNode } from 'react'

// A 1px vertical hairline that visually groups the toolbar's clusters (e.g.
// between the view-mode segmented control and the file/hunk navigation, and
// between navigation and the config chips). Tonal depth only — no heavy
// container blocks.
//
// It is rendered as a normal PriorityPlus child so it participates in width
// measurement, but PriorityPlus special-cases it (via `isSeparatorElement`) so
// a separator never (a) dangles at the trailing edge of the visible run or (b)
// shows up as a meaningless vertical line inside the vertical `…` overflow
// tray.
export const ToolbarSeparator = (): ReactElement => (
  <span
    aria-hidden="true"
    className="h-5 w-px shrink-0 bg-outline-variant/60"
  />
)

// Identity check PriorityPlus uses to identify separators without coupling to
// class names or markup. Kept beside the component so the two never drift.
export const isSeparatorElement = (node: ReactNode): boolean =>
  isValidElement(node) && node.type === ToolbarSeparator

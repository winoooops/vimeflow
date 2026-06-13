import { type CSSProperties, type ReactElement, type ReactNode } from 'react'
import {
  FloatingFocusManager,
  FloatingPortal,
  type FloatingContext,
} from '@floating-ui/react'
import { GLASS_SURFACE } from './glassSurface'

export interface SurfacePanelProps {
  setFloating: (node: HTMLElement | null) => void
  style: CSSProperties
  context: FloatingContext
  width?: number
  // FloatingFocusManager config; an object turns focus management on. Default off.
  focus?: false | { initialFocus?: number; modal?: boolean }
  children: ReactNode
  // getFloatingProps() output is spread through; NO arbitrary className —
  // GLASS_SURFACE is the single chrome so the glass panel cannot drift.
  [prop: string]: unknown
}

// The chrome half of the floating substrate: portals out of the local stacking
// context, renders the canonical glass div, and optionally wraps it in a
// FloatingFocusManager. Paired with useFloatingSurface; the only other
// @floating-ui/react importer.
export const SurfacePanel = ({
  setFloating,
  style,
  context,
  width = undefined,
  focus = false,
  children,
  ...floatingProps
}: SurfacePanelProps): ReactElement => {
  const panel = (
    <div
      ref={setFloating}
      style={{ ...style, width }}
      className={GLASS_SURFACE}
      {...floatingProps}
    >
      {children}
    </div>
  )

  return (
    <FloatingPortal>
      {focus === false ? (
        panel
      ) : (
        <FloatingFocusManager
          context={context}
          initialFocus={focus.initialFocus}
          modal={focus.modal}
        >
          {panel}
        </FloatingFocusManager>
      )}
    </FloatingPortal>
  )
}

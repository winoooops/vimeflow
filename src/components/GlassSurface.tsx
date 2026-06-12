import type { CSSProperties, HTMLAttributes, ReactElement } from 'react'

// Lowest-surface tint (#0d0d1c) painted behind the blur. Kept as an RGB
// triplet so the alpha can be tuned per-instance via `tintAlpha`.
const GLASS_TINT_RGB = '13, 13, 28'

export interface GlassSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Opacity (0–1) of the lowest-surface tint painted behind the backdrop
   * blur. Default 0.65 — translucent enough that content behind ghosts
   * through, opaque enough to keep foreground text legible. Lower it for a
   * more see-through surface.
   */
  tintAlpha?: number
}

/**
 * Frosted-glass surface — the "Obsidian Lens" glassmorphism treatment shared
 * by the app's floating/overlay chrome (dialogs, tooltips, the command
 * palette, diff popovers).
 *
 * It layers two things:
 *  1. a translucent lowest-surface tint — `rgba(13,13,28,<tintAlpha>)`, and
 *  2. the global `glass-panel` utility from `src/index.css`
 *     (`backdrop-filter: blur(20px) saturate(150%)`).
 *
 * IMPORTANT: the blur only reads when there is content BEHIND the surface to
 * sample, so use this for elements that float ABOVE other UI. A solid in-flow
 * panel has nothing behind it to blur — use a plain `bg-surface-*` token for
 * those instead.
 *
 * Extracted from the (removed) auto-hide top chrome so future overlay
 * components can reuse the exact same treatment. Pass `className` for layout
 * (size, radius, border, padding, positioning) and `tintAlpha` to tune
 * translucency; any other div props (`style`, `children`, handlers, …) are
 * forwarded.
 */
export const GlassSurface = ({
  tintAlpha = 0.65,
  className = '',
  style,
  ...rest
}: GlassSurfaceProps): ReactElement => {
  // The tint lives on `backgroundColor` so the `glass-panel` utility only has
  // to own the blur; callers' `style` can still override/extend it.
  const mergedStyle: CSSProperties = {
    backgroundColor: `rgba(${GLASS_TINT_RGB}, ${tintAlpha})`,
    ...style,
  }

  return (
    <div
      className={`glass-panel ${className}`.trim()}
      style={mergedStyle}
      {...rest}
    />
  )
}

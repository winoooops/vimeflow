import type { ReactElement, RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { ToolCount } from '../../types'

export interface ToolJarBreakdownProps {
  anchorRef: RefObject<HTMLElement | null>
  items: ToolCount[]
}

const CARD_WIDTH = 196

/**
 * The "others" hover card — every bundled tool with its count. Portaled to
 * <body> so the vessel's `overflow:hidden` can't clip it, with pointer events
 * off so it never steals the hover. Theme tokens resolve here because they're
 * applied at `:root`, so `var(--color-*)` works through the portal.
 */
export const ToolJarBreakdown = ({
  anchorRef,
  items,
}: ToolJarBreakdownProps): ReactElement | null => {
  const anchor = anchorRef.current
  if (!anchor) {
    return null
  }

  const rect = anchor.getBoundingClientRect()

  const left = Math.max(
    8,
    Math.min(
      window.innerWidth - CARD_WIDTH - 8,
      rect.left + rect.width / 2 - CARD_WIDTH / 2
    )
  )
  const placeBelow = rect.top < 200
  const top = placeBelow ? rect.bottom + 8 : rect.top - 8

  return createPortal(
    <div
      data-testid="tool-jar-breakdown"
      className="tj-enter-pop pointer-events-none fixed z-[9999]"
      style={{
        left,
        top,
        width: CARD_WIDTH,
        transform: placeBelow ? 'none' : 'translateY(-100%)',
        background: 'var(--color-surface-container)',
        border:
          '1px solid color-mix(in srgb, var(--color-outline) 55%, transparent)',
        borderRadius: 9,
        boxShadow:
          '0 12px 32px color-mix(in srgb, var(--color-surface-container-lowest) 70%, transparent)',
        padding: '8px 4px 6px',
      }}
    >
      <div
        className="font-mono uppercase"
        style={{
          fontSize: 9,
          letterSpacing: '0.12em',
          color: 'var(--color-on-surface-muted)',
          padding: '0 8px 6px',
        }}
      >
        Others · {items.length} tools
      </div>
      {/* ponytail: expand to fit every tool — no inner scroll (UX ask). A very
          long others list could outgrow the viewport; cap only if that shows up. */}
      <div>
        {items.map((item) => (
          <div
            key={item.name}
            className="flex items-center"
            style={{ gap: 8, padding: '3px 8px' }}
          >
            <span
              className="flex-1 truncate font-mono"
              style={{ fontSize: 11, color: 'var(--color-on-surface-variant)' }}
            >
              {item.name}
            </span>
            <span
              className="font-display"
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--color-primary)',
              }}
            >
              {item.count}
            </span>
          </div>
        ))}
      </div>
    </div>,
    document.body
  )
}

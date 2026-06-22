import type { ReactElement, RefObject } from 'react'
import { Popover } from '@/components/Popover'
import type { ToolCount } from '../../types'

export interface ToolJarBreakdownProps {
  anchorRef: RefObject<HTMLElement | null>
  items: ToolCount[]
}

const CARD_WIDTH = 196

// The "others" hover card — every bundled tool with its count.
export const ToolJarBreakdown = ({
  anchorRef,
  items,
}: ToolJarBreakdownProps): ReactElement | null => (
  <Popover
    anchor={anchorRef.current}
    open={anchorRef.current !== null}
    onOpenChange={(): void => undefined}
    aria-label="Other tool calls"
    placement="top"
    width={CARD_WIDTH}
    pointerEvents="none"
    focus="none"
  >
    <div
      data-testid="tool-jar-breakdown"
      className="tj-enter-pop"
      style={{
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
              style={{
                fontSize: 11,
                color: 'var(--color-on-surface-variant)',
              }}
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
    </div>
  </Popover>
)

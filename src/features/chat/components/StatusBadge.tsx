import type { ReactElement } from 'react'

interface StatusBadgeProps {
  status: string
}

/**
 * StatusBadge displays a status label with uppercase styling per design spec.
 *
 * Design reference: docs/design/chat_or_main/code.html line 261
 * Classes: bg-secondary/10, text-secondary, text-[9px], px-1.5, py-0.5,
 *          rounded, font-bold, uppercase, tracking-wider
 */
export const StatusBadge = ({ status }: StatusBadgeProps): ReactElement => (
  <span
    data-testid="status-badge"
    className="bg-secondary/10 text-secondary text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider"
  >
    {status.toUpperCase()}
  </span>
)

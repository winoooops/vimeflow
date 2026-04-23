import { isValidElement, type ReactElement, type ReactNode } from 'react'
import type { Placement } from '@floating-ui/react'

export interface TooltipProps {
  content: ReactNode
  children: ReactElement
  placement?: Placement
  delayMs?: number
  disabled?: boolean
  maxWidth?: number
  className?: string
}

export const Tooltip = ({
  content,
  children,
  disabled = false,
}: TooltipProps): ReactElement => {
  if (disabled || content == null || !isValidElement(children)) {
    return children
  }

  // Real implementation (hooks + portal) lands in Task 3.
  return children
}

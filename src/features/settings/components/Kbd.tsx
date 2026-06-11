import type { ReactElement } from 'react'
import type { KbdProps } from '../types'

export const Kbd = ({ children }: KbdProps): ReactElement => (
  <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-outline-variant/60 bg-surface-container-high/60 px-[5px] font-mono text-[10px] font-semibold leading-none text-on-surface-variant">
    {children}
  </kbd>
)

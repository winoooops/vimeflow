import type { ReactElement, ReactNode } from 'react'

interface KeyCapProps {
  children: ReactNode
  size?: 'sm' | 'md'
  active?: boolean
}

// Keycap chip shared by the palette rows (sm shortcut chips), the footer
// legend and the ESC badge (md). Active brightens toward the accent, matching
// the handoff .kc / .kbd treatment.
export const KeyCap = ({
  children,
  size = 'sm',
  active = false,
}: KeyCapProps): ReactElement => {
  const dimensions =
    size === 'sm'
      ? 'min-w-[16px] h-[16px] px-[4px] text-[9.5px]'
      : 'min-w-[18px] h-[18px] px-[5px] text-[10px]'

  const tone = active
    ? 'bg-primary-container/[0.08] text-primary border-primary-container/40'
    : size === 'sm'
      ? 'bg-surface-container-lowest/60 text-on-surface-muted border-outline-variant/40'
      : 'bg-surface-container-highest/60 text-on-surface-variant border-outline-variant/60'

  return (
    <span
      className={`inline-flex items-center justify-center rounded-[4px] border font-mono font-semibold ${dimensions} ${tone}`}
    >
      {children}
    </span>
  )
}

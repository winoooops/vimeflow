import type { ReactElement, Ref } from 'react'
import { IconButton } from '@/components/IconButton'

interface NotificationBellProps {
  readonly unread: number
  readonly unreadAlert?: boolean
  readonly panelOpen?: boolean
  readonly onToggle: () => void
  readonly ref?: Ref<HTMLButtonElement>
}

// The resting notification affordance: quiet bell at zero unread, primary
// with a count badge above that, error tint when any unread is an alert.
export const NotificationBell = ({
  unread,
  unreadAlert = false,
  panelOpen = false,
  onToggle,
  ref = undefined,
}: NotificationBellProps): ReactElement => (
  <span className="relative ml-px flex shrink-0 items-center">
    <IconButton
      ref={ref}
      icon={unread === 0 ? 'notifications_none' : 'notifications_active'}
      label={`Notifications, ${String(unread)} unread`}
      size="sm"
      aria-haspopup="dialog"
      aria-expanded={panelOpen}
      className={`h-[18px] w-[20px] text-[16px] leading-none hover:bg-transparent ${
        unreadAlert
          ? 'text-error'
          : unread > 0
            ? 'text-primary'
            : 'text-on-surface-variant'
      }`}
      onClick={onToggle}
    />
    {unread > 0 && (
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute -right-1 -top-[3px] grid h-3 min-w-3 place-items-center rounded-full px-0.5 font-mono text-[8px] font-bold leading-none ${
          unreadAlert
            ? 'bg-error-dim text-on-error-container'
            : 'bg-primary-container text-on-primary'
        }`}
      >
        {unread > 9 ? '9+' : unread}
      </span>
    )}
  </span>
)

import { useRef, type FocusEvent, type ReactElement, type Ref } from 'react'
import { AgentGlyph } from '@/components/AgentGlyph'
import { Button } from '@/components/Button'
import { IconButton } from '@/components/IconButton'
import type { ToastDisplay } from './useNotificationIslandStage'

const MINI_BUTTON_CLASSES =
  'h-[18px] rounded-full px-2 text-[10px] font-semibold'

interface NotificationToastProps {
  readonly visible: boolean
  readonly display: ToastDisplay | null
  readonly coalescedCount: number
  readonly onOpenPanel: () => void
  readonly onOpen: (id: string) => void
  readonly onClose: () => void
  readonly onHoldDwell: () => void
  readonly onStartDwell: () => void
  readonly ref?: Ref<HTMLButtonElement>
}

// The one-line arrival takeover. Always mounted after the first arrival so
// the island's data-state transitions can fade it in AND out; visibility is
// driven entirely by the vf-notification-toast CSS contract.
export const NotificationToast = ({
  visible,
  display,
  coalescedCount,
  onOpenPanel,
  onOpen,
  onClose,
  onHoldDwell,
  onStartDwell,
  ref = undefined,
}: NotificationToastProps): ReactElement | null => {
  const pointerInsideRef = useRef(false)
  const focusInsideRef = useRef(false)

  if (display === null) {
    return null
  }

  const startDwellIfReleased = (): void => {
    if (!pointerInsideRef.current && !focusInsideRef.current) {
      onStartDwell()
    }
  }

  const handlePointerEnter = (): void => {
    pointerInsideRef.current = true
    onHoldDwell()
  }

  const handlePointerLeave = (): void => {
    pointerInsideRef.current = false
    startDwellIfReleased()
  }

  const handleFocus = (event: FocusEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      focusInsideRef.current = true
      onHoldDwell()
    }
  }

  const handleBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      focusInsideRef.current = false
      startDwellIfReleased()
    }
  }

  return (
    <div
      role="status"
      aria-hidden={visible ? undefined : 'true'}
      inert={visible ? undefined : true}
      className="vf-notification-toast absolute inset-x-[5px] top-[4px] flex h-[18px] items-center gap-2"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <button
        ref={ref}
        type="button"
        aria-label={`Open notification center for ${display.record.title}${
          display.record.body === undefined ? '' : `: ${display.record.body}`
        }`}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:bg-on-surface/5"
        onClick={onOpenPanel}
      >
        <span
          aria-hidden="true"
          className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[6px]"
          style={{
            color: display.agent.accent,
            background: `color-mix(in srgb, ${display.agent.accent} 20%, transparent)`,
          }}
        >
          <AgentGlyph agent={display.agent} size={12} />
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-on-surface">
            {display.record.title}
          </span>
          <span className="max-w-[130px] shrink-0 truncate text-[10.5px] text-on-surface-muted">
            {display.record.body ?? display.sessionName}
          </span>
        </span>
        {coalescedCount > 0 && (
          <span className="shrink-0 font-mono text-[9px] text-on-surface-muted">
            +{coalescedCount}
          </span>
        )}
      </button>
      <Button
        size="sm"
        variant="ghost"
        className={`${MINI_BUTTON_CLASSES} border border-outline/45 text-on-surface-variant hover:bg-on-surface/[.06] hover:text-on-surface`}
        onClick={(): void => onOpen(display.record.id)}
      >
        Open
      </Button>
      <IconButton
        icon="close"
        label="Dismiss notification toast"
        size="sm"
        className="h-[18px] w-[18px] rounded-full text-[14px]"
        onClick={onClose}
      />
    </div>
  )
}

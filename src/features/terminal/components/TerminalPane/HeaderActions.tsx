// cspell:ignore splitscreen
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { IconButton } from '@/components/IconButton'
import { Tooltip } from '@/components/Tooltip'
import { TOOLTIP_SUPPRESSED } from '@/lib/constants'
import type { BurnerPlacement } from '@/features/terminal/hooks/useBurnerTerminals'

const SYNC_RESOLVE_SPIN_MS = 480

type BurnerSyncStatus = 'idle' | 'syncing' | 'blocked'

const BURNER_PLACEMENT_ACTION: Record<
  BurnerPlacement,
  { icon: string; next: BurnerPlacement }
> = {
  bottom: { icon: 'splitscreen_left', next: 'left' },
  left: { icon: 'splitscreen_top', next: 'top' },
  top: { icon: 'splitscreen_right', next: 'right' },
  right: { icon: 'splitscreen_bottom', next: 'bottom' },
}

const burnerButtonLabel = (
  active: boolean,
  open: boolean,
  shellExists: boolean
): string => {
  if (active) {
    return open
      ? 'hide burner terminal (running)'
      : 'open burner terminal (running)'
  }

  if (open) {
    return 'hide burner terminal'
  }

  if (shellExists) {
    return 'open burner terminal (live)'
  }

  return 'open burner terminal'
}

export interface HeaderActionsProps {
  isCollapsed: boolean
  onToggleCollapse: () => void
  shortcutHint?: string
  /** Hide when the status bar cannot render for this pane state. */
  hideCollapseToggle?: boolean
  onClose?: () => void
  /** Toggle this pane's ephemeral burner terminal (VIM-53). */
  onBurner?: () => void
  /**
   * A foreground command is actually running in the burner shell (VIM-71) —
   * drives the amber button tint (the sole running cue).
   */
  burnerActive?: boolean
  /** This pane's burner secondary terminal is currently visible. */
  burnerOpen?: boolean
  /**
   * A burner shell exists for this pane but no foreground command is running.
   * Exposed to assistive tech so an idle-but-live shell is distinguishable
   * from "no shell" (VIM-53 a11y).
   */
  burnerShellExists?: boolean
  /** The visible burner terminal cwd has drifted from this pane's cwd. */
  burnerOutOfSync?: boolean
  /** Align this pane's burner terminal back to this pane's cwd. */
  onSyncBurner?: () => void
  /** Current edge for this pane's nested native burner. */
  burnerPlacement?: BurnerPlacement
  /** Move this pane's burner to the next edge. */
  onCycleBurnerPlacement?: () => void
}

export const HeaderActions = ({
  isCollapsed,
  onToggleCollapse,
  shortcutHint = undefined,
  hideCollapseToggle = false,
  onClose = undefined,
  onBurner = undefined,
  burnerActive = false,
  burnerOpen = false,
  burnerShellExists = false,
  burnerOutOfSync = false,
  onSyncBurner = undefined,
  burnerPlacement = undefined,
  onCycleBurnerPlacement = undefined,
}: HeaderActionsProps): ReactElement => {
  const [burnerSyncStatus, setBurnerSyncStatus] =
    useState<BurnerSyncStatus>('idle')
  const burnerButtonRef = useRef<HTMLButtonElement | null>(null)
  const syncButtonRef = useRef<HTMLButtonElement | null>(null)
  const syncButtonHadFocusRef = useRef(false)
  const placementButtonHadFocusRef = useRef(false)

  const burnerLabel = burnerButtonLabel(
    burnerActive,
    burnerOpen,
    burnerShellExists
  )

  const canShowBurnerSync = Boolean(onBurner && onSyncBurner && burnerOpen)

  const showBurnerSync = Boolean(
    canShowBurnerSync && (burnerOutOfSync || burnerSyncStatus === 'syncing')
  )

  const placementAction = burnerPlacement
    ? BURNER_PLACEMENT_ACTION[burnerPlacement]
    : undefined

  const showBurnerPlacement = Boolean(
    burnerOpen && placementAction && onCycleBurnerPlacement
  )
  const showBurnerControls = showBurnerSync || showBurnerPlacement

  useEffect(() => {
    if (!showBurnerSync) {
      setBurnerSyncStatus('idle')
    }
  }, [showBurnerSync])

  useEffect(() => {
    if (showBurnerPlacement) {
      return
    }

    const shouldRestoreFocus = placementButtonHadFocusRef.current
    placementButtonHadFocusRef.current = false
    if (!shouldRestoreFocus || burnerButtonRef.current === null) {
      return
    }

    burnerButtonRef.current.focus()
  }, [showBurnerPlacement])

  useEffect(() => {
    if (showBurnerSync) {
      return
    }

    const shouldRestoreFocus = syncButtonHadFocusRef.current
    syncButtonHadFocusRef.current = false
    if (!shouldRestoreFocus || burnerButtonRef.current === null) {
      return
    }

    burnerButtonRef.current.focus()
  }, [showBurnerSync])

  useEffect(() => {
    if (showBurnerSync && !burnerActive && burnerSyncStatus === 'blocked') {
      setBurnerSyncStatus('idle')
    }
  }, [burnerActive, burnerSyncStatus, showBurnerSync])

  useEffect(() => {
    if (!canShowBurnerSync || burnerSyncStatus !== 'syncing') {
      return undefined
    }

    const timeoutId = setTimeout(() => {
      setBurnerSyncStatus('idle')
    }, SYNC_RESOLVE_SPIN_MS)

    return (): void => clearTimeout(timeoutId)
  }, [burnerSyncStatus, canShowBurnerSync])

  const burnerSyncBlocked = burnerSyncStatus === 'blocked'

  const burnerSyncLabel = burnerSyncBlocked
    ? 'stop the running command, then sync pwd'
    : burnerSyncStatus === 'syncing'
      ? 'syncing burner terminal'
      : 'sync burner terminal'

  const burnerSyncIcon = burnerSyncBlocked ? 'sync_problem' : 'sync'

  const collapseLabel = isCollapsed ? 'expand status' : 'collapse status'

  const burnerButtonClassName = showBurnerControls
    ? `!h-5 !w-5 rounded-md ${
        burnerActive
          ? 'bg-agent-shell-accent/15 text-agent-shell-accent'
          : 'bg-primary/10 text-primary hover:bg-primary/15'
      }`
    : burnerActive
      ? 'bg-agent-shell-accent/15 text-agent-shell-accent'
      : undefined

  const burnerButton = onBurner ? (
    <Tooltip content={burnerLabel} placement="bottom" nativeOverlay>
      <IconButton
        ref={burnerButtonRef}
        icon="terminal"
        label={burnerLabel}
        showTooltip={TOOLTIP_SUPPRESSED}
        size="sm"
        pressed={burnerOpen}
        onClick={(event) => {
          event.stopPropagation()
          onBurner()
        }}
        // Running keeps the amber status tint; pressed still reflects open/hidden.
        className={burnerButtonClassName}
      />
    </Tooltip>
  ) : null

  return (
    <>
      {shortcutHint && (
        <Tooltip
          content={`${shortcutHint} to focus`}
          placement="bottom"
          nativeOverlay
        >
          <span
            data-testid="pane-shortcut-hint"
            className="shrink-0 cursor-default rounded bg-on-surface/10 px-1.5 py-0.5 font-mono text-[10px] leading-none text-on-surface-variant"
          >
            {shortcutHint}
          </span>
        </Tooltip>
      )}

      {burnerButton ? (
        <div
          data-testid="burner-control-pill"
          data-state={showBurnerControls ? 'open' : 'closed'}
          className={`inline-flex h-[22px] shrink-0 items-center rounded-lg border transition-[background-color,border-color,gap,padding] duration-200 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none ${
            showBurnerControls
              ? 'gap-px border-primary/20 bg-primary/10 p-px'
              : 'gap-0 border-transparent bg-transparent p-0'
          }`}
        >
          <Tooltip content={burnerSyncLabel} placement="bottom" nativeOverlay>
            <IconButton
              ref={syncButtonRef}
              icon={burnerSyncIcon}
              label={burnerSyncLabel}
              showTooltip={TOOLTIP_SUPPRESSED}
              size="sm"
              aria-hidden={showBurnerSync ? undefined : true}
              tabIndex={showBurnerSync ? undefined : -1}
              disabled={!showBurnerSync}
              className={`vf-burner-sync-icon-motion !h-5 overflow-hidden rounded-md transition-[background-color,color,width] duration-200 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none ${
                showBurnerSync
                  ? '!w-5 opacity-100'
                  : 'pointer-events-none !w-0 opacity-0'
              } ${
                burnerSyncStatus === 'syncing'
                  ? 'vf-burner-sync-spin text-agent-shell-accent'
                  : burnerSyncBlocked
                    ? 'bg-error/10 text-error hover:bg-error/15'
                    : 'text-agent-shell-accent hover:bg-agent-shell-accent/15'
              }`}
              onClick={(event) => {
                event.stopPropagation()
                if (burnerActive) {
                  setBurnerSyncStatus('blocked')

                  return
                }
                setBurnerSyncStatus('syncing')
                onSyncBurner?.()
              }}
              onFocus={() => {
                syncButtonHadFocusRef.current = true
              }}
              onBlur={(event) => {
                if (event.currentTarget.disabled) {
                  return
                }

                syncButtonHadFocusRef.current = false
              }}
            />
          </Tooltip>
          {placementAction && onCycleBurnerPlacement ? (
            <Tooltip
              content={`move burner terminal to ${placementAction.next} (currently ${burnerPlacement})`}
              placement="bottom"
              nativeOverlay
            >
              <IconButton
                icon={placementAction.icon}
                label={`move burner terminal to ${placementAction.next} (currently ${burnerPlacement})`}
                showTooltip={TOOLTIP_SUPPRESSED}
                size="sm"
                aria-hidden={showBurnerPlacement ? undefined : true}
                tabIndex={showBurnerPlacement ? undefined : -1}
                disabled={!showBurnerPlacement}
                className={`!h-5 overflow-hidden rounded-md transition-[background-color,color,width] duration-200 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none ${
                  showBurnerPlacement
                    ? '!w-5 text-on-surface-muted opacity-100 hover:bg-primary/15 hover:text-primary'
                    : 'pointer-events-none !w-0 opacity-0'
                }`}
                onClick={(event) => {
                  event.stopPropagation()
                  onCycleBurnerPlacement()
                }}
                onFocus={() => {
                  placementButtonHadFocusRef.current = true
                }}
                onBlur={(event) => {
                  if (event.currentTarget.disabled) {
                    return
                  }

                  placementButtonHadFocusRef.current = false
                }}
              />
            </Tooltip>
          ) : null}
          {burnerButton}
        </div>
      ) : null}

      {!hideCollapseToggle && (
        <Tooltip content={collapseLabel} placement="bottom" nativeOverlay>
          <IconButton
            icon={isCollapsed ? 'unfold_more' : 'unfold_less'}
            label={collapseLabel}
            showTooltip={TOOLTIP_SUPPRESSED}
            size="sm"
            onClick={(event) => {
              event.stopPropagation()
              onToggleCollapse()
            }}
          />
        </Tooltip>
      )}

      {onClose && (
        <Tooltip content="close pane" placement="bottom" nativeOverlay>
          <IconButton
            icon="close"
            label="close pane"
            showTooltip={TOOLTIP_SUPPRESSED}
            size="sm"
            onClick={(event) => {
              event.stopPropagation()
              onClose()
            }}
          />
        </Tooltip>
      )}
    </>
  )
}

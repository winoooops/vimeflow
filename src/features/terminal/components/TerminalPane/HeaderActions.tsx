import { useEffect, useRef, useState, type ReactElement } from 'react'
import { IconButton } from '@/components/IconButton'
import { Tooltip } from '@/components/Tooltip'
import { TOOLTIP_SUPPRESSED } from '@/lib/constants'

const SYNC_FAILURE_TIMEOUT_MS = 1200

type BurnerSyncStatus = 'idle' | 'syncing' | 'blocked' | 'failed'

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
}: HeaderActionsProps): ReactElement => {
  const [burnerSyncStatus, setBurnerSyncStatus] =
    useState<BurnerSyncStatus>('idle')

  const syncFailureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  )

  const burnerLabel = burnerButtonLabel(
    burnerActive,
    burnerOpen,
    burnerShellExists
  )

  const showBurnerSync = Boolean(
    onBurner && onSyncBurner && burnerOpen && burnerOutOfSync
  )

  useEffect(() => {
    if (!showBurnerSync) {
      if (syncFailureTimeoutRef.current) {
        clearTimeout(syncFailureTimeoutRef.current)
        syncFailureTimeoutRef.current = null
      }
      setBurnerSyncStatus('idle')
    }
  }, [showBurnerSync])

  useEffect(() => {
    if (showBurnerSync && !burnerActive && burnerSyncStatus === 'blocked') {
      setBurnerSyncStatus('idle')
    }
  }, [burnerActive, burnerSyncStatus, showBurnerSync])

  useEffect(
    () => (): void => {
      if (syncFailureTimeoutRef.current) {
        clearTimeout(syncFailureTimeoutRef.current)
      }
    },
    []
  )

  const burnerSyncFailed =
    burnerSyncStatus === 'blocked' || burnerSyncStatus === 'failed'

  const burnerSyncLabel = burnerSyncFailed
    ? burnerSyncStatus === 'blocked'
      ? 'stop the running command, then sync pwd'
      : 'sync failed; check burner terminal'
    : burnerSyncStatus === 'syncing'
      ? 'syncing burner terminal'
      : 'sync burner terminal'

  const burnerSyncIcon = burnerSyncFailed ? 'sync_problem' : 'sync'

  const collapseLabel = isCollapsed ? 'expand status' : 'collapse status'

  const burnerButton = onBurner ? (
    <Tooltip content={burnerLabel} placement="bottom" nativeOverlay>
      <IconButton
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
        className={
          burnerActive
            ? 'bg-agent-shell-accent/15 text-agent-shell-accent'
            : showBurnerSync
              ? '!h-5 !w-5 rounded-md bg-primary/10 text-primary hover:bg-primary/15'
              : undefined
        }
      />
    </Tooltip>
  ) : null

  return (
    <>
      {shortcutHint && (
        <span
          data-testid="pane-shortcut-hint"
          className="shrink-0 rounded bg-on-surface/10 px-1.5 py-0.5 font-mono text-[10px] leading-none text-on-surface-variant"
        >
          {shortcutHint}
        </span>
      )}

      {showBurnerSync ? (
        <div
          data-testid="burner-control-pill"
          className="inline-flex h-[22px] shrink-0 items-center gap-px rounded-lg border border-primary/20 bg-primary/10 p-px"
        >
          <Tooltip content={burnerSyncLabel} placement="bottom" nativeOverlay>
            <IconButton
              icon={burnerSyncIcon}
              label={burnerSyncLabel}
              showTooltip={TOOLTIP_SUPPRESSED}
              size="sm"
              className={`!h-5 !w-5 rounded-md ${
                burnerSyncStatus === 'syncing'
                  ? 'animate-spin text-agent-shell-accent'
                  : burnerSyncFailed
                    ? 'bg-error/10 text-error hover:bg-error/15'
                    : 'text-agent-shell-accent hover:bg-agent-shell-accent/15'
              }`}
              onClick={(event) => {
                event.stopPropagation()
                if (syncFailureTimeoutRef.current) {
                  clearTimeout(syncFailureTimeoutRef.current)
                  syncFailureTimeoutRef.current = null
                }
                if (burnerActive) {
                  setBurnerSyncStatus('blocked')

                  return
                }
                setBurnerSyncStatus('syncing')
                onSyncBurner?.()
                syncFailureTimeoutRef.current = setTimeout(() => {
                  syncFailureTimeoutRef.current = null
                  setBurnerSyncStatus('failed')
                }, SYNC_FAILURE_TIMEOUT_MS)
              }}
            />
          </Tooltip>
          {burnerButton}
        </div>
      ) : (
        burnerButton
      )}

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

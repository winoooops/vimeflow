import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { IconButton } from '@/components/IconButton'
import { SegmentedControl } from '@/components/SegmentedControl'
import { Tooltip } from '@/components/Tooltip'
import { chordToShortcutInput } from '@/features/keymap/displayKey'
import { useKeybindings } from '@/features/keymap/useKeybindings'
import { TOOLTIP_SUPPRESSED } from '@/lib/constants'

export type DockTabType = 'editor' | 'diff'

interface DockTabProps {
  tab: DockTabType
  onTabChange: (next: DockTabType) => void
  onClose: () => void
  compactActions?: boolean
  /**
   * Which side the compact actions dropdown opens toward.
   * 'left' = left-docks (opens rightward). 'right' = right-docks (opens leftward).
   * Defaults to 'right'.
   */
  menuAlign?: 'left' | 'right'
  /** Slot rendered between the tab strip spacer and the action cluster. */
  children?: ReactNode
  /** Extra content rendered before the regular controls inside the compact menu. */
  compactMenuLeadingContent?: ReactNode
  /** Whether the compact overflow trigger should show an unread-style dot. */
  hasCompactMenuBadge?: boolean
}

const DOCK_TAB_OPTIONS = [
  {
    value: 'diff',
    label: 'Diff Viewer',
    icon: 'difference',
    tooltip: 'Diff Viewer',
    commandId: 'focus-diff',
  },
  {
    value: 'editor',
    label: 'Editor',
    icon: 'code',
    tooltip: 'Editor',
    commandId: 'focus-editor',
  },
] as const

const tabIconClass = (active: boolean): string =>
  `material-symbols-outlined text-[12px] ${
    active ? 'text-primary-container' : 'text-syn-comment'
  }`

export const DockTab = ({
  tab,
  onTabChange,
  onClose,
  compactActions = false,
  menuAlign = 'right',
  children = undefined,
  compactMenuLeadingContent = undefined,
  hasCompactMenuBadge = false,
}: DockTabProps): ReactElement => {
  const { bindingFor } = useKeybindings()
  const actionsMenuId = useId()
  const [actionsOpen, setActionsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Tracks whether the most recent close was layout-driven (compactActions→false)
  // vs. an explicit user action. Only user-action closes return focus to the trigger
  // (which may be unmounted in a layout-driven close).
  const layoutDrivenCloseRef = useRef(false)

  useEffect(() => {
    if (!actionsOpen) {
      return
    }

    const handleOutsideClick = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setActionsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)

    return (): void => {
      document.removeEventListener('mousedown', handleOutsideClick)
    }
  }, [actionsOpen])

  // Return focus to trigger when the menu closes via a user action.
  // Layout-driven closes (compactActions→false) skip this because the trigger
  // button is unmounted at the same time — triggerRef.current would be null.
  const prevActionsOpenRef = useRef(false)
  useEffect(() => {
    if (
      prevActionsOpenRef.current &&
      !actionsOpen &&
      !layoutDrivenCloseRef.current
    ) {
      triggerRef.current?.focus()
    }
    layoutDrivenCloseRef.current = false
    prevActionsOpenRef.current = actionsOpen
  }, [actionsOpen])

  // Clear actionsOpen when compact menu is no longer rendered.
  useEffect((): void => {
    if (!compactActions) {
      layoutDrivenCloseRef.current = true
      setActionsOpen(false)
      // If the menu was already closed, setActionsOpen is a no-op and the
      // [actionsOpen] effect never fires, so the flag would stay true
      // permanently. Reset it here to avoid blocking the next focus-return.
      layoutDrivenCloseRef.current = false
    }
  }, [compactActions])

  const handleCompactKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') {
      return
    }

    setActionsOpen(false)
  }

  const menuAlignClass = menuAlign === 'left' ? 'left-0' : 'right-0'
  const dockToggleShortcut = chordToShortcutInput(bindingFor('dock-toggle'))

  return (
    <div
      data-testid="dock-tab"
      className="relative flex h-[34px] min-w-0 items-center gap-1 border-b border-outline-variant/25 bg-surface-container-lowest px-2"
      onKeyDown={compactActions ? handleCompactKeyDown : undefined}
      onBlurCapture={
        compactActions
          ? (e): void => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                setActionsOpen(false)
              }
            }
          : undefined
      }
    >
      <SegmentedControl
        aria-label="Dock tab"
        variant="dock"
        value={tab}
        options={DOCK_TAB_OPTIONS.map((option) => ({
          ...option,
          shortcut: chordToShortcutInput(bindingFor(option.commandId)),
        }))}
        onChange={onTabChange}
        buttonClassName={compactActions ? 'w-[30px] px-0' : 'gap-1.5'}
        nativeOverlayTooltips
        renderOption={(option, active) => (
          <>
            <span className={tabIconClass(active)} aria-hidden="true">
              {option.icon}
            </span>
            {!compactActions && <span>{option.label}</span>}
          </>
        )}
      />

      <div className="min-w-0 flex-1" />

      {compactActions ? (
        <div className="relative shrink-0">
          <Tooltip
            content="More dock actions"
            placement="bottom"
            disabled={actionsOpen}
            nativeOverlay
          >
            <IconButton
              ref={triggerRef}
              icon="more_horiz"
              label="More dock actions"
              showTooltip={TOOLTIP_SUPPRESSED}
              aria-expanded={actionsOpen}
              onMouseDown={(e): void => {
                // Stop the document mousedown listener from firing so that
                // onClick is the sole toggle — prevents close→reopen on same click.
                e.stopPropagation()
              }}
              onClick={(): void => setActionsOpen((prev) => !prev)}
              className="h-6 w-6 rounded-[5px] text-[16px] focus:bg-wash-subtle focus:text-primary"
            />
          </Tooltip>
          {hasCompactMenuBadge ? (
            <span
              data-testid="dock-actions-badge"
              aria-hidden="true"
              className="pointer-events-none absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-primary"
            />
          ) : null}

          {actionsOpen && (
            <div
              ref={menuRef}
              id={actionsMenuId}
              data-testid="dock-actions-menu"
              className={`absolute ${menuAlignClass} top-[28px] z-50 flex min-w-[190px] flex-col gap-2 rounded-lg border border-outline-variant/35 bg-surface-container-lowest p-2 shadow-xl`}
              onClick={() => setActionsOpen(false)}
            >
              {compactMenuLeadingContent}
              <div className="flex items-center justify-between gap-2">
                {children}
                <Tooltip
                  content="Collapse panel"
                  shortcut={dockToggleShortcut}
                  placement="bottom"
                  nativeOverlay
                >
                  <IconButton
                    icon="minimize"
                    label="Collapse panel"
                    showTooltip={TOOLTIP_SUPPRESSED}
                    onClick={onClose}
                    className="h-6 w-6 rounded-[5px] text-[14px]"
                  />
                </Tooltip>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {children && <div className="shrink-0">{children}</div>}

          <div className="ml-1 flex shrink-0 items-center">
            <Tooltip
              content="Collapse panel"
              shortcut={dockToggleShortcut}
              placement="bottom"
              nativeOverlay
            >
              <IconButton
                icon="minimize"
                label="Collapse panel"
                showTooltip={TOOLTIP_SUPPRESSED}
                onClick={onClose}
                className="h-6 w-6 rounded-[5px] text-[14px]"
              />
            </Tooltip>
          </div>
        </>
      )}
    </div>
  )
}

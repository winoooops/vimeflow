import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { Tooltip } from '../../../components/Tooltip'

export type DockTabType = 'editor' | 'diff'

interface DockTabProps {
  tab: DockTabType
  onTabChange: (next: DockTabType) => void
  selectedFilePath: string | null
  onClose: () => void
  compactActions?: boolean
  /**
   * Which side the compact actions dropdown opens toward.
   * 'left' = left-docks (opens rightward). 'right' = right-docks (opens leftward).
   * Defaults to 'right'.
   */
  menuAlign?: 'left' | 'right'
  /** Slot rendered between the tab strip spacer and the file-path/close cluster. */
  children?: ReactNode
}

const tabButtonClass = (active: boolean, compact: boolean): string =>
  `flex items-center justify-center font-mono text-[10.5px] h-[26px] rounded-md border transition-colors ${
    compact ? 'w-[30px] px-0' : 'gap-1.5 px-[11px]'
  } ${
    active
      ? 'bg-primary/[0.08] border-primary-container/30 text-primary'
      : 'bg-transparent border-transparent text-on-surface-muted hover:text-primary'
  }`

const tabIconClass = (active: boolean): string =>
  `material-symbols-outlined text-[12px] ${
    active ? 'text-primary-container' : 'text-syn-comment'
  }`

export const DockTab = ({
  tab,
  onTabChange,
  selectedFilePath,
  onClose,
  compactActions = false,
  menuAlign = 'right',
  children = undefined,
}: DockTabProps): ReactElement => {
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

  const displayPath = selectedFilePath
    ? selectedFilePath.replace(/^~\//, '')
    : 'No file'

  const handleCompactKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') {
      return
    }

    setActionsOpen(false)
  }

  const menuAlignClass = menuAlign === 'left' ? 'left-0' : 'right-0'

  return (
    <div
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
      <div className="flex min-w-0 shrink-0 gap-1">
        <Tooltip
          content="Diff Viewer"
          shortcut={['Mod', 'G']}
          placement="bottom"
        >
          <button
            type="button"
            aria-pressed={tab === 'diff'}
            onClick={() => onTabChange('diff')}
            className={tabButtonClass(tab === 'diff', compactActions)}
            aria-label="Diff Viewer"
          >
            <span className={tabIconClass(tab === 'diff')} aria-hidden="true">
              difference
            </span>
            {!compactActions && <span>Diff Viewer</span>}
          </button>
        </Tooltip>

        <Tooltip content="Editor" shortcut={['Mod', 'E']} placement="bottom">
          <button
            type="button"
            aria-pressed={tab === 'editor'}
            onClick={() => onTabChange('editor')}
            className={tabButtonClass(tab === 'editor', compactActions)}
            aria-label="Editor"
          >
            <span className={tabIconClass(tab === 'editor')} aria-hidden="true">
              code
            </span>
            {!compactActions && <span>Editor</span>}
          </button>
        </Tooltip>
      </div>

      <div className="min-w-0 flex-1" />

      {compactActions ? (
        <div className="relative shrink-0">
          <Tooltip
            content="More dock actions"
            placement="bottom"
            disabled={actionsOpen}
          >
            <button
              ref={triggerRef}
              type="button"
              aria-label="More dock actions"
              aria-expanded={actionsOpen}
              onMouseDown={(e): void => {
                // Stop the document mousedown listener from firing so that
                // onClick is the sole toggle — prevents close→reopen on same click.
                e.stopPropagation()
              }}
              onClick={(): void => setActionsOpen((prev) => !prev)}
              className="grid h-6 w-6 cursor-pointer place-items-center rounded-[5px] bg-transparent text-on-surface-muted transition-colors hover:bg-wash-subtle hover:text-primary focus:bg-wash-subtle focus:text-primary focus:outline-none"
            >
              <span
                className="material-symbols-outlined text-[16px]"
                aria-hidden="true"
              >
                more_horiz
              </span>
            </button>
          </Tooltip>

          {actionsOpen && (
            <div
              ref={menuRef}
              id={actionsMenuId}
              data-testid="dock-actions-menu"
              className={`absolute ${menuAlignClass} top-[28px] z-50 flex min-w-[190px] flex-col gap-2 rounded-lg border border-outline-variant/35 bg-surface-container-lowest p-2 shadow-xl`}
              onClick={() => setActionsOpen(false)}
            >
              {/* stopPropagation so clicking the read-only path label does not
                  bubble to the container's onClick and close the menu */}
              <span
                className="max-w-[210px] truncate px-1 font-mono text-[10px] text-outline"
                title={selectedFilePath ?? ''}
                onClick={(e): void => e.stopPropagation()}
              >
                {displayPath}
              </span>

              <div className="flex items-center justify-between gap-2">
                {children}
                <Tooltip
                  content="Collapse panel"
                  shortcut={['Mod', '0']}
                  placement="bottom"
                >
                  <button
                    type="button"
                    aria-label="Collapse panel"
                    onClick={onClose}
                    className="grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-[5px] bg-transparent text-on-surface-muted transition-colors hover:bg-wash-subtle hover:text-primary"
                  >
                    <span
                      className="material-symbols-outlined text-[14px]"
                      aria-hidden="true"
                    >
                      minimize
                    </span>
                  </button>
                </Tooltip>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {children && <div className="shrink-0">{children}</div>}

          <div className="ml-2 flex min-w-0 items-center gap-3">
            <span
              className="min-w-0 max-w-[180px] truncate font-mono text-[10px] text-outline"
              title={selectedFilePath ?? ''}
            >
              {displayPath}
            </span>
            <Tooltip
              content="Collapse panel"
              shortcut={['Mod', '0']}
              placement="bottom"
            >
              <button
                type="button"
                aria-label="Collapse panel"
                onClick={onClose}
                className="grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-[5px] bg-transparent text-on-surface-muted transition-colors hover:bg-wash-subtle hover:text-primary"
              >
                <span
                  className="material-symbols-outlined text-[14px]"
                  aria-hidden="true"
                >
                  minimize
                </span>
              </button>
            </Tooltip>
          </div>
        </>
      )}
    </div>
  )
}

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import type {
  NativeOverlayActionHandler,
  NativeOverlaySessionSwitcherDialogPayload,
} from '@/components/Dialog'
import { Dialog } from '@/components/Dialog'
import { LayoutGlyph } from '../../terminal/components/LayoutSwitcher'
import type { PaneLayoutId } from '../types'

const NATIVE_ACTION_COMMIT_ID_PREFIX = 'session-switcher:commit-id:'
const NATIVE_ACTION_CANCEL = 'session-switcher:cancel'

// Option ids anchor aria-activedescendant and the native commit actions.
const optionDomId = (id: string): string => `session-switcher-option-${id}`

// Stable dialog marker so the owning hook can ignore its own exiting overlay.
export const SESSION_SWITCHER_DIALOG_TEST_ID = 'session-switcher-dialog'

export interface SessionSwitcherEntry {
  id: string
  title: string
  layoutId: PaneLayoutId
  isActive: boolean
}

export interface SessionSwitcherProps {
  open: boolean
  entries: SessionSwitcherEntry[]
  selectedIndex: number
  onCommitIndex: (index: number) => void
  onCancel: () => void
}

// Callback ref: fires when the selected option attaches, keeping it visible.
const scrollSelectedOptionIntoView = (node: HTMLButtonElement | null): void => {
  node?.scrollIntoView({ block: 'nearest' })
}

const ROW_BASE_CLASSES =
  'flex w-full items-center gap-[11px] rounded-[9px] px-[10px] py-2 ' +
  'text-left outline-none transition-colors'

const rowClasses = (selected: boolean): string =>
  selected
    ? `${ROW_BASE_CLASSES} bg-gradient-to-b from-primary/[0.17] to-primary/[0.12]`
    : `${ROW_BASE_CLASSES} hover:bg-on-surface/[0.04]`

const glyphClasses = (selected: boolean): string =>
  selected
    ? 'grid h-[27px] w-[27px] shrink-0 place-items-center rounded-[7px] bg-primary/20 text-primary ring-1 ring-inset ring-primary/20'
    : 'grid h-[27px] w-[27px] shrink-0 place-items-center rounded-[7px] bg-surface-container-high/85 text-on-surface-muted'

const titleClasses = (selected: boolean): string =>
  selected
    ? 'min-w-0 flex-1 truncate font-body text-sm font-medium text-on-surface'
    : 'min-w-0 flex-1 truncate font-body text-sm font-medium text-on-surface-variant'

const LIST_MASK_CLASS =
  '[mask-image:linear-gradient(180deg,transparent_0,black_26px,black_calc(100%-26px),transparent_100%)]'

export const SessionSwitcher = ({
  open,
  entries,
  selectedIndex,
  onCommitIndex,
  onCancel,
}: SessionSwitcherProps): ReactElement | null => {
  const listRef = useRef<HTMLUListElement | null>(null)
  const [listOverflows, setListOverflows] = useState(false)

  useEffect(() => {
    const list = listRef.current
    setListOverflows(list !== null && list.scrollHeight > list.clientHeight)
  }, [entries, open])

  const nativeOverlayPayload =
    useMemo((): NativeOverlaySessionSwitcherDialogPayload => {
      const items = entries.map((entry) => ({
        id: entry.id,
        title: entry.title,
        layoutId: entry.layoutId,
        isActive: entry.isActive,
      }))

      return {
        kind: 'dialog',
        dialog: 'session-switcher',
        ariaLabel: 'Session switcher',
        selectedIndex,
        items,
        actions: {
          commitIdPrefix: NATIVE_ACTION_COMMIT_ID_PREFIX,
          cancel: NATIVE_ACTION_CANCEL,
        },
      }
    }, [entries, selectedIndex])

  // Per-entry commit actions carry the session id across the async overlay
  // boundary; a click on a stale native frame simply finds no handler.
  const nativeOverlayActions = useMemo((): ReadonlyMap<
    string,
    NativeOverlayActionHandler
  > => {
    const handlers = new Map<string, NativeOverlayActionHandler>([
      [NATIVE_ACTION_CANCEL, (): void => onCancel()],
    ])

    entries.forEach((entry) => {
      handlers.set(`${NATIVE_ACTION_COMMIT_ID_PREFIX}${entry.id}`, (): void => {
        const index = entries.findIndex((other) => other.id === entry.id)
        if (index >= 0) {
          onCommitIndex(index)
        }
      })
    })

    return handlers
  }, [entries, onCancel, onCommitIndex])

  const handleOpenChange = useCallback(
    (isOpen: boolean): void => {
      if (!isOpen) {
        onCancel()
      }
    },
    [onCancel]
  )

  const selectedEntry = entries.find((_, index) => index === selectedIndex)

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      placement="top"
      size="sm"
      aria-label="Session switcher"
      testId={SESSION_SWITCHER_DIALOG_TEST_ID}
      // eslint-disable-next-line react/jsx-boolean-value
      restoreFocus={false}
      initialFocusRef={listRef}
      nativeOverlay
      nativeOverlayPayload={nativeOverlayPayload}
      nativeOverlayActions={nativeOverlayActions}
    >
      <div className="flex items-center gap-2.5 border-b border-outline-variant/20 px-4 pb-2.5 pt-3">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-on-surface-muted">
          Switch session
        </span>
        <span className="ml-auto font-mono text-[10px] tracking-[0.06em] text-on-surface-muted/70">
          {entries.length} open
        </span>
      </div>
      <ul
        ref={listRef}
        role="listbox"
        aria-label="Session switcher"
        tabIndex={-1}
        aria-activedescendant={
          selectedEntry === undefined
            ? undefined
            : optionDomId(selectedEntry.id)
        }
        className={`max-h-[min(480px,60vh)] space-y-[2px] overflow-y-auto p-1.5 outline-none ${
          listOverflows ? LIST_MASK_CLASS : ''
        }`}
      >
        {entries.map((entry, index) => (
          <li key={entry.id}>
            <button
              type="button"
              role="option"
              id={optionDomId(entry.id)}
              tabIndex={-1}
              aria-selected={index === selectedIndex}
              ref={
                index === selectedIndex
                  ? scrollSelectedOptionIntoView
                  : undefined
              }
              className={rowClasses(index === selectedIndex)}
              onClick={() => onCommitIndex(index)}
            >
              <span className={glyphClasses(index === selectedIndex)}>
                <LayoutGlyph layoutId={entry.layoutId} />
              </span>
              <span className={titleClasses(index === selectedIndex)}>
                {entry.title}
              </span>
              {entry.isActive && (
                <span className="shrink-0 rounded-full bg-primary/15 px-[7px] py-[2px] font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-primary">
                  active
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}

import { useCallback, useMemo, type ReactElement } from 'react'
import type {
  NativeOverlayActionHandler,
  NativeOverlaySessionSwitcherDialogPayload,
} from '@/components/Dialog'
import { Dialog } from '@/components/Dialog'

const NATIVE_ACTION_COMMIT_INDEX = 'session-switcher:commit-index'
const NATIVE_ACTION_CANCEL = 'session-switcher:cancel'

// Stable dialog marker so the owning hook can ignore its own exiting overlay.
export const SESSION_SWITCHER_DIALOG_TEST_ID = 'session-switcher-dialog'

export interface SessionSwitcherEntry {
  id: string
  title: string
  agentGlyph: string | null
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

export const SessionSwitcher = ({
  open,
  entries,
  selectedIndex,
  onCommitIndex,
  onCancel,
}: SessionSwitcherProps): ReactElement | null => {
  const nativeOverlayPayload =
    useMemo((): NativeOverlaySessionSwitcherDialogPayload => {
      const items = entries.map((entry) => ({
        id: entry.id,
        title: entry.title,
        ...(entry.agentGlyph === null ? {} : { agentGlyph: entry.agentGlyph }),
        isActive: entry.isActive,
      }))

      return {
        kind: 'dialog',
        dialog: 'session-switcher',
        ariaLabel: 'Session switcher',
        selectedIndex,
        items,
        actions: {
          commitIndex: NATIVE_ACTION_COMMIT_INDEX,
          cancel: NATIVE_ACTION_CANCEL,
        },
      }
    }, [entries, selectedIndex])

  const nativeOverlayActions = useMemo(
    (): ReadonlyMap<string, NativeOverlayActionHandler> =>
      new Map([
        [
          NATIVE_ACTION_COMMIT_INDEX,
          (event): void => {
            if (event?.index !== undefined) {
              onCommitIndex(event.index)
            }
          },
        ],
        [NATIVE_ACTION_CANCEL, (): void => onCancel()],
      ]),
    [onCancel, onCommitIndex]
  )

  const handleOpenChange = useCallback(
    (isOpen: boolean): void => {
      if (!isOpen) {
        onCancel()
      }
    },
    [onCancel]
  )

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
      nativeOverlay
      nativeOverlayPayload={nativeOverlayPayload}
      nativeOverlayActions={nativeOverlayActions}
    >
      <ul
        role="listbox"
        aria-label="Session switcher"
        className="max-h-[min(480px,60vh)] overflow-y-auto"
      >
        {entries.map((entry, index) => (
          <li key={entry.id}>
            <button
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              ref={
                index === selectedIndex
                  ? scrollSelectedOptionIntoView
                  : undefined
              }
              className={
                index === selectedIndex
                  ? 'flex w-full items-center gap-2 rounded-md bg-surface-container-high px-3 py-2 text-left font-body text-sm text-on-surface'
                  : 'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left font-body text-sm text-on-surface-muted'
              }
              onClick={() => onCommitIndex(index)}
            >
              <span className="flex-1 truncate">{entry.title}</span>
              {entry.isActive ? (
                <span className="text-xs text-primary">active</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}

import { useCallback, useMemo, type ReactElement } from 'react'
import type {
  NativeOverlayActionHandler,
  NativeOverlaySessionSwitcherDialogPayload,
} from '@/components/Dialog'
import { Dialog } from '@/components/Dialog'

const NATIVE_ACTION_COMMIT_INDEX = 'session-switcher:commit-index'
const NATIVE_ACTION_CANCEL = 'session-switcher:cancel'

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
      nativeOverlay
      nativeOverlayPayload={nativeOverlayPayload}
      nativeOverlayActions={nativeOverlayActions}
    >
      <ul role="listbox" aria-label="Session switcher">
        {entries.map((entry, index) => (
          <li key={entry.id}>
            <button
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
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

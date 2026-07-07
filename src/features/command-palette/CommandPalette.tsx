import { useCallback, useMemo, type ReactElement } from 'react'
import type {
  NativeOverlayActionHandler,
  NativeOverlayCommandPaletteDialogPayload,
} from '@/components/Dialog'
import { Dialog } from '@/components/Dialog'
import { CommandInput } from './components/CommandInput'
import { CommandResults } from './components/CommandResults'
import { CommandFooter } from './components/CommandFooter'
import type { Command, CommandPaletteState } from './registry/types'

export interface CommandPaletteProps {
  state: CommandPaletteState
  filteredResults: Command[]
  clampedSelectedIndex: number
  close: () => void
  setQuery: (query: string) => void
  selectIndex: (index: number) => void
  executeAt: (index: number) => void
}

const getActiveCommand = (
  clampedSelectedIndex: number,
  filteredResults: Command[]
): Command | undefined =>
  clampedSelectedIndex >= 0 ? filteredResults[clampedSelectedIndex] : undefined

// Guards the indexed lookup so a mismatched (clampedSelectedIndex, filteredResults) pair degrades to "no active descendant" instead of crashing — see docs/reviews/patterns/react-lifecycle.md §19.
const getActiveDescendantId = (
  clampedSelectedIndex: number,
  filteredResults: Command[]
): `command-${string}` | undefined => {
  const activeCommand = getActiveCommand(clampedSelectedIndex, filteredResults)

  return activeCommand ? `command-${activeCommand.id}` : undefined
}

const getArgumentPlaceholder = (
  state: CommandPaletteState,
  clampedSelectedIndex: number,
  filteredResults: Command[]
): string | undefined => {
  const activeCommand = getActiveCommand(clampedSelectedIndex, filteredResults)

  if (
    activeCommand?.requiresArgument !== true ||
    activeCommand.argumentPlaceholder === undefined
  ) {
    return undefined
  }

  return state.query.endsWith(' ') &&
    state.query.trimEnd() === activeCommand.label
    ? activeCommand.argumentPlaceholder
    : undefined
}

const DIALOG_CLOSE_ON_ESCAPE = false

const NATIVE_ACTION_SELECT_INDEX = 'command-palette:select-index'
const NATIVE_ACTION_EXECUTE_INDEX = 'command-palette:execute-index'

export const CommandPalette = ({
  state,
  filteredResults,
  clampedSelectedIndex,
  close,
  setQuery,
  selectIndex,
  executeAt,
}: CommandPaletteProps): ReactElement | null => {
  const activeDescendantId = getActiveDescendantId(
    clampedSelectedIndex,
    filteredResults
  )

  const argumentPlaceholder = getArgumentPlaceholder(
    state,
    clampedSelectedIndex,
    filteredResults
  )

  const nativeOverlayPayload =
    useMemo((): NativeOverlayCommandPaletteDialogPayload => {
      const results = filteredResults.map((command) => ({
        id: command.id,
        label: command.label,
        ...(command.description === undefined
          ? {}
          : { description: command.description }),
        ...(command.hint === undefined ? {} : { hint: command.hint }),
        icon: command.icon,
        ...(command.shortcut === undefined
          ? {}
          : { shortcut: command.shortcut }),
      }))

      return {
        kind: 'dialog',
        dialog: 'command-palette',
        ariaLabel: 'Command palette',
        query: state.query,
        selectedIndex: clampedSelectedIndex,
        ...(activeDescendantId === undefined ? {} : { activeDescendantId }),
        ...(argumentPlaceholder === undefined ? {} : { argumentPlaceholder }),
        results,
        actions: {
          selectIndex: NATIVE_ACTION_SELECT_INDEX,
          executeIndex: NATIVE_ACTION_EXECUTE_INDEX,
        },
      }
    }, [
      activeDescendantId,
      argumentPlaceholder,
      clampedSelectedIndex,
      filteredResults,
      state.query,
    ])

  const nativeOverlayActions = useMemo(
    (): ReadonlyMap<string, NativeOverlayActionHandler> =>
      new Map([
        [
          NATIVE_ACTION_SELECT_INDEX,
          {
            retainSession: true,
            run: (event): void => {
              if (event?.index !== undefined) {
                selectIndex(event.index)
              }
            },
          },
        ],
        [
          NATIVE_ACTION_EXECUTE_INDEX,
          {
            retainSession: true,
            run: (event): void => {
              if (event?.index !== undefined) {
                executeAt(event.index)
              }
            },
          },
        ],
      ]),
    [executeAt, selectIndex]
  )

  const handleOpenChange = useCallback(
    (open: boolean): void => {
      if (!open) {
        close()
      }
    },
    [close]
  )

  return (
    <Dialog
      open={state.isOpen}
      onOpenChange={handleOpenChange}
      placement="top"
      size="lg"
      closeOnEscape={DIALOG_CLOSE_ON_ESCAPE}
      aria-label="Command palette"
      backdropTestId="command-palette-backdrop"
      nativeOverlay
      nativeOverlayPayload={nativeOverlayPayload}
      nativeOverlayActions={nativeOverlayActions}
    >
      <CommandInput
        value={state.query}
        onChange={setQuery}
        activeDescendantId={activeDescendantId}
        argumentPlaceholder={argumentPlaceholder}
      />

      <div className="h-px bg-outline-variant/25" />

      <CommandResults
        filteredResults={filteredResults}
        selectedIndex={clampedSelectedIndex}
        onSelect={selectIndex}
        onExecute={executeAt}
      />

      <div className="h-px bg-outline-variant/25" />
      <CommandFooter />
    </Dialog>
  )
}

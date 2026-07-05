import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react'
import { Button } from '@/components/Button'
import {
  Dialog,
  type NativeOverlayActionEvent,
  type NativeOverlayActionHandler,
  type NativeOverlayNewSessionDialogPayload,
} from '@/components/Dialog'
import { IconButton } from '@/components/IconButton'
import type {
  CommandId,
  CreateSessionOptions,
  PaneLayoutId,
} from '@/features/sessions/types'
import { deriveSessionName } from '@/features/sessions/utils/sessionPaths'
import { LayoutSwitcher } from '@/features/terminal/components/LayoutSwitcher'
import {
  gridAreaNameForSlotId,
  type PaneLayoutRegistry,
} from '@/features/terminal/layout-registry'
import { CommandBoard } from './CommandBoard'
import { WorkingDirectoryField } from './WorkingDirectoryField'
import { COMMANDS, COMMAND_ORDER } from './commands'
import { getLastLayout, setLastLayout } from './lastLayoutStore'
import { pickDirectory } from './pickDirectory'

interface NewSessionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (opts: CreateSessionOptions) => void
  defaultCwd: string
  /** Builtin + saved custom layouts available for switching. */
  layoutRegistry: PaneLayoutRegistry
  nativeOverlay?: boolean
}

const DEFAULT_ASSIGN: CommandId[] = ['claude', 'shell', 'shell', 'shell']

const LABEL =
  'text-[10.5px] font-semibold uppercase tracking-[0.08em] text-on-surface-muted'

const TITLE_ID = 'new-session-dialog-title'

const NATIVE_ACTION_FOCUS_NAME = 'new-session:focus-name'
const NATIVE_ACTION_RESET_NAME = 'new-session:reset-name'
const NATIVE_ACTION_BROWSE = 'new-session:browse'
const NATIVE_ACTION_CANCEL = 'new-session:cancel'
const NATIVE_ACTION_CREATE = 'new-session:create'
const NATIVE_ACTION_SELECT_PANE_PREFIX = 'new-session:select-pane:'
const NATIVE_ACTION_PICK_LAYOUT_PREFIX = 'new-session:pick-layout:'
const NATIVE_ACTION_PICK_COMMAND_PREFIX = 'new-session:pick-command:'

export const NewSessionDialog = ({
  open,
  onOpenChange,
  onCreate,
  defaultCwd,
  layoutRegistry,
  nativeOverlay = false,
}: NewSessionDialogProps): ReactElement => {
  const [path, setPath] = useState(defaultCwd)
  const [name, setName] = useState(() => deriveSessionName(defaultCwd))
  const [nameEdited, setNameEdited] = useState(false)
  const [layoutId, setLayoutId] = useState<PaneLayoutId>('single')
  const [assign, setAssign] = useState<CommandId[]>(DEFAULT_ASSIGN)
  // Native overlay renders this dialog in a separate BrowserWindow, so it gets
  // serializable state instead of React children. This index tells that layer
  // which pane's command picker is active.
  const [activeCommandPaneIndex, setActiveCommandPaneIndex] = useState(0)
  const [openMenuCount, setOpenMenuCount] = useState(0)

  const nameInputRef = useRef<HTMLInputElement>(null)
  const defaultCwdRef = useRef(defaultCwd)
  const layoutRegistryRef = useRef(layoutRegistry)
  const wasOpenRef = useRef(open)
  const createdRef = useRef(false)
  // Number of open per-pane command menus. Each menu portals as a sibling of
  // the dialog, so while one is open a backdrop/Esc dismiss must defer to it
  // (the menu consumes the event) rather than closing the dialog. Tracked here
  // — scoped to this dialog's own menus — instead of a global role=menu query.
  const openMenuCountRef = useRef(0)

  defaultCwdRef.current = defaultCwd
  layoutRegistryRef.current = layoutRegistry

  const handleCommandMenuOpenChange = useCallback((menuOpen: boolean): void => {
    const next = Math.max(0, openMenuCountRef.current + (menuOpen ? 1 : -1))
    openMenuCountRef.current = next
    setOpenMenuCount(next)
  }, [])

  // Re-initialize from the latest snapshot each time the dialog opens.
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false

      return
    }

    if (wasOpenRef.current) {
      return
    }

    wasOpenRef.current = true
    createdRef.current = false
    openMenuCountRef.current = 0
    setOpenMenuCount(0)
    setPath(defaultCwdRef.current)
    setName(deriveSessionName(defaultCwdRef.current))
    setNameEdited(false)
    setActiveCommandPaneIndex(0)
    // Default to the layout the user last created with (if it still exists),
    // so they don't re-pick their preferred layout every time.
    // localStorage holds an arbitrary string; getLayout returns null for an
    // unknown/removed id, so the cast is validated before we trust it.
    const savedLayout = getLastLayout() as PaneLayoutId | null
    setLayoutId(
      savedLayout && layoutRegistryRef.current.getLayout(savedLayout)
        ? savedLayout
        : 'single'
    )
    setAssign(DEFAULT_ASSIGN)
  }, [open])

  const layout = layoutRegistry.getFallbackLayout(layoutId)

  useEffect(() => {
    setActiveCommandPaneIndex((current) =>
      Math.min(current, Math.max(0, layout.capacity - 1))
    )
  }, [layout.capacity])

  const applyPath = useCallback(
    (next: string): void => {
      setPath(next)

      if (!nameEdited) {
        setName(deriveSessionName(next))
      }
    },
    [nameEdited]
  )

  const handleOpenNativeDirectoryPicker = useCallback(
    (event?: NativeOverlayActionEvent): void => {
      void (async (): Promise<void> => {
        try {
          const picked = await pickDirectory()

          if (picked !== null) {
            applyPath(picked)
          }
        } finally {
          if (event !== undefined) {
            void window.vimeflow?.nativeOverlay?.resume({
              surfaceId: event.surfaceId,
            })
          }
        }
      })()
    },
    [applyPath]
  )

  const handleCreate = useCallback((): void => {
    const panes = Array.from({ length: layout.capacity }, (_, i) => ({
      command: assign[i] ?? 'shell',
    }))
    createdRef.current = true
    onCreate({
      name: name.trim() || deriveSessionName(path),
      cwd: path,
      layout: layoutId,
      panes,
    })
    setLastLayout(layoutId)
    onOpenChange(false)
  }, [assign, layout.capacity, layoutId, name, onCreate, onOpenChange, path])

  const nativeOverlayPayload = useMemo(
    (): NativeOverlayNewSessionDialogPayload => ({
      kind: 'dialog',
      dialog: 'new-session',
      ariaLabel: 'New session',
      name,
      path,
      nameEdited,
      selectedLayoutId: layoutId,
      activeCommandPaneIndex,
      layouts: layoutRegistry.layouts.map((entry) => ({
        id: entry.id,
        label: entry.name,
        capacity: entry.capacity,
        cols: entry.cols,
        rows: entry.rows,
        areas: entry.areas.map((row) => [...row]),
      })),
      panes: layout.definition.addOrder.map((slotId, index) => ({
        index,
        areaName: gridAreaNameForSlotId(slotId),
        commandId: assign[index] ?? 'shell',
      })),
      commands: COMMAND_ORDER.map((commandId) => {
        const command = COMMANDS[commandId]

        return {
          id: command.id,
          label: command.label,
          accentVar: command.accentVar,
          ...(command.glyph === undefined ? {} : { glyph: command.glyph }),
          ...(command.materialIcon === undefined
            ? {}
            : { materialIcon: command.materialIcon }),
        }
      }),
      actions: {
        focusName: NATIVE_ACTION_FOCUS_NAME,
        resetName: NATIVE_ACTION_RESET_NAME,
        browse: NATIVE_ACTION_BROWSE,
        cancel: NATIVE_ACTION_CANCEL,
        create: NATIVE_ACTION_CREATE,
        selectPanePrefix: NATIVE_ACTION_SELECT_PANE_PREFIX,
        pickLayoutPrefix: NATIVE_ACTION_PICK_LAYOUT_PREFIX,
        pickCommandPrefix: NATIVE_ACTION_PICK_COMMAND_PREFIX,
      },
    }),
    [
      activeCommandPaneIndex,
      assign,
      layout.definition.addOrder,
      layoutId,
      layoutRegistry.layouts,
      name,
      nameEdited,
      path,
    ]
  )

  const nativeOverlayActions = useMemo((): ReadonlyMap<
    string,
    NativeOverlayActionHandler
  > => {
    const actions = new Map<string, NativeOverlayActionHandler>([
      [
        NATIVE_ACTION_FOCUS_NAME,
        {
          retainSession: true,
          run: (): void => {
            nameInputRef.current?.focus()
          },
        },
      ],
      [
        NATIVE_ACTION_RESET_NAME,
        {
          retainSession: true,
          run: (): void => {
            setNameEdited(false)
            setName(deriveSessionName(path))
            nameInputRef.current?.focus()
          },
        },
      ],
      [
        NATIVE_ACTION_BROWSE,
        {
          retainSession: true,
          run: handleOpenNativeDirectoryPicker,
        },
      ],
      [
        NATIVE_ACTION_CANCEL,
        (): void => {
          onOpenChange(false)
        },
      ],
      [NATIVE_ACTION_CREATE, handleCreate],
    ])

    layoutRegistry.layouts.forEach((entry) => {
      actions.set(`${NATIVE_ACTION_PICK_LAYOUT_PREFIX}${entry.id}`, {
        retainSession: true,
        run: (): void => {
          setLayoutId(entry.id)
        },
      })
    })

    layout.definition.addOrder.forEach((_slotId, paneIndex) => {
      actions.set(`${NATIVE_ACTION_SELECT_PANE_PREFIX}${String(paneIndex)}`, {
        retainSession: true,
        run: (): void => {
          setActiveCommandPaneIndex(paneIndex)
        },
      })

      COMMAND_ORDER.forEach((commandId) => {
        actions.set(
          `${NATIVE_ACTION_PICK_COMMAND_PREFIX}${String(
            paneIndex
          )}:${commandId}`,
          {
            retainSession: true,
            run: (): void => {
              setAssign((prev) => {
                const next = [...prev]
                next[paneIndex] = commandId

                return next
              })
            },
          }
        )
      })
    })

    return actions
  }, [
    handleOpenNativeDirectoryPicker,
    handleCreate,
    layout.definition.addOrder,
    layoutRegistry.layouts,
    onOpenChange,
    path,
  ])

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      aria-labelledby={TITLE_ID}
      initialFocusRef={nameInputRef}
      dismissDisabled={openMenuCount > 0}
      restoreFocus={!createdRef.current}
      nativeOverlay={nativeOverlay}
      nativeOverlayPayload={nativeOverlayPayload}
      nativeOverlayActions={nativeOverlayActions}
      panelClassName="flex w-[min(560px,100%)] max-w-[560px] flex-col overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-high/95 shadow-2xl backdrop-blur-md backdrop-saturate-150"
    >
      {/* header */}
      <div className="flex items-center gap-2.5 px-5 pb-1 pt-3.5">
        <span
          className="material-symbols-outlined text-base text-primary-container"
          aria-hidden="true"
        >
          bolt
        </span>
        <span
          id={TITLE_ID}
          className="flex-1 text-[14.5px] font-semibold text-on-surface"
        >
          New session
        </span>
        <IconButton
          icon="close"
          label="Close"
          onClick={() => onOpenChange(false)}
        />
      </div>

      {/* scroll body — fits content, caps + scrolls when tall */}
      <div className="max-h-[min(600px,70vh)] overflow-auto px-5 pb-5 pt-2">
        <label className={LABEL} htmlFor="new-session-name">
          Session name
        </label>
        <div className="mt-2 flex items-center gap-2.5 rounded-[9px] bg-surface-container-lowest px-3 py-2.5">
          <span
            className="material-symbols-outlined text-[15px] text-on-surface-muted"
            aria-hidden="true"
          >
            edit
          </span>
          <input
            ref={nameInputRef}
            id="new-session-name"
            aria-label="Session name"
            // eslint-disable-next-line react/jsx-boolean-value -- false is a meaningful DOM attribute value here, not a prop to omit
            spellCheck={false}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setNameEdited(true)
            }}
            className="flex-1 bg-transparent text-[13px] font-medium text-on-surface outline-none"
          />
          {nameEdited ? (
            <button
              type="button"
              onClick={() => {
                setNameEdited(false)
                setName(deriveSessionName(path))
              }}
              className="rounded-full border border-primary-container/40 px-2 py-0.5 font-mono text-[9.5px] text-primary-container"
            >
              reset
            </button>
          ) : (
            <span className="rounded-full border border-outline-variant/50 px-2 py-0.5 font-mono text-[9.5px] text-on-surface-muted">
              folder name
            </span>
          )}
        </div>

        <label className={`${LABEL} mt-4 block`}>Working directory</label>
        <div className="mt-2">
          <WorkingDirectoryField path={path} onChange={applyPath} />
        </div>

        <div className="mt-4 flex min-h-[232px] items-start gap-4">
          <div className="w-[158px] shrink-0">
            <label className={LABEL}>Layout</label>
            {/* Scroll the list in place rather than hiding presets in
                        an overflow popover — keeps every layout inline. */}
            <div className="mt-2 max-h-[240px] overflow-auto pr-1">
              <LayoutSwitcher
                vertical
                activeLayoutId={layoutId}
                onPick={setLayoutId}
                layouts={layoutRegistry.layouts}
                visibleLayoutIds={layoutRegistry.layouts.map(
                  (entry) => entry.id
                )}
              />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <label className={LABEL}>Starting command</label>
            <div className="mt-0.5 text-[11px] text-on-surface-muted">
              click a panel to choose what it opens with
            </div>
            <div className="mt-2.5">
              <CommandBoard
                layout={layout}
                assign={assign}
                onMenuOpenChange={handleCommandMenuOpenChange}
                onAssign={(i, command) =>
                  setAssign((prev) => {
                    const next = [...prev]
                    next[i] = command

                    return next
                  })
                }
              />
            </div>
          </div>
        </div>
      </div>

      {/* footer */}
      <div className="flex items-center justify-end gap-2.5 bg-surface-container-lowest/40 px-5 py-3.5">
        <Button variant="default" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          variant="flat-primary"
          leadingIcon="bolt"
          onClick={handleCreate}
        >
          Create session
        </Button>
      </div>
    </Dialog>
  )
}

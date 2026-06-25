import { useEffect, useState, type ReactElement } from 'react'
import { Popover } from '@/components/Popover'
import { Button } from '@/components/Button'
import { IconButton } from '@/components/IconButton'
import { LayoutSwitcher } from '@/features/terminal/components/LayoutSwitcher'
import type { PaneLayoutRegistry } from '../../../terminal/layout-registry'
import type { CommandId, CreateSessionOptions, PaneLayoutId } from '../../types'
import { deriveSessionName } from '../../utils/sessionPaths'
import { CommandBoard } from './CommandBoard'
import { WorkingDirectoryField } from './WorkingDirectoryField'

interface NewSessionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (opts: CreateSessionOptions) => void
  defaultCwd: string
  /** The New Session button the popover anchors to. */
  anchorEl: HTMLElement | null
  /** Builtin + saved custom layouts available for switching. */
  layoutRegistry: PaneLayoutRegistry
}

const DEFAULT_ASSIGN: CommandId[] = ['claude', 'shell', 'shell', 'shell']

const LABEL =
  'text-[10.5px] font-semibold uppercase tracking-[0.08em] text-on-surface-muted'

// Keep the popover open while a pane's command Menu is being used: the Menu
// surface portals as a sibling of this dialog, so a press inside it reads as
// "outside" the popover. Dismiss only when the press lands outside any open
// `role="menu"` surface (Menu sets role="menu" via useFloatingSurface/useRole).
const dismissOutsideMenu = (event: MouseEvent): boolean => {
  const target = event.target as Element | null

  return !target?.closest('[role="menu"]')
}

export const NewSessionDialog = ({
  open,
  onOpenChange,
  onCreate,
  defaultCwd,
  anchorEl,
  layoutRegistry,
}: NewSessionDialogProps): ReactElement => {
  const [path, setPath] = useState(defaultCwd)
  const [name, setName] = useState(() => deriveSessionName(defaultCwd))
  const [nameEdited, setNameEdited] = useState(false)
  const [layoutId, setLayoutId] = useState<PaneLayoutId>('single')
  const [assign, setAssign] = useState<CommandId[]>(DEFAULT_ASSIGN)

  // The popover content can stay mounted across open/close, so re-initialize
  // from the latest snapshot each time it opens.
  useEffect(() => {
    if (!open) {
      return
    }

    setPath(defaultCwd)
    setName(deriveSessionName(defaultCwd))
    setNameEdited(false)
    setLayoutId('single')
    setAssign(DEFAULT_ASSIGN)
  }, [open, defaultCwd])

  const layout = layoutRegistry.getFallbackLayout(layoutId)
  const folder = deriveSessionName(path)

  const applyPath = (next: string): void => {
    setPath(next)

    if (!nameEdited) {
      setName(deriveSessionName(next))
    }
  }

  const handleCreate = (): void => {
    const panes = Array.from({ length: layout.capacity }, (_, i) => ({
      command: assign[i] ?? 'shell',
    }))
    onCreate({ name, cwd: path, layout: layoutId, panes })
    onOpenChange(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      anchor={anchorEl}
      placement="bottom-start"
      width={560}
      focus="none"
      dismissWhen={dismissOutsideMenu}
      aria-label="New session"
    >
      {/* Bound the panel to the viewport so the footer (Create session) is
          always visible on short viewports; the body scrolls within. */}
      <div className="flex h-[600px] max-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden">
        {/* header */}
        <div className="flex shrink-0 items-center gap-2.5 border-b border-outline-variant/25 px-5 py-4">
          <span
            className="material-symbols-outlined text-base text-primary-container"
            aria-hidden="true"
          >
            bolt
          </span>
          <span className="flex-1 text-[14.5px] font-semibold text-on-surface">
            New session
          </span>
          <IconButton
            icon="close"
            label="Close"
            onClick={() => onOpenChange(false)}
          />
        </div>

        {/* scroll body */}
        <div className="min-h-0 flex-1 overflow-auto px-5 pb-6 pt-5">
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
              <div className="mt-2">
                <LayoutSwitcher
                  activeLayoutId={layoutId}
                  onPick={setLayoutId}
                  layouts={layoutRegistry.layouts}
                  visibleLayoutIds={layoutRegistry.layouts.map(
                    (entry) => entry.id
                  )}
                  vertical
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
        <div className="flex shrink-0 items-center gap-2.5 border-t border-outline-variant/20 bg-surface-container-lowest/40 px-5 py-3.5">
          <span className="flex-1 font-mono text-[11px] text-on-surface-muted">
            {layout.capacity} pane{layout.capacity > 1 ? 's' : ''} · {folder}
          </span>
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
      </div>
    </Popover>
  )
}

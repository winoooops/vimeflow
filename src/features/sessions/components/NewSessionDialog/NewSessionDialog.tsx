import { useEffect, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
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
  /** The New Session button — the entrance animation originates from it. */
  anchorEl: HTMLElement | null
  /** Builtin + saved custom layouts available for switching. */
  layoutRegistry: PaneLayoutRegistry
}

const DEFAULT_ASSIGN: CommandId[] = ['claude', 'shell', 'shell', 'shell']

const LABEL =
  'text-[10.5px] font-semibold uppercase tracking-[0.08em] text-on-surface-muted'

// A per-pane command Menu portals as a sibling at the same stacking level. While
// one is open, a backdrop/Esc dismiss would otherwise also close the dialog — so
// we let the Menu consume the event and only dismiss the dialog when no menu is
// open (Menu sets role="menu" via useFloatingSurface/useRole).
const isCommandMenuOpen = (): boolean =>
  document.querySelector('[role="menu"]') !== null

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

  // Re-initialize from the latest snapshot each time the dialog opens.
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

  // Esc closes the dialog — unless a command menu is open (it consumes Esc).
  useEffect(() => {
    if (!open) {
      return
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !isCommandMenuOpen()) {
        onOpenChange(false)
      }
    }

    document.addEventListener('keydown', onKeyDown)

    return (): void => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onOpenChange])

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

  const handleBackdropClick = (): void => {
    if (isCommandMenuOpen()) {
      return
    }

    onOpenChange(false)
  }

  // Entrance origin: offset of the New Session button from the viewport centre,
  // so the panel scales out from the button toward the centre.
  const rect = anchorEl?.getBoundingClientRect()

  const origin = rect
    ? {
        x: rect.left + rect.width / 2 - window.innerWidth / 2,
        y: rect.top + rect.height / 2 - window.innerHeight / 2,
      }
    : { x: 0, y: 0 }

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            className="absolute inset-0 bg-surface-container-lowest/40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleBackdropClick}
          />
          <div className="pointer-events-none absolute inset-0 grid place-items-center p-4">
            <motion.div
              role="dialog"
              aria-label="New session"
              className="pointer-events-auto flex w-[min(560px,100%)] flex-col overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-high/95 shadow-2xl backdrop-blur-md backdrop-saturate-150"
              initial={{ opacity: 0, scale: 0.6, x: origin.x, y: origin.y }}
              animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            >
              {/* header */}
              <div className="flex items-center gap-2.5 px-5 pb-1 pt-3.5">
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

                <label className={`${LABEL} mt-4 block`}>
                  Working directory
                </label>
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
              <div className="flex items-center gap-2.5 bg-surface-container-lowest/40 px-5 py-3.5">
                <span className="flex-1 font-mono text-[11px] text-on-surface-muted">
                  {layout.capacity} pane{layout.capacity > 1 ? 's' : ''} ·{' '}
                  {folder}
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
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}

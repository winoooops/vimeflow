import { memo, useState, useRef, useEffect, type ReactElement } from 'react'
import { Reorder } from 'framer-motion'
import type { Session } from '../types'
import { useRenameState } from '../hooks/useRenameState'
import { formatRelativeTime } from '../../agent-status/utils/relativeTime'
import { subtitle } from '../utils/subtitle'
import { LayoutGlyph } from '../../terminal/components/LayoutSwitcher'
import { LAYOUTS } from '../../terminal/components/SplitView/layouts'

export interface CardProps {
  session: Session
  variant: 'active' | 'recent'
  isActive?: boolean
  onClick: (id: string) => void
  onRemove?: (id: string) => void
  onRename?: (id: string, name: string) => void
  reorderMotionEnabled?: boolean
  onReorderDragStart?: () => void
  onReorderDragEnd?: () => void
}

type ReorderItemLayout = true | 'position' | undefined

// Status → flat colored text (no chip pill, no dot), per handoff §3.3.
const STATUS_TEXT: Record<Session['status'], { tone: string; label: string }> =
  {
    running: { tone: '#7defa1', label: 'Running' },
    awaiting: { tone: '#ff94a5', label: 'Awaiting you' },
    idle: { tone: '#8a8299', label: 'Idle' },
    completed: { tone: '#c9b3f0', label: 'Done' },
    errored: { tone: '#ffb4ab', label: 'Errored' },
  }

// Reorder.Item's public type in this Framer version omits `false`, but the
// component forwards `layout` to motion.li where `false` is the supported way
// to keep projection layout disabled. Without an explicit false, Reorder.Item's
// internal default is `layout = true`.
const REORDER_LAYOUT_OFF = false as unknown as ReorderItemLayout
const REORDER_DRAG_INTENT_THRESHOLD_PX = 4

const MenuRow = ({
  icon,
  label,
  danger = false,
  onClick,
}: {
  icon: string
  label: string
  danger?: boolean
  onClick: () => void
}): ReactElement => (
  <button
    type="button"
    onClick={onClick}
    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-label text-[12px] transition-colors ${
      danger
        ? 'text-[#d99aa6] hover:bg-[rgba(255,148,165,0.12)] hover:text-[#ff94a5]'
        : 'text-[#cdc3d1] hover:bg-[rgba(226,199,255,0.1)] hover:text-[#f3eeff]'
    }`}
  >
    <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
      {icon}
    </span>
    {label}
  </button>
)

const CardComponent = ({
  session,
  variant,
  isActive = false,
  onClick,
  onRemove = undefined,
  onRename = undefined,
  reorderMotionEnabled = false,
  onReorderDragStart = undefined,
  onReorderDragEnd = undefined,
}: CardProps): ReactElement => {
  const dragStartPointRef = useRef<{ x: number; y: number } | null>(null)
  const reorderDragIntentActiveRef = useRef(false)

  const {
    isEditing,
    editValue,
    setEditValue,
    inputRef,
    beginEdit,
    commitRename,
    cancelRename,
  } = useRenameState(session, onRename)
  const [menuOpen, setMenuOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const beginReorderDragIntent = (): void => {
    if (reorderDragIntentActiveRef.current) {
      return
    }

    reorderDragIntentActiveRef.current = true
    onReorderDragStart?.()
  }

  const finishReorderDragIntent = (): void => {
    dragStartPointRef.current = null

    if (!reorderDragIntentActiveRef.current) {
      return
    }

    reorderDragIntentActiveRef.current = false
    onReorderDragEnd?.()
  }

  // Close the actions menu on Escape and return focus to the trigger button.
  useEffect(() => {
    if (!menuOpen) {
      return
    }

    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setMenuOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('keydown', handler)

    return (): void => document.removeEventListener('keydown', handler)
  }, [menuOpen])

  const subtitleText = subtitle(session)
  const status = STATUS_TEXT[session.status]

  // Guard against a persisted/stale layout id that is no longer in LAYOUTS so
  // a restored session can't crash the sidebar on the `.name` lookup below.
  const showGlyph =
    session.layout !== 'single' &&
    Object.prototype.hasOwnProperty.call(LAYOUTS, session.layout)

  const ariaLabel = showGlyph
    ? `${session.name} (${LAYOUTS[session.layout].capacity} panes)`
    : session.name
  const hasActions = onRename !== undefined || onRemove !== undefined

  // Flat fill only — no border, no left accent bar, no status dot. Hover and
  // open-menu share the soft fill; active stays lavender.
  const fillClass = isActive
    ? 'bg-[rgba(203,166,247,0.13)]'
    : menuOpen
      ? 'bg-[rgba(255,255,255,0.04)]'
      : 'hover:bg-[rgba(255,255,255,0.04)]'

  const cardClass = `group relative mb-0.5 rounded-[10px] px-3 py-[11px] transition-colors ${
    variant === 'active'
      ? 'cursor-grab active:cursor-grabbing'
      : 'cursor-pointer'
  } ${fillClass}`

  const inner = (
    <>
      {/* Full-row activation button as an absolute background layer. Foreground
          content is pointer-events-none so clicks fall through to it; the kebab
          opts back in as a SIBLING (not nested) so this stays a real <button>
          with no interactive descendants. */}
      <button
        type="button"
        onClick={() => onClick(session.id)}
        aria-label={ariaLabel}
        id={`sidebar-activate-${session.id}`}
        data-role="activate"
        tabIndex={isEditing ? -1 : 0}
        className="absolute inset-0 rounded-[10px] outline-none focus-visible:ring-1 focus-visible:ring-[rgba(203,166,247,0.5)]"
      />

      <div className="pointer-events-none relative flex flex-col">
        {/* Row 1 — title (or inline rename input) */}
        <div className="flex items-center gap-2">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commitRename()
                }
                if (e.key === 'Escape') {
                  cancelRename()
                }
              }}
              aria-label="Rename session"
              className="pointer-events-auto min-w-0 flex-1 truncate rounded bg-surface-container-high px-1 font-label text-[13.5px] font-semibold text-on-surface outline-none ring-1 ring-primary"
            />
          ) : (
            <span
              // Title opts back into pointer events for rename; an explicit
              // onClick re-activates the row because the overlay button is a
              // sibling, not an ancestor, so the click wouldn't otherwise reach
              // it. aria-hidden prevents AT from announcing the name twice —
              // the sibling overlay button already carries aria-label=name.
              aria-hidden="true"
              className="pointer-events-auto min-w-0 flex-1 cursor-pointer truncate font-label text-[13.5px] font-semibold"
              style={{ color: isActive ? '#f3eeff' : '#e3e0f7' }}
              onClick={() => {
                setMenuOpen(false)
                onClick(session.id)
              }}
              onDoubleClick={(e) => {
                if (onRename === undefined) {
                  return
                }
                e.stopPropagation()
                beginEdit()
              }}
            >
              {session.name}
            </span>
          )}
        </div>

        {/* Row 2 — subtitle */}
        {subtitleText !== '' && (
          <div className="mt-1 truncate font-label text-[11.5px] text-[#9a93ab]">
            {subtitleText}
          </div>
        )}

        {/* Row 3 — status text + time + pane-layout glyph */}
        <div className="mt-1.5 flex items-baseline gap-1.5 font-mono text-[10px]">
          <span className="font-semibold" style={{ color: status.tone }}>
            {status.label}
          </span>
          <span className="text-[#6c7086]">
            · {formatRelativeTime(session.lastActivityAt)}
          </span>
          <span className="flex-1" />
          {showGlyph && (
            <span
              data-testid="session-layout-glyph"
              aria-hidden="true"
              title={LAYOUTS[session.layout].name}
              className="inline-flex shrink-0 items-center gap-1"
              style={{ color: isActive ? '#cba6f7' : '#7c7689' }}
            >
              <LayoutGlyph layoutId={session.layout} />
              <span
                data-testid="session-pane-count"
                className="font-mono text-[10px] font-semibold leading-none"
              >
                {LAYOUTS[session.layout].capacity}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Kebab — sibling of the activation button (not nested), absolutely
          positioned so the row height stays constant; revealed on hover/focus
          and kept mounted so keyboard users can reach it. */}
      {hasActions && (
        <div
          className={`pointer-events-auto absolute right-2 top-[7px] opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${
            menuOpen ? 'opacity-100' : ''
          }`}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) {
              setMenuOpen(false)
            }
          }}
        >
          <button
            ref={triggerRef}
            type="button"
            aria-label="Session actions"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((open) => !open)
            }}
            className="grid h-6 w-6 place-items-center rounded-md bg-[rgba(20,20,36,0.55)] text-[#9a93ab] backdrop-blur-sm transition-colors hover:text-[#e2c7ff]"
          >
            <span
              className="material-symbols-outlined text-[16px]"
              aria-hidden="true"
            >
              more_horiz
            </span>
          </button>
          {menuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-7 z-40 min-w-[132px] rounded-[9px] border border-[rgba(74,68,79,0.45)] bg-[#1c1c30] p-1 shadow-[0_10px_28px_rgba(0,0,0,0.45)]"
            >
              {onRename !== undefined && (
                <MenuRow
                  icon="edit"
                  label="Rename"
                  onClick={() => {
                    setMenuOpen(false)
                    beginEdit()
                  }}
                />
              )}
              {onRemove !== undefined && (
                <MenuRow
                  icon="delete"
                  label="Remove"
                  danger
                  onClick={() => {
                    setMenuOpen(false)
                    onRemove(session.id)
                  }}
                />
              )}
            </div>
          )}
        </div>
      )}
    </>
  )

  if (variant === 'active') {
    return (
      <Reorder.Item
        value={session}
        data-testid="session-row"
        data-session-id={session.id}
        data-active={isActive}
        className={cardClass}
        whileDrag={{
          scale: 1.02,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          zIndex: 50,
        }}
        layout={reorderMotionEnabled ? 'position' : REORDER_LAYOUT_OFF}
        onPointerDownCapture={(e) => {
          if (e.button > 0) {
            return
          }

          dragStartPointRef.current = { x: e.clientX, y: e.clientY }
          reorderDragIntentActiveRef.current = false
        }}
        onPointerMoveCapture={(e) => {
          const dragStartPoint = dragStartPointRef.current
          if (dragStartPoint === null || reorderDragIntentActiveRef.current) {
            return
          }

          const distance = Math.hypot(
            e.clientX - dragStartPoint.x,
            e.clientY - dragStartPoint.y
          )
          if (distance < REORDER_DRAG_INTENT_THRESHOLD_PX) {
            return
          }

          beginReorderDragIntent()
        }}
        onPointerUpCapture={() => {
          finishReorderDragIntent()
        }}
        onPointerCancelCapture={() => {
          finishReorderDragIntent()
        }}
        onDragStart={() => {
          beginReorderDragIntent()
        }}
        onDragEnd={() => {
          finishReorderDragIntent()
        }}
      >
        {inner}
      </Reorder.Item>
    )
  }

  return (
    <li
      data-testid="recent-session-row"
      data-session-id={session.id}
      data-active={isActive}
      className={cardClass}
    >
      {inner}
    </li>
  )
}

export const Card = memo(CardComponent)
Card.displayName = 'Card'

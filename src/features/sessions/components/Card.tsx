import { memo, useState, useRef, useEffect, type ReactElement } from 'react'
import { Reorder } from 'framer-motion'
import { IconButton } from '@/components/IconButton'
import { Tooltip } from '@/components/Tooltip'
import { TOOLTIP_SUPPRESSED } from '@/lib/constants'
import type { Session } from '../types'
import { useRenameState } from '../hooks/useRenameState'
import { formatRelativeTime } from '../../agent-status/utils/relativeTime'
import { subtitle } from '../utils/subtitle'
import { LayoutGlyph } from '../../terminal/components/LayoutSwitcher'
import {
  BUILTIN_PANE_LAYOUT_REGISTRY,
  type PaneLayoutRegistry,
} from '../../terminal/layout-registry'

export interface CardProps {
  session: Session
  variant: 'active' | 'recent'
  isActive?: boolean
  onClick: (id: string) => void
  onRemove?: (id: string) => void
  onRename?: (id: string, name: string) => void
  onReorderDragStart?: () => void
  onReorderDragEnd?: () => void
  layoutRegistry?: PaneLayoutRegistry
}

// Status → flat colored text (no chip pill, no dot), per handoff §3.3.
const STATUS_TEXT: Record<Session['status'], { tone: string; label: string }> =
  {
    running: { tone: 'var(--color-success-muted)', label: 'Running' },
    awaiting: { tone: 'var(--color-tertiary)', label: 'Awaiting you' },
    idle: { tone: 'var(--color-on-surface-muted)', label: 'Idle' },
    completed: { tone: 'var(--color-primary-dim)', label: 'Done' },
    errored: { tone: 'var(--color-error)', label: 'Errored' },
  }

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
        ? 'text-tertiary hover:bg-tertiary/12 hover:text-tertiary'
        : 'text-on-surface-variant hover:bg-primary/10 hover:text-on-surface'
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
  onReorderDragStart = undefined,
  onReorderDragEnd = undefined,
  layoutRegistry = BUILTIN_PANE_LAYOUT_REGISTRY,
}: CardProps): ReactElement => {
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
  const menuRef = useRef<HTMLDivElement>(null)

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

  // Close the actions menu when clicking outside the kebab/menu container.
  useEffect(() => {
    if (!menuOpen) {
      return
    }

    const handler = (e: MouseEvent): void => {
      if (
        menuRef.current !== null &&
        !menuRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handler)

    return (): void => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const subtitleText = subtitle(session)
  const status = STATUS_TEXT[session.status]

  const layout = layoutRegistry.getFallbackLayout(session.layout)
  const showGlyph = layout.id !== 'single'

  const ariaLabel = showGlyph
    ? `${session.name} (${layout.capacity} panes)`
    : session.name
  const hasActions = onRename !== undefined || onRemove !== undefined

  // Flat fill only — no border, no left accent bar, no status dot. Hover and
  // open-menu share the soft fill; active stays lavender.
  const fillClass = isActive
    ? 'bg-primary-container/15'
    : menuOpen
      ? 'bg-wash-faint'
      : 'hover:bg-wash-faint'

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
        className="absolute inset-0 rounded-[10px] outline-none focus-visible:ring-1 focus-visible:ring-primary-container/50"
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
              className="pointer-events-auto min-w-0 flex-1 cursor-pointer truncate font-label text-[13.5px] font-semibold text-on-surface"
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
          <div className="mt-1 truncate font-label text-[11.5px] text-on-surface-muted">
            {subtitleText}
          </div>
        )}

        {/* Row 3 — status text + time + pane-layout glyph */}
        <div className="mt-1.5 flex items-baseline gap-1.5 font-mono text-[10px]">
          <span className="font-semibold" style={{ color: status.tone }}>
            {status.label}
          </span>
          <span className="text-syn-comment">
            · {formatRelativeTime(session.lastActivityAt)}
          </span>
          <span className="flex-1" />
          {showGlyph && (
            <Tooltip content={layout.name}>
              <span
                data-testid="session-layout-glyph"
                aria-hidden="true"
                className={`inline-flex shrink-0 items-center gap-1 ${isActive ? 'text-primary-container' : 'text-on-surface-muted'}`}
              >
                <LayoutGlyph
                  layoutId={layout.id}
                  definition={layout.definition}
                />
                <span
                  data-testid="session-pane-count"
                  className="font-mono text-[10px] font-semibold leading-none"
                >
                  {layout.capacity}
                </span>
              </span>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Kebab — sibling of the activation button (not nested), absolutely
          positioned so the row height stays constant; revealed on hover/focus
          and kept mounted so keyboard users can reach it. Suppressed while
          renaming: focusing the input would otherwise reveal it (via
          group-focus-within) right on top of the full-width rename field. */}
      {hasActions && !isEditing && (
        <div
          ref={menuRef}
          className={`pointer-events-auto absolute right-2 top-[7px] opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${
            menuOpen ? 'opacity-100' : ''
          }`}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) {
              setMenuOpen(false)
            }
          }}
        >
          <IconButton
            ref={triggerRef}
            icon="more_horiz"
            label="Session actions"
            size="sm"
            // The inline menu owns the disclosure affordance; a hover tooltip
            // duplicating the label would conflict with it.
            showTooltip={TOOLTIP_SUPPRESSED} // inline menu is the disclosure affordance
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((open) => !open)
            }}
          />
          {menuOpen && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-7 z-40 min-w-[132px] rounded-[9px] border border-outline-variant/45 bg-surface-container-lowest p-1 shadow-[0_10px_28px_color-mix(in_srgb,var(--color-scrim)_45%,transparent)]"
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
          boxShadow: 'var(--shadow-ambient)',
          zIndex: 50,
        }}
        layout="position"
        onDragStart={() => {
          onReorderDragStart?.()
        }}
        onDragEnd={() => {
          onReorderDragEnd?.()
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

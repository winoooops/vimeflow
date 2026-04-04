import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import type { ContextMenuAction } from '../types'

interface ContextMenuProps {
  visible: boolean
  x: number
  y: number
  actions: ContextMenuAction[]
  onClose: () => void
}

/**
 * ContextMenu component for displaying right-click actions.
 */
export const ContextMenu = ({
  visible,
  x,
  y,
  actions,
  onClose,
}: ContextMenuProps): ReactElement | null => {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect((): (() => void) | void => {
    if (!visible) {
      return
    }

    const handleClickOutside = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [visible, onClose])

  if (!visible) {
    return null
  }

  return (
    <div
      ref={menuRef}
      className="fixed bg-surface-container-highest/80 backdrop-blur-[16px] border border-outline-variant/30 rounded-xl py-2 w-48 shadow-2xl z-50"
      style={{ left: `${x}px`, top: `${y}px` }}
      role="menu"
      aria-label="Context menu"
    >
      {actions.map((action, index) => {
        if (action.separator) {
          return (
            <div
              key={`separator-${index}`}
              className="h-px bg-outline-variant/20 my-2"
              role="separator"
            />
          )
        }

        return (
          <button
            key={action.label}
            className={`flex items-center gap-3 px-4 py-2 text-sm w-full text-left cursor-pointer transition-colors ${
              action.variant === 'danger'
                ? 'hover:bg-error/20 text-error'
                : 'hover:bg-surface-bright/50 text-on-surface'
            }`}
            role="menuitem"
            onClick={() => {
              onClose()
            }}
          >
            <span className="material-symbols-outlined text-base" aria-hidden="true">
              {action.icon}
            </span>
            <span>{action.label}</span>
          </button>
        )
      })}
    </div>
  )
}

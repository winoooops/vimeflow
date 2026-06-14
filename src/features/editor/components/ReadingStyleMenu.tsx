import { useEffect, useRef, useState, type ReactElement } from 'react'
import { IconButton } from '@/components/IconButton'
import { READING_STYLES } from '../data/readingStyles'
import { useReadingStyle } from '../hooks/useReadingStyle'

// The gear trigger surfaces its intent via the aria-label and opens a menu, so
// suppress IconButton's built-in tooltip (it would overlap the open menu).
const TRIGGER_TOOLTIP_SUPPRESSED = true

/**
 * The ⚙ reading-style switcher for the dock header (rendered only for markdown
 * files in Reading mode). Picks a persisted reading-style preset; every reading
 * view re-renders together through the shared store in `useReadingStyle`.
 *
 * Names only — the menu intentionally omits per-style numeric details. Hex
 * literals match the surrounding dock chrome (DockTab / ViewModeToggle).
 */
export const ReadingStyleMenu = (): ReactElement => {
  const { styleId, setStyleId } = useReadingStyle()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    const onMouseDown = (event: MouseEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)

    return (): void => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    // Stop clicks from bubbling so the gear works inside DockTab's compact
    // overflow menu, which otherwise closes (and unmounts this) on any click.
    <div
      ref={wrapRef}
      onClick={(event) => event.stopPropagation()}
      className="relative shrink-0"
    >
      <IconButton
        icon="settings"
        label="Reading style"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        showTooltip={!TRIGGER_TOOLTIP_SUPPRESSED}
        className="h-6 w-6 cursor-pointer rounded-[5px] bg-transparent text-[16px] text-on-surface-muted hover:bg-wash-subtle hover:text-primary focus:bg-wash-subtle focus:text-primary focus:outline-none"
      />

      {open && (
        <div
          role="menu"
          aria-label="Reading style"
          data-testid="reading-style-menu"
          className="absolute right-0 top-[28px] z-50 flex min-w-[180px] flex-col gap-0.5 rounded-lg border border-outline-variant/35 bg-surface-container-lowest p-1.5 shadow-xl"
        >
          {READING_STYLES.map((style) => {
            const active = style.id === styleId

            return (
              <button
                key={style.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setStyleId(style.id)
                  setOpen(false)
                }}
                className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left font-label text-[12.5px] transition-colors ${
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-on-surface hover:bg-wash-subtle'
                }`}
              >
                <span
                  className="w-3.5 text-primary-container"
                  aria-hidden="true"
                >
                  {active ? '✓' : ''}
                </span>
                {style.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

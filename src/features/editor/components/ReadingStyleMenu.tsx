import { useEffect, useRef, useState, type ReactElement } from 'react'
import { READING_STYLES } from '../data/readingStyles'
import { useReadingStyle } from '../hooks/useReadingStyle'

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

    const onPointerDown = (event: MouseEvent): void => {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)

    return (): void => {
      document.removeEventListener('mousedown', onPointerDown)
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
      <button
        type="button"
        aria-label="Reading style"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="grid h-6 w-6 cursor-pointer place-items-center rounded-[5px] bg-transparent text-[#8a8299] transition-colors hover:bg-white/5 hover:text-[#e2c7ff] focus:bg-white/5 focus:text-[#e2c7ff] focus:outline-none"
      >
        <span
          className="material-symbols-outlined text-[16px]"
          aria-hidden="true"
        >
          settings
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Reading style"
          data-testid="reading-style-menu"
          className="absolute right-0 top-[28px] z-50 flex min-w-[180px] flex-col gap-0.5 rounded-lg border border-[rgba(74,68,79,0.35)] bg-[#0d0d1c] p-1.5 shadow-xl"
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
                    ? 'bg-[rgba(226,199,255,0.1)] text-[#e2c7ff]'
                    : 'text-on-surface hover:bg-white/5'
                }`}
              >
                <span className="w-3.5 text-[#cba6f7]" aria-hidden="true">
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

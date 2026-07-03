import type { KeyboardEvent, ReactElement, RefObject } from 'react'
import { IconButton } from '@/components/IconButton'

interface DiffSearchPopupProps {
  open: boolean
  fileHeaderVisible: boolean
  query: string
  matchCount: number
  activeOrdinal: number
  confirming: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onQueryChange: (query: string) => void
  /** Enter (1) / Shift+Enter (-1) from the input. Distinct from onStep: the
   * first commit after typing jumps to the already-active match without
   * advancing and hands focus back to the diff so n/p take over; later
   * commits step in the given direction (vim search flow, spec §3). */
  onCommit: (direction: 1 | -1) => void
  onStep: (direction: 1 | -1) => void
  onClose: () => void
}

/**
 * In-pane search popup - #645 unpinned-panel recipe, deliberately
 * NOT the shared Popover (spec §2 primitive-choice + UNIFIED.md exception).
 */
export const DiffSearchPopup = ({
  open,
  fileHeaderVisible,
  query,
  matchCount,
  activeOrdinal,
  confirming,
  inputRef,
  onQueryChange,
  onCommit,
  onStep,
  onClose,
}: DiffSearchPopupProps): ReactElement => {
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      onCommit(event.shiftKey ? -1 : 1)
    }

    if (event.key === 'Escape') {
      event.stopPropagation()
      if (!confirming) {
        onClose()
      }
    }
  }

  const topOffsetClass = fileHeaderVisible ? 'top-10' : 'top-1'

  return (
    <div
      role="search"
      inert={!open}
      className={`absolute right-[22px] ${topOffsetClass} z-30 flex w-[330px] max-w-[calc(100%-24px)] origin-top-right items-center gap-1.5 rounded-2xl border border-outline-variant/30 bg-surface-container-high/70 p-2 shadow-2xl backdrop-blur-[34px] backdrop-brightness-110 backdrop-saturate-[180%] motion-safe:transition-[opacity,transform] motion-safe:duration-200 motion-safe:ease-out ${
        open
          ? 'translate-y-0 scale-100 opacity-100'
          : 'pointer-events-none -translate-y-1.5 scale-[0.92] opacity-0'
      }`}
    >
      <input
        ref={inputRef}
        type="text"
        aria-label="Search in diff"
        placeholder="Search in diff…"
        // eslint-disable-next-line react/jsx-boolean-value -- false is a meaningful DOM attribute value here, not a prop to omit
        spellCheck={false}
        value={query}
        onChange={(event): void => onQueryChange(event.target.value)}
        onKeyDown={handleKeyDown}
        className="min-w-0 flex-1 bg-transparent px-2 py-1 font-mono text-xs text-on-surface outline-none placeholder:text-on-surface-muted"
      />
      <span
        role="status"
        aria-live="polite"
        className="min-w-9 text-right font-mono text-[11px] text-on-surface-muted"
      >
        {query === '' ? '' : `${activeOrdinal}/${matchCount}`}
      </span>
      <span className="h-4 w-px bg-outline-variant/50" aria-hidden="true" />
      <IconButton
        icon="keyboard_arrow_up"
        label="Previous match"
        size="sm"
        onClick={(): void => onStep(-1)}
      />
      <IconButton
        icon="keyboard_arrow_down"
        label="Next match"
        size="sm"
        onClick={(): void => onStep(1)}
      />
      <IconButton
        icon="close"
        label="Close search"
        size="sm"
        onClick={onClose}
      />
    </div>
  )
}

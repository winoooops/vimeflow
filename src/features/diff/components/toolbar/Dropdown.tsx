/* eslint-disable @typescript-eslint/no-restricted-imports -- hand-rolled popover predates the shared floating-surface primitive */
import { useEffect, useRef, useState, type ReactElement } from 'react'
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
} from '@floating-ui/react'
import { Tooltip } from '@/components/Tooltip'

export interface DropdownOption<T extends string | number> {
  value: T
  label: string
  description?: string
}

interface DropdownProps<T extends string | number> {
  label: string
  value: T
  options: readonly DropdownOption<T>[]
  onChange: (next: T) => void
  width?: number
  // Optional leading material-symbol ligature rendered before the value label
  // on the trigger (e.g. `palette` for the theme dropdown). Tinted with the
  // `primary-dim` accent. Omit for a caret-only trigger.
  leadingIcon?: string
}

// Floating-UI portal-rendered popover so the menu escapes Pierre's diff
// stacking context and can't be clipped by the diff pane's overflow:auto.
// Same primitives Tooltip uses (issue #255 fix for popover-under-diff bug).
export const Dropdown = <T extends string | number>({
  label,
  value,
  options,
  onChange,
  width = 200,
  leadingIcon = undefined,
}: DropdownProps<T>): ReactElement => {
  const [open, setOpen] = useState(false)
  const current = options.find((option) => option.value === value)

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  )

  const [activeIndex, setActiveIndex] = useState<number | null>(selectedIndex)
  const listRef = useRef<(HTMLButtonElement | null)[]>([])

  const handleOpenChange = (nextOpen: boolean): void => {
    setOpen(nextOpen)
    setActiveIndex(nextOpen ? selectedIndex : null)
  }

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: handleOpenChange,
    placement: 'bottom-start',
    middleware: [offset(4), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })
  // Close when any ancestor scrolls — the diff pane is `overflow: auto`,
  // so scrolling there would leave the portal-rendered popover floating
  // away from its trigger (PR1 QA finding).
  const dismiss = useDismiss(context, { ancestorScroll: true })
  const role = useRole(context, { role: 'menu' })

  const listNavigation = useListNavigation(context, {
    activeIndex,
    focusItemOnOpen: true,
    listRef,
    loop: true,
    onNavigate: setActiveIndex,
  })

  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions(
    [dismiss, role, listNavigation]
  )

  useEffect(() => {
    if (!open || activeIndex === null) {
      return
    }

    listRef.current[activeIndex]?.focus()
  }, [activeIndex, open])

  const selectOption = (next: T): void => {
    onChange(next)
    handleOpenChange(false)
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-on-surface-variant text-[0.7rem] uppercase tracking-wider font-label">
        {label}
      </span>
      <Tooltip content={current?.label ?? String(value)}>
        <button
          ref={refs.setReference}
          type="button"
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-surface-container-high/60 hover:bg-surface-container-highest/80 text-on-surface text-xs font-medium transition-colors min-w-[6rem] justify-between"
          {...getReferenceProps({
            onClick: (): void => handleOpenChange(!open),
          })}
        >
          {leadingIcon !== undefined ? (
            <span
              aria-hidden="true"
              className="material-symbols-outlined text-[15px] leading-none text-primary-dim shrink-0"
            >
              {leadingIcon}
            </span>
          ) : null}
          <span className="truncate max-w-[7rem]">
            {current?.label ?? String(value)}
          </span>
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-sm leading-none shrink-0"
          >
            expand_more
          </span>
        </button>
      </Tooltip>
      {open ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{ ...floatingStyles, width }}
            className="z-50 rounded-lg bg-surface-container-high/95 backdrop-blur-md backdrop-saturate-150 border border-outline-variant/20 shadow-xl py-1 max-h-72 overflow-auto"
            {...getFloatingProps()}
          >
            {options.map((option, index) => (
              <button
                key={String(option.value)}
                ref={(node): void => {
                  listRef.current[index] = node
                }}
                type="button"
                role="menuitem"
                tabIndex={activeIndex === index ? 0 : -1}
                className={`w-full text-left px-3 py-1.5 hover:bg-surface-container-highest transition-colors ${
                  option.value === value ? 'text-primary' : 'text-on-surface'
                }`}
                {...getItemProps({
                  onClick: (): void => selectOption(option.value),
                })}
              >
                <div className="text-xs font-medium">{option.label}</div>
                {option.description ? (
                  <div className="text-on-surface-variant text-[0.65rem] mt-0.5 leading-tight">
                    {option.description}
                  </div>
                ) : null}
              </button>
            ))}
          </div>
        </FloatingPortal>
      ) : null}
    </span>
  )
}

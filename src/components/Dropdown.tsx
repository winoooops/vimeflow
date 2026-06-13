import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Tooltip } from '@/components/Tooltip'
import { useFloatingSurface } from '@/components/base/floating/useFloatingSurface'
import { SurfacePanel } from '@/components/base/floating/SurfacePanel'
import { OptionList, type DropdownOption } from '@/components/base/OptionList'
import { type Placement } from '@/components/base/floating/glassSurface'

// Re-exported so features type their options via @/components/Dropdown and never
// reach into the package-private @/components/base/* (ring 2).
export type { DropdownOption } from '@/components/base/OptionList'

interface DropdownTriggerArgs<T extends string | number> {
  ref: (node: HTMLElement | null) => void
  props: Record<string, unknown>
  open: boolean
  current: DropdownOption<T> | undefined
}

interface DropdownProps<T extends string | number> {
  value: T
  options: readonly DropdownOption<T>[]
  onChange: (next: T) => void
  placement?: Placement
  width?: number
  // Built-in select trigger label; rendered as an uppercase caption before the
  // trigger. Omit when supplying a `renderTrigger`.
  label?: string
  // Optional leading material-symbol ligature rendered before the value label
  // on the built-in trigger (e.g. `palette`). Tinted with `primary-dim`.
  leadingIcon?: string
  // Replace the built-in trigger entirely. Receives the reference ref + props
  // to spread, plus open/current so the consumer can reflect selection state.
  renderTrigger?: (args: DropdownTriggerArgs<T>) => ReactElement
}

// Public select on the floating substrate: a trigger anchors a portal-rendered,
// glass-chromed option list (role="menu"/menuitem, preserved from the diff
// toolbar). Composes useFloatingSurface (positioning + dismiss + list-nav) +
// SurfacePanel (portal + chrome) + OptionList (rows). Features import this, not
// @floating-ui or base/*.
export const Dropdown = <T extends string | number>({
  value,
  options,
  onChange,
  placement = 'bottom-start',
  width = 200,
  label = undefined,
  leadingIcon = undefined,
  renderTrigger = undefined,
}: DropdownProps<T>): ReactElement => {
  const [open, setOpen] = useState(false)
  const current = options.find((option) => option.value === value)

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  )

  const [activeIndex, setActiveIndex] = useState<number | null>(selectedIndex)
  const listRef = useRef<(HTMLElement | null)[]>([])

  const handleOpenChange = (nextOpen: boolean): void => {
    setOpen(nextOpen)
    setActiveIndex(nextOpen ? selectedIndex : null)
  }

  const {
    refs,
    floatingStyles,
    context,
    getReferenceProps,
    getFloatingProps,
    getItemProps,
  } = useFloatingSurface({
    open,
    onOpenChange: handleOpenChange,
    placement,
    role: 'menu',
    list: {
      ref: listRef,
      activeIndex,
      onNavigate: setActiveIndex,
      loop: true,
      focusItemOnOpen: true,
    },
  })

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

  const triggerProps = getReferenceProps({
    onClick: (): void => handleOpenChange(!open),
  })

  return (
    <span className="inline-flex items-center gap-2">
      {renderTrigger !== undefined ? (
        renderTrigger({
          ref: refs.setReference,
          props: triggerProps,
          open,
          current,
        })
      ) : (
        <>
          {label !== undefined ? (
            <span className="text-on-surface-variant text-[0.7rem] uppercase tracking-wider font-label">
              {label}
            </span>
          ) : null}
          <Tooltip content={current?.label ?? String(value)}>
            <button
              ref={refs.setReference}
              type="button"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-surface-container-high/60 hover:bg-surface-container-highest/80 text-on-surface text-xs font-medium transition-colors min-w-[6rem] justify-between"
              {...triggerProps}
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
        </>
      )}
      {open ? (
        <SurfacePanel
          setFloating={refs.setFloating}
          style={floatingStyles}
          context={context}
          width={width}
          {...getFloatingProps()}
        >
          <div className="py-1 max-h-72 overflow-auto">
            <OptionList
              options={options}
              value={value}
              onSelect={selectOption}
              getItemProps={getItemProps}
              registerItem={(index, node): void => {
                listRef.current[index] = node
              }}
            />
          </div>
        </SurfacePanel>
      ) : null}
    </span>
  )
}

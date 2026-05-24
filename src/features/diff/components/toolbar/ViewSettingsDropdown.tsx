import {
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react'
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react'
import type { BaseDiffOptions } from '@pierre/diffs'
import type { DropdownOption } from './Dropdown'

// Pierre option subtypes — same pattern as DiffChipToolbar.tsx so a Pierre
// version bump that widens / renames the enums is caught at type-check time.
type DiffIndicators = NonNullable<BaseDiffOptions['diffIndicators']>
type Overflow = NonNullable<BaseDiffOptions['overflow']>

// Hardcoded enum lists for the nested sub-dropdowns. Mirrors the same
// constants that DiffChipToolbar.tsx used to host before consolidation —
// they moved here because ViewSettingsDropdown is now the only consumer.
const INDICATOR_OPTIONS: readonly DropdownOption<DiffIndicators>[] = [
  { value: 'classic', label: 'classic', description: 'Plus and minus glyphs' },
  { value: 'bars', label: 'bars', description: 'Colored gutter bars' },
  { value: 'none', label: 'none', description: 'No indicator column' },
]

const OVERFLOW_OPTIONS: readonly DropdownOption<Overflow>[] = [
  {
    value: 'scroll',
    label: 'scroll',
    description: 'Horizontal scroll for long lines',
  },
  {
    value: 'wrap',
    label: 'wrap',
    description: 'Soft-wrap long lines to next row',
  },
]

export interface ViewSettingsDropdownProps {
  diffIndicators: DiffIndicators
  onDiffIndicatorsChange: (next: DiffIndicators) => void
  overflow: Overflow
  onOverflowChange: (next: Overflow) => void
  disableLineNumbers: boolean
  onDisableLineNumbersChange: (next: boolean) => void
  disableBackground: boolean
  onDisableBackgroundChange: (next: boolean) => void
  disableFileHeader: boolean
  onDisableFileHeaderChange: (next: boolean) => void
  stickyHeader: boolean
  onStickyHeaderChange: (next: boolean) => void
}

// Sub-menu identifier — only one nested sub-dropdown can be open at a time
// (the spec implies this; opening Overflow while Indicators is open would
// require two floating popovers anchored to the same parent which gets
// visually crowded). `null` means no sub-menu is open.
type OpenSubMenu = 'indicators' | 'overflow' | null

interface RowProps {
  icon: string
  label: string
  right: ReactNode
  onClick: () => void
  // Pass-through to floating-UI's `refs.setReference` so a Format row can
  // act as the anchor for its nested sub-dropdown. Required so consumers
  // always explicitly opt in / out — checkbox rows pass `null`.
  setReference: ((node: HTMLElement | null) => void) | null
  // floating-UI interaction props (onClick / aria-haspopup / etc) that
  // wire the row up to its sub-dropdown's open state. Pass an empty
  // object for plain checkbox rows.
  referenceProps: Record<string, unknown>
  ariaExpanded?: boolean
  ariaPressed?: boolean
}

// Single row in the popover. Used by both Format rows (nested-selector value
// on the right) and View Options rows (checkbox on the right). The row is a
// button so keyboard activation Just Works without a separate `onKeyDown`
// handler, and the icon is `aria-hidden` because the visible label already
// carries the accessible name.
const Row = ({
  icon,
  label,
  right,
  onClick,
  setReference,
  referenceProps,
  ariaExpanded = undefined,
  ariaPressed = undefined,
}: RowProps): ReactElement => (
  <button
    ref={setReference ?? undefined}
    type="button"
    onClick={onClick}
    aria-expanded={ariaExpanded}
    aria-pressed={ariaPressed}
    className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md hover:bg-surface-container-highest/50 text-xs transition-colors"
    {...referenceProps}
  >
    <span className="flex items-center gap-2.5 text-on-surface">
      <span
        aria-hidden="true"
        className="material-symbols-outlined text-base leading-none opacity-70"
      >
        {icon}
      </span>
      {label}
    </span>
    {right}
  </button>
)

// Checkbox indicator — the 18×18 rounded square on the right side of each
// boolean row. Checked uses `bg-primary text-on-primary` with a `check`
// glyph; unchecked is a transparent square with a thin outline-variant
// border. Material Symbols use a bolder font-variation-axis weight to
// match the mockup's check stroke.
const CheckIndicator = ({ checked }: { checked: boolean }): ReactElement => (
  <span
    aria-hidden="true"
    className={
      'inline-flex items-center justify-center w-[18px] h-[18px] rounded-[4px] flex-shrink-0 ' +
      (checked
        ? 'bg-primary text-on-primary'
        : 'bg-transparent border-[1.5px] border-on-surface-variant/30')
    }
    style={checked ? { fontVariationSettings: '"wght" 700' } : undefined}
  >
    {checked ? (
      <span className="material-symbols-outlined text-[14px] leading-none">
        check
      </span>
    ) : null}
  </span>
)

// Nested sub-dropdown popover body. Renders a list of options anchored to
// the parent row via `useFloating`. Each option fires `onChange(value)`
// and the parent closes the sub-menu by setting `openSubMenu` back to null.
const SubDropdownPopover = <T extends string>({
  setFloating,
  floatingStyles,
  floatingProps,
  options,
  value,
  onSelect,
}: {
  setFloating: (node: HTMLElement | null) => void
  floatingStyles: CSSProperties
  floatingProps: Record<string, unknown>
  options: readonly DropdownOption<T>[]
  value: T
  onSelect: (next: T) => void
}): ReactElement => (
  <div
    ref={setFloating}
    style={{ ...floatingStyles, width: 220 }}
    className="z-50 rounded-lg bg-surface-container-high/95 backdrop-blur-md backdrop-saturate-150 border border-outline-variant/20 shadow-xl py-1 max-h-72 overflow-auto"
    {...floatingProps}
  >
    {options.map((option) => (
      <button
        key={String(option.value)}
        type="button"
        role="menuitem"
        onClick={(): void => onSelect(option.value)}
        className={`w-full text-left px-3 py-1.5 hover:bg-surface-container-highest transition-colors ${
          option.value === value ? 'text-primary' : 'text-on-surface'
        }`}
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
)

// Consolidated "View ▾" gear chip with a portal-rendered popover containing
// the 2 Format selectors (Indicators / Overflow) and the 4 View Options
// checkbox rows. Replaces 6 separate chips in DiffChipToolbar so the
// toolbar is materially shorter and the 4 boolean toggles no longer stack
// as a wall of lavender pills in the Priority+ overflow menu.
//
// Two layers of floating-UI popovers:
//   - Outer: triggered by the View ▾ chip, hosts the menu body.
//   - Inner (×2): triggered by a Format row, hosts the value list.
// Only one inner popover is open at a time (`openSubMenu`) so the user
// can't get visually crowded with two anchored popovers at the same
// scope. Outer dismisses on outside click EXCEPT when the click lands
// inside one of the inner popovers — that case closes the inner only.
export const ViewSettingsDropdown = ({
  diffIndicators,
  onDiffIndicatorsChange,
  overflow,
  onOverflowChange,
  disableLineNumbers,
  onDisableLineNumbersChange,
  disableBackground,
  onDisableBackgroundChange,
  disableFileHeader,
  onDisableFileHeaderChange,
  stickyHeader,
  onStickyHeaderChange,
}: ViewSettingsDropdownProps): ReactElement => {
  const [open, setOpen] = useState(false)
  const [openSubMenu, setOpenSubMenu] = useState<OpenSubMenu>(null)

  // Outer popover anchored to the View ▾ chip.
  const {
    refs: outerRefs,
    floatingStyles: outerStyles,
    context: outerContext,
  } = useFloating({
    open,
    onOpenChange: (nextOpen): void => {
      setOpen(nextOpen)
      if (!nextOpen) {
        setOpenSubMenu(null)
      }
    },
    placement: 'bottom-end',
    middleware: [offset(4), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })

  // Outer dismiss: clicks outside close the View popover, BUT clicks inside
  // one of the inner sub-dropdown popovers must NOT close the outer (those
  // popovers are portal-mounted siblings of the outer in document.body, so
  // floating-UI's default outsidePress check sees them as "outside"). The
  // closes-on-outside-click logic is namespaced via a data attribute on
  // each sub-menu's root so we can identify it from the event target.
  const outerDismiss = useDismiss(outerContext, {
    outsidePress: (event): boolean => {
      const target = event.target as Element | null
      if (target?.closest('[data-view-sub-menu]')) {
        return false
      }

      return true
    },
    // Close on ancestor scroll so the portal-mounted popover doesn't
    // float away from its trigger when the diff body scrolls (PR1 QA
    // observed: scrolling left the menu stuck in mid-air).
    ancestorScroll: true,
  })
  const outerRole = useRole(outerContext, { role: 'menu' })

  const {
    getReferenceProps: getOuterReferenceProps,
    getFloatingProps: getOuterFloatingProps,
  } = useInteractions([outerDismiss, outerRole])

  // Indicators sub-dropdown.
  const indicatorsOpen = openSubMenu === 'indicators'

  const {
    refs: indicatorsRefs,
    floatingStyles: indicatorsStyles,
    context: indicatorsContext,
  } = useFloating({
    open: indicatorsOpen,
    onOpenChange: (nextOpen): void => {
      setOpenSubMenu(nextOpen ? 'indicators' : null)
    },
    placement: 'bottom-start',
    middleware: [offset(4), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })

  const indicatorsDismiss = useDismiss(indicatorsContext, {
    ancestorScroll: true,
  })
  const indicatorsRole = useRole(indicatorsContext, { role: 'menu' })

  const {
    getReferenceProps: getIndicatorsReferenceProps,
    getFloatingProps: getIndicatorsFloatingProps,
  } = useInteractions([indicatorsDismiss, indicatorsRole])

  // Overflow sub-dropdown.
  const overflowOpen = openSubMenu === 'overflow'

  const {
    refs: overflowRefs,
    floatingStyles: overflowStyles,
    context: overflowContext,
  } = useFloating({
    open: overflowOpen,
    onOpenChange: (nextOpen): void => {
      setOpenSubMenu(nextOpen ? 'overflow' : null)
    },
    placement: 'bottom-start',
    middleware: [offset(4), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })

  const overflowDismiss = useDismiss(overflowContext, {
    ancestorScroll: true,
  })
  const overflowRole = useRole(overflowContext, { role: 'menu' })

  const {
    getReferenceProps: getOverflowReferenceProps,
    getFloatingProps: getOverflowFloatingProps,
  } = useInteractions([overflowDismiss, overflowRole])

  const currentIndicator = INDICATOR_OPTIONS.find(
    (option) => option.value === diffIndicators
  )

  const currentOverflow = OVERFLOW_OPTIONS.find(
    (option) => option.value === overflow
  )

  const handleRowToggle = (subMenu: 'indicators' | 'overflow'): void => {
    setOpenSubMenu((previous) => (previous === subMenu ? null : subMenu))
  }

  return (
    <span className="inline-flex items-center">
      <button
        ref={outerRefs.setReference}
        type="button"
        aria-label="View settings"
        onClick={(): void => {
          setOpen((previous) => {
            const next = !previous
            if (!next) {
              setOpenSubMenu(null)
            }

            return next
          })
        }}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-surface-container-high/60 hover:bg-surface-container-highest/80 text-on-surface text-xs font-medium transition-colors"
        {...getOuterReferenceProps()}
      >
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-base leading-none opacity-70"
        >
          tune
        </span>
        View
        <span
          aria-hidden="true"
          className="material-symbols-outlined text-sm leading-none"
        >
          expand_more
        </span>
      </button>
      {open ? (
        <FloatingPortal>
          <div
            ref={outerRefs.setFloating}
            style={{ ...outerStyles, width: 320 }}
            className="z-50 rounded-lg bg-surface-container-high/95 backdrop-blur-md backdrop-saturate-150 border border-outline-variant/20 shadow-xl p-3"
            {...getOuterFloatingProps()}
          >
            <section aria-labelledby="view-settings-format">
              <h3
                id="view-settings-format"
                className="text-[0.65rem] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5"
              >
                Format
              </h3>
              <Row
                icon="flag"
                label="Indicators"
                ariaExpanded={indicatorsOpen}
                setReference={indicatorsRefs.setReference}
                referenceProps={getIndicatorsReferenceProps()}
                onClick={(): void => handleRowToggle('indicators')}
                right={
                  <span className="inline-flex items-center gap-1 text-[11px] text-on-surface-variant">
                    {currentIndicator?.label ?? String(diffIndicators)}
                    <span
                      aria-hidden="true"
                      className="material-symbols-outlined text-base leading-none"
                    >
                      expand_more
                    </span>
                  </span>
                }
              />
              <Row
                icon="wrap_text"
                label="Overflow"
                ariaExpanded={overflowOpen}
                setReference={overflowRefs.setReference}
                referenceProps={getOverflowReferenceProps()}
                onClick={(): void => handleRowToggle('overflow')}
                right={
                  <span className="inline-flex items-center gap-1 text-[11px] text-on-surface-variant">
                    {currentOverflow?.label ?? String(overflow)}
                    <span
                      aria-hidden="true"
                      className="material-symbols-outlined text-base leading-none"
                    >
                      expand_more
                    </span>
                  </span>
                }
              />
            </section>

            <section aria-labelledby="view-settings-options" className="mt-3.5">
              <h3
                id="view-settings-options"
                className="text-[0.65rem] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5"
              >
                View options
              </h3>
              <Row
                icon="123"
                label="Line numbers"
                ariaPressed={!disableLineNumbers}
                setReference={null}
                referenceProps={{}}
                onClick={(): void =>
                  onDisableLineNumbersChange(!disableLineNumbers)
                }
                right={<CheckIndicator checked={!disableLineNumbers} />}
              />
              <Row
                icon="format_paint"
                label="Background tint"
                ariaPressed={!disableBackground}
                setReference={null}
                referenceProps={{}}
                onClick={(): void =>
                  onDisableBackgroundChange(!disableBackground)
                }
                right={<CheckIndicator checked={!disableBackground} />}
              />
              <Row
                icon="description"
                label="File header"
                ariaPressed={!disableFileHeader}
                setReference={null}
                referenceProps={{}}
                onClick={(): void =>
                  onDisableFileHeaderChange(!disableFileHeader)
                }
                right={<CheckIndicator checked={!disableFileHeader} />}
              />
              <Row
                icon="push_pin"
                label="Sticky header"
                ariaPressed={stickyHeader}
                setReference={null}
                referenceProps={{}}
                onClick={(): void => onStickyHeaderChange(!stickyHeader)}
                right={<CheckIndicator checked={stickyHeader} />}
              />
            </section>
          </div>
        </FloatingPortal>
      ) : null}
      {indicatorsOpen ? (
        <FloatingPortal>
          <div data-view-sub-menu="indicators">
            <SubDropdownPopover
              setFloating={indicatorsRefs.setFloating}
              floatingStyles={indicatorsStyles}
              floatingProps={getIndicatorsFloatingProps()}
              options={INDICATOR_OPTIONS}
              value={diffIndicators}
              onSelect={(next): void => {
                onDiffIndicatorsChange(next)
                setOpenSubMenu(null)
              }}
            />
          </div>
        </FloatingPortal>
      ) : null}
      {overflowOpen ? (
        <FloatingPortal>
          <div data-view-sub-menu="overflow">
            <SubDropdownPopover
              setFloating={overflowRefs.setFloating}
              floatingStyles={overflowStyles}
              floatingProps={getOverflowFloatingProps()}
              options={OVERFLOW_OPTIONS}
              value={overflow}
              onSelect={(next): void => {
                onOverflowChange(next)
                setOpenSubMenu(null)
              }}
            />
          </div>
        </FloatingPortal>
      ) : null}
    </span>
  )
}

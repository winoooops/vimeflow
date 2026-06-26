import {
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLProps,
  type MouseEvent as ReactMouseEvent,
  type MouseEventHandler,
  type KeyboardEventHandler,
  type MutableRefObject,
  type ReactElement,
  type ReactNode,
} from 'react'
import { Tooltip } from '@/components/Tooltip'
import { useFloatingSurface } from '@/components/base/floating/useFloatingSurface'
import { SurfacePanel } from '@/components/base/floating/SurfacePanel'
import {
  FloatingList,
  useListItem,
  useMergeRefs,
} from '@/components/base/floating/list'
import { OptionList, type DropdownOption } from '@/components/base/OptionList'
import { type Placement } from '@/components/base/floating/glassSurface'
import { formatShortcut, type ShortcutInput } from '../lib/formatShortcut'

// The state every menu row needs from its parent Menu/Menu.Context. Shared via
// React context so subparts (Item/Checkbox/Submenu/Section) compose in without
// the parent threading props through, keeping Menu's public surface narrow.
interface MenuContextValue {
  getItemProps: (props?: HTMLProps<HTMLElement>) => Record<string, unknown>
  activeIndex: number | null
  // Reports a row's disabled flag at its FloatingList index so the parent's
  // disabledIndices (fed to useListNavigation) skips it. Index comes from
  // useListItem, so it stays correct as rows are added/removed while open.
  setRowDisabled: (index: number, disabled: boolean) => void
  // Drops a row's tracked entry on unmount (or index shift) so the map stays dense.
  clearRow: (index: number) => void
  close: () => void
  // One-open-submenu coordination owned by the parent Menu.
  openSubmenuId: string | null
  setOpenSubmenu: (id: string | null) => void
}

// Marks each submenu's portal root so the parent Menu's outside-press predicate
// can tell "inside a submenu" from "truly outside" — the submenu panels are
// portal siblings of the parent panel, so a press inside one would otherwise
// read as outside the parent. Ported from ViewSettingsDropdown's
// [data-view-sub-menu] predicate.
const SUBMENU_ROOT_ATTR = 'data-menu-submenu'

const MenuContext = createContext<MenuContextValue | null>(null)

const useMenuContext = (): MenuContextValue => {
  const ctx = useContext(MenuContext)
  if (ctx === null) {
    throw new Error('Menu subparts must render inside a <Menu>')
  }

  return ctx
}

const MENU_BODY_CLASSES = 'py-1 min-w-52 max-h-[28rem] overflow-auto'

const CONTEXT_MENU_SURFACE_CLASSES =
  'z-50 overflow-hidden rounded-md border border-outline-variant/30 bg-surface-container-high shadow-lg outline-none focus:outline-none focus-visible:outline-none'

const CONTEXT_MENU_BODY_CLASSES = 'min-w-0 max-h-[28rem] overflow-auto'

const SECTION_HEADER_CLASSES =
  'text-[0.65rem] font-bold uppercase tracking-wider text-on-surface-variant px-2.5 pt-2 pb-1'

const ITEM_CLASSES =
  'flex min-h-8 w-full items-center justify-between gap-6 rounded px-2.5 py-1.5 ' +
  'text-left text-xs text-on-surface outline-none ring-0 transition-colors ' +
  'hover:bg-on-surface/10 focus:outline-none focus-visible:bg-on-surface/10'

const DISABLED_ITEM_CLASSES =
  'aria-disabled:cursor-default aria-disabled:text-on-surface-variant/45 ' +
  'aria-disabled:hover:bg-transparent aria-disabled:focus:bg-transparent'

const ITEM_ICON_CLASSES =
  'material-symbols-outlined text-base leading-none opacity-70 shrink-0'

const SHORTCUT_CHIP_CLASSES =
  'shrink-0 rounded bg-on-surface/10 px-1.5 py-0.5 font-mono text-[10px] ' +
  'text-on-surface-variant'

// 16×16 rounded check square ported from ViewSettingsDropdown's CheckIndicator:
// checked => filled square with a `check` glyph; unchecked => thin
// outline-variant border. Disabled rows tone the checked state down so the
// indicator visually matches the muted label.
const CheckIndicator = ({
  checked,
  disabled,
}: {
  checked: boolean
  disabled: boolean
}): ReactElement => (
  <span
    aria-hidden="true"
    className={
      'inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-[4px] ' +
      (checked
        ? disabled
          ? 'border border-on-surface-variant/20 bg-on-surface-variant/12 text-on-surface-variant/55'
          : 'bg-primary text-on-primary'
        : 'border border-on-surface-variant/30 bg-transparent')
    }
    style={checked ? { fontVariationSettings: '"wght" 700' } : undefined}
  >
    {checked ? (
      <span className="material-symbols-outlined text-[12px] leading-none">
        check
      </span>
    ) : null}
  </span>
)

type FloatingSurfaceContext = ReturnType<typeof useFloatingSurface>['context']

interface MenuBodyProps {
  setFloating: (node: HTMLElement | null) => void
  style: CSSProperties
  context: FloatingSurfaceContext
  floatingProps: Record<string, unknown>
  listRef: MutableRefObject<(HTMLElement | null)[]>
  labelsRef: MutableRefObject<(string | null)[]>
  width?: number
  surfaceClassName?: string
  bodyClassName?: string
  ariaLabel?: string
  focus?: false | { modal?: boolean }
  contextValue: MenuContextValue
  children: ReactNode
}

// The shared panel body for both Menu and Menu.Context: portals the glass
// surface, applies the menu list wrapper, and provides the menu context so
// rows compose in. FloatingList wraps the rows so each useListItem gets its
// live DOM-ordered index (writing into the SAME listRef useListNavigation
// reads). Centralized so the two entry points cannot drift.
const MenuBody = ({
  setFloating,
  style,
  context,
  floatingProps,
  listRef,
  labelsRef,
  width = undefined,
  surfaceClassName = undefined,
  bodyClassName = MENU_BODY_CLASSES,
  ariaLabel = undefined,
  focus = false,
  contextValue,
  children,
}: MenuBodyProps): ReactElement => (
  <SurfacePanel
    setFloating={setFloating}
    style={style}
    context={context}
    width={width}
    focus={focus}
    className={surfaceClassName}
    aria-label={ariaLabel}
    {...floatingProps}
  >
    <div className={bodyClassName}>
      <MenuContext.Provider value={contextValue}>
        <FloatingList elementsRef={listRef} labelsRef={labelsRef}>
          {children}
        </FloatingList>
      </MenuContext.Provider>
    </div>
  </SurfacePanel>
)

// Tracks each navigable row's disabled flag keyed on its FloatingList index, so
// useListNavigation skips disabled rows. Returns the live disabledIndices, the
// row count, and a stable setter/clearer rows call from an effect. Indices come
// from useListItem (DOM order); a row clears its entry on unmount so the map
// never goes sparse — itemCount stays the true live count.
const useMenuDisabledIndices = (): {
  disabledIndices: number[]
  itemCount: number
  setRowDisabled: (index: number, disabled: boolean) => void
  clearRow: (index: number) => void
} => {
  const [disabledMap, setDisabledMap] = useState<ReadonlyMap<number, boolean>>(
    new Map()
  )

  const setRowDisabled = useCallback(
    (index: number, disabled: boolean): void => {
      setDisabledMap((previous) => {
        if (previous.get(index) === disabled) {
          return previous
        }

        const next = new Map(previous)
        next.set(index, disabled)

        return next
      })
    },
    []
  )

  const clearRow = useCallback((index: number): void => {
    setDisabledMap((previous) => {
      if (!previous.has(index)) {
        return previous
      }

      const next = new Map(previous)
      next.delete(index)

      return next
    })
  }, [])

  const disabledIndices = useMemo(
    () =>
      Array.from(disabledMap.entries())
        .filter(([, disabled]) => disabled)
        .map(([index]) => index),
    [disabledMap]
  )

  return {
    disabledIndices,
    itemCount: disabledMap.size,
    setRowDisabled,
    clearRow,
  }
}

// Registers a navigable row with the parent's FloatingList (DOM-ordered index)
// and keeps its disabled flag synced. Returns the index + the merged ref to put
// on the row button. An index of -1 means "not yet placed" (first render before
// FloatingList sorts); the row stays non-focusable until it settles. On unmount
// (or when its index shifts) it clears the prior entry so the map never leaks.
const useMenuRow = (
  disabled: boolean,
  label: string,
  extraRef?: (node: HTMLElement | null) => void
): { index: number; ref: (node: HTMLElement | null) => void } => {
  const menu = useMenuContext()
  const { ref, index } = useListItem({ label })
  const mergedRef = useMergeRefs([ref, extraRef])

  const { setRowDisabled, clearRow } = menu
  useEffect(() => {
    if (index === -1) {
      return
    }

    setRowDisabled(index, disabled)

    return (): void => clearRow(index)
  }, [index, disabled, setRowDisabled, clearRow])

  return { index, ref: mergedRef ?? ref }
}

interface MenuProps {
  // The clickable element that toggles the menu open.
  trigger: ReactElement
  placement?: Placement
  width?: number
  // Opt out of scroll-dismiss where a consumer's behavior differs (spec §5.3).
  middleware?: { ancestorScroll?: boolean }
  'aria-label'?: string
  onOpenChange?: (open: boolean) => void
  children: ReactNode
  // Optional shared Tooltip label for the trigger. When provided, Menu clones
  // the trigger with its floating reference props first, then Tooltip wraps that
  // cloned element and composes its own hover/focus handlers with Menu's.
  tooltip?: ReactNode
  tooltipPlacement?: Placement
  closeSignal?: number
}

// Generic anchored menu: a trigger element opens a portal-rendered, glass
// surface of compound rows (Section/Item/Checkbox/Submenu). Composes
// useFloatingSurface (positioning + dismiss + list-nav) + SurfacePanel; owns
// submenu open-state so only one submenu is open at a time and an outside
// press inside a submenu does not close the parent.
const MenuRoot = ({
  trigger,
  placement = 'bottom-start',
  width = undefined,
  middleware = undefined,
  'aria-label': ariaLabel = undefined,
  onOpenChange = undefined,
  children,
  tooltip = undefined,
  tooltipPlacement = 'top',
  closeSignal = undefined,
}: MenuProps): ReactElement => {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null)
  const openSubmenuIdRef = useRef(openSubmenuId)
  const closeSignalRef = useRef(closeSignal)
  const listRef = useRef<(HTMLElement | null)[]>([])
  const labelsRef = useRef<(string | null)[]>([])

  const { disabledIndices, setRowDisabled, clearRow } = useMenuDisabledIndices()

  const handleOpenChange = useCallback(
    (nextOpen: boolean): void => {
      setOpen(nextOpen)
      onOpenChange?.(nextOpen)
      if (!nextOpen) {
        setActiveIndex(null)
        setOpenSubmenuId(null)
      }
    },
    [onOpenChange]
  )

  useEffect(() => {
    if (closeSignalRef.current === closeSignal) {
      return
    }

    closeSignalRef.current = closeSignal
    handleOpenChange(false)
  }, [closeSignal, handleOpenChange])

  // Keep a live ref so the stable dismissWhen callback can read the currently
  // open submenu id without re-registering the listener each time it changes.
  openSubmenuIdRef.current = openSubmenuId

  // An outside-press inside this menu's own open submenu must NOT close the
  // parent (the submenu owns its own dismissal); a press anywhere else does.
  // Scoped to the current submenu id so a sibling Menu's open submenu does not
  // keep this parent open.
  const dismissWhen = useCallback((event: MouseEvent): boolean => {
    const target = event.target as Element | null
    const activeSubmenuId = openSubmenuIdRef.current

    if (activeSubmenuId === null) {
      return true
    }

    return target?.closest(`[${SUBMENU_ROOT_ATTR}="${activeSubmenuId}"]`)
      ? false
      : true
  }, [])

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
    middleware,
    dismissWhen,
    list: {
      ref: listRef,
      activeIndex,
      onNavigate: setActiveIndex,
      loop: true,
      disabledIndices,
      focusItemOnOpen: true,
    },
  })

  useEffect(() => {
    if (!open || activeIndex === null) {
      return
    }

    const activeItem = listRef.current[activeIndex]
    if (activeItem == null) {
      return
    }

    const activeElement = document.activeElement
    if (
      activeElement instanceof Element &&
      activeItem.contains(activeElement)
    ) {
      return
    }

    activeItem.focus()
  }, [activeIndex, open])

  const setOpenSubmenu = useCallback((id: string | null): void => {
    setOpenSubmenuId(id)
  }, [])

  const contextValue: MenuContextValue = {
    getItemProps,
    activeIndex,
    setRowDisabled,
    clearRow,
    close: (): void => handleOpenChange(false),
    openSubmenuId,
    setOpenSubmenu,
  }

  // Feed the consumer's trigger handlers into getReferenceProps so floating-ui
  // composes them (consumer first, then floating). Merge the consumer's ref with
  // the floating reference ref so both receive the anchor DOM node.
  const triggerElement = trigger as ReactElement<{
    onClick?: MouseEventHandler
    onKeyDown?: KeyboardEventHandler
    ref?: ((node: Element | null) => void) | null
  }>
  const consumerOnClick = triggerElement.props.onClick
  const consumerOnKeyDown = triggerElement.props.onKeyDown

  const mergedTriggerRef = useMergeRefs([
    refs.setReference,
    triggerElement.props.ref ?? null,
  ])

  const triggerProps = getReferenceProps({
    ref: mergedTriggerRef,
    onClick: (event: ReactMouseEvent): void => {
      consumerOnClick?.(event)
      handleOpenChange(!open)
    },
    onKeyDown: consumerOnKeyDown,
  })

  const triggerNode = <TriggerSlot trigger={trigger} props={triggerProps} />

  return (
    <>
      {tooltip !== undefined ? (
        <Tooltip content={tooltip} placement={tooltipPlacement}>
          {triggerNode}
        </Tooltip>
      ) : (
        triggerNode
      )}
      {open ? (
        <MenuBody
          setFloating={refs.setFloating}
          style={floatingStyles}
          context={context}
          floatingProps={getFloatingProps()}
          listRef={listRef}
          labelsRef={labelsRef}
          width={width}
          ariaLabel={ariaLabel}
          contextValue={contextValue}
        >
          {children}
        </MenuBody>
      ) : null}
    </>
  )
}

// Clones the consumer's trigger element with the floating reference ref +
// interaction props so the consumer keeps full control of the trigger markup.
const TriggerSlot = ({
  trigger,
  props,
}: {
  trigger: ReactElement
  props: Record<string, unknown>
}): ReactElement => cloneElement(trigger, props)

interface MenuSectionProps {
  label?: string
  children: ReactNode
}

const MenuSection = ({
  label = undefined,
  children,
}: MenuSectionProps): ReactElement => (
  <div role="group" aria-label={label}>
    {label !== undefined ? (
      <div className={SECTION_HEADER_CLASSES}>{label}</div>
    ) : null}
    {children}
  </div>
)

interface MenuRowProps {
  label: string
  disabled?: boolean
  onSelect?: () => void
  className?: string
  children: ReactNode
}

const MenuRow = ({
  label,
  disabled = false,
  onSelect = undefined,
  className = undefined,
  children,
}: MenuRowProps): ReactElement => {
  const menu = useMenuContext()
  const { index, ref } = useMenuRow(disabled, label)

  const select = (): void => {
    if (disabled) {
      return
    }

    onSelect?.()
  }

  const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    if (event.currentTarget !== event.target) {
      return
    }

    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }

    event.preventDefault()
    select()
  }

  const handleKeyDownCapture: KeyboardEventHandler<HTMLDivElement> = (
    event
  ) => {
    if (
      event.currentTarget === event.target ||
      (event.key !== 'ArrowUp' &&
        event.key !== 'ArrowDown' &&
        event.key !== 'Enter' &&
        event.key !== ' ')
    ) {
      return
    }

    event.stopPropagation()
    event.nativeEvent.stopImmediatePropagation()
  }

  const handleClick: MouseEventHandler<HTMLDivElement> = (event) => {
    const target = event.target instanceof Element ? event.target : null

    const nestedControl = target?.closest(
      'button, a, input, textarea, select, [role="button"], [tabindex]:not([tabindex="-1"])'
    )

    if (nestedControl !== null && nestedControl !== event.currentTarget) {
      return
    }

    select()
  }

  const itemProps = menu.getItemProps({
    onClick: handleClick,
    onKeyDown: handleKeyDown,
  })

  return (
    <div
      role="menuitem"
      ref={ref}
      tabIndex={menu.activeIndex === index ? 0 : -1}
      aria-disabled={disabled ? true : undefined}
      aria-label={label}
      className={className}
      {...itemProps}
      onKeyDownCapture={handleKeyDownCapture}
    >
      {children}
    </div>
  )
}

interface MenuItemProps {
  icon?: string
  shortcut?: ShortcutInput
  disabled?: boolean
  onSelect: () => void
  children: ReactNode
}

const MenuItem = ({
  icon = undefined,
  shortcut = undefined,
  disabled = false,
  onSelect,
  children,
}: MenuItemProps): ReactElement => {
  const menu = useMenuContext()
  const label = typeof children === 'string' ? children : ''
  const { index, ref } = useMenuRow(disabled, label)

  return (
    <button
      type="button"
      role="menuitem"
      ref={ref}
      tabIndex={menu.activeIndex === index ? 0 : -1}
      aria-disabled={disabled ? true : undefined}
      className={`${ITEM_CLASSES} ${DISABLED_ITEM_CLASSES}`}
      {...menu.getItemProps({
        onClick: (): void => {
          if (disabled) {
            return
          }

          onSelect()
          menu.close()
        },
      })}
    >
      <span className="flex items-center gap-2.5">
        {icon !== undefined ? (
          <span aria-hidden="true" className={ITEM_ICON_CLASSES}>
            {icon}
          </span>
        ) : null}
        {children}
      </span>
      {shortcut !== undefined ? (
        <kbd className={SHORTCUT_CHIP_CLASSES} aria-hidden="true">
          {formatShortcut(shortcut)}
        </kbd>
      ) : null}
    </button>
  )
}

interface MenuCheckboxProps {
  icon?: string
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
  children: ReactNode
}

const MenuCheckbox = ({
  icon = undefined,
  checked,
  disabled = false,
  onChange,
  children,
}: MenuCheckboxProps): ReactElement => {
  const menu = useMenuContext()
  const label = typeof children === 'string' ? children : ''
  const { index, ref } = useMenuRow(disabled, label)

  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      aria-disabled={disabled}
      ref={ref}
      tabIndex={menu.activeIndex === index ? 0 : -1}
      className={`${ITEM_CLASSES} ${DISABLED_ITEM_CLASSES}`}
      {...menu.getItemProps({
        onClick: (): void => {
          if (disabled) {
            return
          }

          onChange(!checked)
        },
      })}
    >
      <span className="flex items-center gap-2.5">
        {icon !== undefined ? (
          <span aria-hidden="true" className={ITEM_ICON_CLASSES}>
            {icon}
          </span>
        ) : null}
        {children}
      </span>
      <CheckIndicator checked={checked} disabled={disabled} />
    </button>
  )
}

interface MenuSubmenuProps<T extends string | number> {
  label: string
  icon?: string
  value: T
  options: readonly DropdownOption<T>[]
  onChange: (next: T) => void
}

// A Menu.Item-style row that anchors a SECOND floating surface whose body is
// the shared OptionList. The parent Menu owns one-open-submenu state; this row
// registers its portal root with the parent so an outside-press inside the
// sub-list does not close the parent. Selecting an option closes ONLY the
// submenu; the parent stays open.
const MenuSubmenu = <T extends string | number>({
  label,
  icon = undefined,
  value,
  options,
  onChange,
}: MenuSubmenuProps<T>): ReactElement => {
  const menu = useMenuContext()
  const submenuId = useId()
  const subListRef = useRef<(HTMLElement | null)[]>([])
  const [subActiveIndex, setSubActiveIndex] = useState<number | null>(null)

  const open = menu.openSubmenuId === submenuId

  const sub = useFloatingSurface({
    open,
    onOpenChange: (nextOpen): void => {
      menu.setOpenSubmenu(nextOpen ? submenuId : null)
    },
    placement: 'right-start',
    list: {
      ref: subListRef,
      activeIndex: subActiveIndex,
      onNavigate: setSubActiveIndex,
      loop: true,
      focusItemOnOpen: true,
    },
  })

  useEffect(() => {
    if (!open || subActiveIndex === null) {
      return
    }

    subListRef.current[subActiveIndex]?.focus()
  }, [subActiveIndex, open])

  // Captures the row button DOM node so focus can return to it after the
  // submenu closes (keyboard selection leaves focus on document.body otherwise).
  const rowButtonRef = useRef<HTMLElement | null>(null)

  const captureRowButton = useCallback((node: HTMLElement | null): void => {
    rowButtonRef.current = node
  }, [])

  // The submenu row joins the PARENT menu's FloatingList for keyboard nav while
  // also anchoring its own surface — merge the list-item ref with the floating
  // reference ref onto one button.
  const { index, ref: rowRef } = useMenuRow(false, label, (node) => {
    captureRowButton(node)
    sub.refs.setReference(node)
  })

  const current = options.find((option) => option.value === value)

  const closeSubmenu = (): void => {
    menu.setOpenSubmenu(null)
    rowButtonRef.current?.focus()
  }

  return (
    <>
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        ref={rowRef}
        tabIndex={menu.activeIndex === index ? 0 : -1}
        className={ITEM_CLASSES}
        {...sub.getReferenceProps(
          menu.getItemProps({
            onClick: (): void => menu.setOpenSubmenu(open ? null : submenuId),
          })
        )}
      >
        <span className="flex items-center gap-2.5">
          {icon !== undefined ? (
            <span aria-hidden="true" className={ITEM_ICON_CLASSES}>
              {icon}
            </span>
          ) : null}
          {label}
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] text-on-surface-variant">
          {current?.label ?? String(value)}
          <span
            aria-hidden="true"
            className="material-symbols-outlined text-base leading-none"
          >
            chevron_right
          </span>
        </span>
      </button>
      {open ? (
        <SurfacePanel
          setFloating={sub.refs.setFloating}
          style={sub.floatingStyles}
          context={sub.context}
          width={220}
          {...{ [SUBMENU_ROOT_ATTR]: submenuId }}
          {...sub.getFloatingProps()}
        >
          <div className="py-1 max-h-72 overflow-auto">
            <OptionList
              options={options}
              value={value}
              activeIndex={subActiveIndex}
              onSelect={(next): void => {
                onChange(next)
                closeSubmenu()
              }}
              getItemProps={sub.getItemProps}
              registerItem={(itemIndex, node): void => {
                subListRef.current[itemIndex] = node
              }}
            />
          </div>
        </SurfacePanel>
      ) : null}
    </>
  )
}

interface MenuContextMenuProps {
  position: { x: number; y: number }
  open: boolean
  onOpenChange: (open: boolean) => void
  'aria-label': string
  children: ReactNode
}

// Externally-controlled, cursor-anchored menu. Bakes the context-menu substrate
// config (offset 0, flip fallbacks, no autoUpdate / no ancestorScroll,
// openOnArrowKeyDown false, non-modal focus) so consumers pass only
// position/open/items. Covers TerminalContextMenu.
const MenuContextMenu = ({
  position,
  open,
  onOpenChange,
  'aria-label': ariaLabel,
  children,
}: MenuContextMenuProps): ReactElement | null => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const listRef = useRef<(HTMLElement | null)[]>([])
  const labelsRef = useRef<(string | null)[]>([])

  const { disabledIndices, itemCount, setRowDisabled, clearRow } =
    useMenuDisabledIndices()

  const handleOpenChange = useCallback(
    (nextOpen: boolean): void => {
      if (!nextOpen) {
        setActiveIndex(null)
      }

      onOpenChange(nextOpen)
    },
    [onOpenChange]
  )

  const { refs, floatingStyles, context, getFloatingProps, getItemProps } =
    useFloatingSurface({
      open,
      onOpenChange: handleOpenChange,
      anchor: position,
      role: 'menu',
      offset: 0,
      fallbackPlacements: ['top-start', 'bottom-end', 'top-end'],
      middleware: { autoUpdate: false, ancestorScroll: false },
      list: {
        ref: listRef,
        activeIndex,
        onNavigate: setActiveIndex,
        loop: true,
        disabledIndices,
        openOnArrowKeyDown: false,
      },
    })

  // Focus the first enabled item on open, skipping disabled rows — ported from
  // TerminalContextMenu's initial-focus behavior. Re-runs as disabledIndices
  // settles (rows register their disabled flag via effect), so it self-corrects
  // off a disabled row once the flags are known.
  const disabledKey = disabledIndices.join(',')
  useEffect(() => {
    if (!open || itemCount === 0) {
      return
    }

    const firstEnabled = Array.from({ length: itemCount }).findIndex(
      (_, index) => !disabledIndices.includes(index)
    )
    if (firstEnabled === -1) {
      return
    }

    const focused =
      activeIndex !== null && !disabledIndices.includes(activeIndex)
    if (focused) {
      return
    }

    setActiveIndex(firstEnabled)
    listRef.current[firstEnabled]?.focus()
    // disabledIndices tracked via disabledKey; activeIndex is read-not-trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, itemCount, disabledKey])

  const contextValue: MenuContextValue = {
    getItemProps,
    activeIndex,
    setRowDisabled,
    clearRow,
    close: (): void => handleOpenChange(false),
    // Context menus carry flat items only; submenu coordination is inert here.
    openSubmenuId: null,
    setOpenSubmenu: (): void => undefined,
  }

  if (!open) {
    return null
  }

  return (
    <MenuBody
      setFloating={refs.setFloating}
      style={floatingStyles}
      context={context}
      floatingProps={getFloatingProps()}
      listRef={listRef}
      labelsRef={labelsRef}
      ariaLabel={ariaLabel}
      focus={{ modal: false }}
      surfaceClassName={CONTEXT_MENU_SURFACE_CLASSES}
      bodyClassName={CONTEXT_MENU_BODY_CLASSES}
      contextValue={contextValue}
    >
      {children}
    </MenuBody>
  )
}

interface MenuComponent {
  (props: MenuProps): ReactElement
  Context: typeof MenuContextMenu
  Section: typeof MenuSection
  Row: typeof MenuRow
  Item: typeof MenuItem
  Checkbox: typeof MenuCheckbox
  Submenu: typeof MenuSubmenu
}

export const Menu = MenuRoot as MenuComponent
Menu.Context = MenuContextMenu
Menu.Section = MenuSection
Menu.Row = MenuRow
Menu.Item = MenuItem
Menu.Checkbox = MenuCheckbox
Menu.Submenu = MenuSubmenu

import {
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type HTMLProps,
  type ReactElement,
  type ReactNode,
} from 'react'
import { useFloatingSurface } from '@/components/base/floating/useFloatingSurface'
import { SurfacePanel } from '@/components/base/floating/SurfacePanel'
import { OptionList, type DropdownOption } from '@/components/base/OptionList'
import { type Placement } from '@/components/base/floating/glassSurface'
import { formatShortcut, type ShortcutInput } from '../lib/formatShortcut'

// The state every menu row needs from its parent Menu/Menu.Context. Shared via
// React context so subparts (Item/Checkbox/Submenu/Section) compose in without
// the parent threading props through, keeping Menu's public surface narrow.
interface MenuContextValue {
  getItemProps: (props?: HTMLProps<HTMLElement>) => Record<string, unknown>
  registerItem: (index: number, node: HTMLElement | null) => void
  activeIndex: number | null
  // Claims the next stable list index for a navigable row (render-order).
  useItemIndex: (disabled: boolean) => number
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

// 18×18 rounded check square ported from ViewSettingsDropdown's CheckIndicator:
// checked => filled primary square with a `check` glyph; unchecked => thin
// outline-variant border.
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

type FloatingSurfaceContext = ReturnType<typeof useFloatingSurface>['context']

interface MenuBodyProps {
  setFloating: (node: HTMLElement | null) => void
  style: CSSProperties
  context: FloatingSurfaceContext
  floatingProps: Record<string, unknown>
  width?: number
  ariaLabel?: string
  focus?: false | { modal?: boolean }
  contextValue: MenuContextValue
  children: ReactNode
}

// The shared panel body for both Menu and Menu.Context: portals the glass
// surface, applies the menu list wrapper, and provides the menu context so
// rows compose in. Centralized so the two entry points cannot drift.
const MenuBody = ({
  setFloating,
  style,
  context,
  floatingProps,
  width = undefined,
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
    aria-label={ariaLabel}
    {...floatingProps}
  >
    <div className={MENU_BODY_CLASSES}>
      <MenuContext.Provider value={contextValue}>
        {children}
      </MenuContext.Provider>
    </div>
  </SurfacePanel>
)

// Shared registry hook: hands each navigable row a stable render-order index
// and keeps the parent's disabledIndices array in sync via effect-registration
// (so floating-ui's list navigation skips disabled rows). Returns the live
// disabledIndices + item count plus the factory subparts call to claim an index.
const useMenuRegistry = (): {
  disabledIndices: number[]
  itemCount: number
  useItemIndex: (disabled: boolean) => number
} => {
  const counter = useRef(0)
  counter.current = 0

  const [disabledMap, setDisabledMap] = useState<ReadonlyMap<number, boolean>>(
    new Map()
  )

  const useItemIndex = (disabled: boolean): number => {
    const [index] = useState(() => counter.current++)

    useEffect(() => {
      setDisabledMap((previous) => {
        const next = new Map(previous)
        next.set(index, disabled)

        return next
      })

      return (): void => {
        setDisabledMap((previous) => {
          if (!previous.has(index)) {
            return previous
          }

          const next = new Map(previous)
          next.delete(index)

          return next
        })
      }
    }, [index, disabled])

    return index
  }

  const disabledIndices = Array.from(disabledMap.entries())
    .filter(([, disabled]) => disabled)
    .map(([index]) => index)

  return { disabledIndices, itemCount: disabledMap.size, useItemIndex }
}

interface MenuProps {
  // The clickable element that toggles the menu open.
  trigger: ReactElement
  placement?: Placement
  width?: number
  // Opt out of scroll-dismiss where a consumer's behavior differs (spec §5.3).
  middleware?: { ancestorScroll?: boolean }
  'aria-label'?: string
  children: ReactNode
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
  children,
}: MenuProps): ReactElement => {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null)
  const listRef = useRef<(HTMLElement | null)[]>([])

  const { disabledIndices, useItemIndex } = useMenuRegistry()

  const handleOpenChange = useCallback((nextOpen: boolean): void => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setActiveIndex(null)
      setOpenSubmenuId(null)
    }
  }, [])

  // An outside-press inside an open submenu must NOT close the parent (the
  // submenu owns its own dismissal); a press anywhere else does. Keyed on the
  // submenu root attribute, ported from ViewSettingsDropdown.
  const dismissWhen = useCallback((event: MouseEvent): boolean => {
    const target = event.target as Element | null

    return target?.closest(`[${SUBMENU_ROOT_ATTR}]`) ? false : true
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
    },
  })

  const setOpenSubmenu = useCallback((id: string | null): void => {
    setOpenSubmenuId(id)
  }, [])

  const contextValue: MenuContextValue = {
    getItemProps,
    registerItem: (index, node): void => {
      listRef.current[index] = node
    },
    activeIndex,
    useItemIndex,
    close: (): void => handleOpenChange(false),
    openSubmenuId,
    setOpenSubmenu,
  }

  const triggerProps = getReferenceProps({
    ref: refs.setReference,
    onClick: (): void => handleOpenChange(!open),
  })

  return (
    <>
      <TriggerSlot trigger={trigger} props={triggerProps} />
      {open ? (
        <MenuBody
          setFloating={refs.setFloating}
          style={floatingStyles}
          context={context}
          floatingProps={getFloatingProps()}
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
  const index = menu.useItemIndex(disabled)

  return (
    <button
      type="button"
      role="menuitem"
      ref={(node): void => menu.registerItem(index, node)}
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
  onChange: (next: boolean) => void
  children: ReactNode
}

const MenuCheckbox = ({
  icon = undefined,
  checked,
  onChange,
  children,
}: MenuCheckboxProps): ReactElement => {
  const menu = useMenuContext()
  const index = menu.useItemIndex(false)

  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      ref={(node): void => menu.registerItem(index, node)}
      tabIndex={menu.activeIndex === index ? 0 : -1}
      className={ITEM_CLASSES}
      {...menu.getItemProps({
        onClick: (): void => onChange(!checked),
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
      <CheckIndicator checked={checked} />
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
  const index = menu.useItemIndex(false)
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
    },
  })

  const current = options.find((option) => option.value === value)

  const rowRef = (node: HTMLElement | null): void => {
    menu.registerItem(index, node)
    sub.refs.setReference(node)
  }

  const closeSubmenu = (): void => menu.setOpenSubmenu(null)

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

  const { disabledIndices, useItemIndex, itemCount } = useMenuRegistry()

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
    registerItem: (index, node): void => {
      listRef.current[index] = node
    },
    activeIndex,
    useItemIndex,
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
      ariaLabel={ariaLabel}
      focus={{ modal: false }}
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
  Item: typeof MenuItem
  Checkbox: typeof MenuCheckbox
  Submenu: typeof MenuSubmenu
}

export const Menu = MenuRoot as MenuComponent
Menu.Context = MenuContextMenu
Menu.Section = MenuSection
Menu.Item = MenuItem
Menu.Checkbox = MenuCheckbox
Menu.Submenu = MenuSubmenu

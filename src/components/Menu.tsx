import {
  Children,
  cloneElement,
  createContext,
  Fragment,
  isValidElement,
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
  type FocusEventHandler,
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
import {
  NATIVE_OVERLAY_KINDS,
  closeNativeOverlay,
  nativeOverlayThemeSnapshot,
  openNativeOverlay,
  selectFloatingTransport,
  warnNativeOverlayFallback,
  type NativeOverlayActionHandler,
  type NativeOverlayActionResult,
  type NativeOverlayMenuItem,
  type NativeOverlayMenuSection,
  type NativeOverlayMenuSurfaceTone,
  type NativeOverlayMenuSubAction,
  type NativeOverlayRequest,
} from '@/components/base/floating/nativeOverlay'
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

export const isNativeOverlayMenuTransportActive = (
  nativeOverlay: boolean
): boolean => selectFloatingTransport(nativeOverlay) === 'native-overlay'

const CONTEXT_MENU_SURFACE_BASE_CLASSES =
  'z-[110] overflow-hidden rounded-md border shadow-lg outline-none focus:outline-none focus-visible:outline-none'

const CONTEXT_MENU_SURFACE_CLASSES = `${CONTEXT_MENU_SURFACE_BASE_CLASSES} border-outline-variant/30 bg-surface-container-high text-on-surface`

const CONTEXT_MENU_PRIMARY_CONTAINER_SOFT_SURFACE_CLASSES = `${CONTEXT_MENU_SURFACE_BASE_CLASSES} border-primary-container/20 vf-native-overlay-primary-container-soft text-on-surface`

const contextMenuSurfaceClasses = (
  surfaceTone: NativeOverlayMenuSurfaceTone | undefined
): string =>
  surfaceTone === 'primary-container-soft'
    ? CONTEXT_MENU_PRIMARY_CONTAINER_SOFT_SURFACE_CLASSES
    : CONTEXT_MENU_SURFACE_CLASSES

const CONTEXT_MENU_BODY_CLASSES = 'min-w-0 max-h-[28rem] overflow-auto'

const SECTION_HEADER_CLASSES =
  'text-[0.65rem] font-bold uppercase tracking-wider text-on-surface-variant px-2.5 pt-2 pb-1'

const NESTED_CONTROL_SELECTOR =
  'button, a, input, textarea, select, [role="button"], [tabindex]:not([tabindex="-1"])'

const NESTED_ACTIVATION_SELECTOR = 'button, a, [role="button"]'

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
  // 'compact' adopts the tighter solid surface used by the right-click context
  // menu (PR #618) instead of the default glass + min-w-52 dropdown.
  variant?: 'default' | 'compact'
  // Opt out of scroll-dismiss where a consumer's behavior differs (spec §5.3).
  middleware?: { ancestorScroll?: boolean }
  bodyClassName?: string
  'aria-label'?: string
  onOpenChange?: (open: boolean) => void
  children: ReactNode
  // Optional shared Tooltip label for the trigger. When provided, Menu clones
  // the trigger with its floating reference props first, then Tooltip wraps that
  // cloned element and composes its own hover/focus handlers with Menu's.
  tooltip?: ReactNode
  tooltipPlacement?: Placement
  closeSignal?: number
  nativeOverlay?: boolean
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
  variant = 'default',
  middleware = undefined,
  bodyClassName = undefined,
  'aria-label': ariaLabel = undefined,
  onOpenChange = undefined,
  children,
  tooltip = undefined,
  tooltipPlacement = 'top',
  closeSignal = undefined,
  nativeOverlay = false,
}: MenuProps): ReactElement => {
  const surfaceId = useId()
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null)

  const [nativeAttempt, setNativeAttempt] = useState<
    'idle' | 'pending' | 'active' | 'failed'
  >('idle')
  const openSubmenuIdRef = useRef(openSubmenuId)
  const closeSignalRef = useRef(closeSignal)
  const triggerNodeRef = useRef<HTMLElement | null>(null)
  const listRef = useRef<(HTMLElement | null)[]>([])
  const labelsRef = useRef<(string | null)[]>([])
  const nativeLifecycleActiveRef = useRef(false)

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
  const handleOpenChangeRef = useRef(handleOpenChange)
  handleOpenChangeRef.current = handleOpenChange

  const transport = selectFloatingTransport(nativeOverlay)

  const nativeSpec = nativeAnchoredMenuSpec(
    surfaceId,
    ariaLabel,
    children,
    () => handleOpenChangeRef.current(false)
  )
  const nativeSpecRef = useRef(nativeSpec)
  nativeSpecRef.current = nativeSpec
  const nativePayloadKey = JSON.stringify(nativeSpec.payload)

  const nativeActionsRef = useRef<{
    payloadKey: string
    actions: ReadonlyMap<string, NativeOverlayActionHandler>
  } | null>(null)
  if (nativeActionsRef.current?.payloadKey !== nativePayloadKey) {
    nativeActionsRef.current = {
      payloadKey: nativePayloadKey,
      actions: new Map(
        Array.from(nativeSpec.actions.keys(), (actionId) => [
          actionId,
          nativeMenuLiveAction(nativeSpecRef, actionId),
        ])
      ),
    }
  }

  const nativeActions = nativeActionsRef.current.actions
  const nativeUnsupportedReason = nativeSpec.unsupportedReason

  const canAttemptNative =
    open && transport === 'native-overlay' && nativeUnsupportedReason === null

  // If this menu opted into NativeOverlay but contains content we cannot turn
  // into plain IPC data, keep the normal DOM menu and warn only in dev builds.
  useEffect(() => {
    if (!open) {
      setNativeAttempt('idle')

      return
    }

    if (
      nativeOverlay &&
      transport === 'native-overlay' &&
      nativeUnsupportedReason !== null
    ) {
      warnNativeOverlayFallback(nativeUnsupportedReason)
    }
  }, [nativeOverlay, nativeUnsupportedReason, open, transport])

  useEffect(() => {
    if (!canAttemptNative) {
      nativeLifecycleActiveRef.current = false

      return
    }

    nativeLifecycleActiveRef.current = true

    return (): void => {
      nativeLifecycleActiveRef.current = false
      closeNativeOverlay(surfaceId)
    }
  }, [canAttemptNative, surfaceId])

  // When the native transport is available, measure the trigger and send main a
  // serializable menu request. The local menu stays hidden unless that open
  // attempt is rejected, which preserves the existing fallback path.
  useEffect(() => {
    if (!canAttemptNative) {
      return
    }

    const triggerRect = triggerNodeRef.current?.getBoundingClientRect()
    if (triggerRect === undefined) {
      warnNativeOverlayFallback('missing menu trigger rect')
      setNativeAttempt('failed')

      return
    }

    const cancelled = { current: false }
    setNativeAttempt('pending')

    void (async (): Promise<void> => {
      const accepted = await openNativeOverlay(
        {
          surfaceId,
          kind: NATIVE_OVERLAY_KINDS.menu,
          anchorRect: {
            x: triggerRect.x,
            y: triggerRect.y,
            width: triggerRect.width,
            height: triggerRect.height,
          },
          placement,
          payload: nativeSpecRef.current.payload,
          theme: nativeOverlayThemeSnapshot(),
        },
        {
          actions: nativeActions,
          onClose: (): void => handleOpenChangeRef.current(false),
        }
      )

      if (cancelled.current) {
        if (!nativeLifecycleActiveRef.current) {
          closeNativeOverlay(surfaceId)
        }

        return
      }

      setNativeAttempt(accepted ? 'active' : 'failed')
    })()

    return (): void => {
      cancelled.current = true
    }
  }, [canAttemptNative, nativeActions, nativePayloadKey, placement, surfaceId])

  useEffect(() => {
    if (!canAttemptNative || nativeAttempt !== 'active') {
      return
    }

    let frameId: number | null = null

    const sendLatestRect = (): void => {
      if (frameId !== null) {
        return
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null
        const triggerRect = triggerNodeRef.current?.getBoundingClientRect()
        if (triggerRect === undefined) {
          return
        }

        void openNativeOverlay(
          {
            surfaceId,
            kind: NATIVE_OVERLAY_KINDS.menu,
            anchorRect: {
              x: triggerRect.x,
              y: triggerRect.y,
              width: triggerRect.width,
              height: triggerRect.height,
            },
            placement,
            payload: nativeSpecRef.current.payload,
            theme: nativeOverlayThemeSnapshot(),
          },
          {
            actions: nativeActions,
            onClose: (): void => handleOpenChangeRef.current(false),
          }
        )
      })
    }

    window.addEventListener('resize', sendLatestRect)
    const observer = new ResizeObserver(sendLatestRect)
    const triggerNode = triggerNodeRef.current
    if (triggerNode !== null) {
      observer.observe(triggerNode)
    }

    return (): void => {
      window.removeEventListener('resize', sendLatestRect)
      observer.disconnect()
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [canAttemptNative, nativeActions, nativeAttempt, placement, surfaceId])

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
    if (activeItem?.contains(document.activeElement)) {
      return
    }

    activeItem?.focus()
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

  const captureTriggerRef = useCallback((node: Element | null): void => {
    triggerNodeRef.current = node instanceof HTMLElement ? node : null
  }, [])

  // NativeOverlay needs the trigger DOM rect, floating-ui needs the same node
  // for local fallback positioning, and consumers may still pass their own ref.
  const mergedTriggerRef = useMergeRefs([
    captureTriggerRef,
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
      {open && !(canAttemptNative && nativeAttempt !== 'failed') ? (
        <MenuBody
          setFloating={refs.setFloating}
          style={floatingStyles}
          context={context}
          floatingProps={getFloatingProps()}
          listRef={listRef}
          labelsRef={labelsRef}
          width={width}
          surfaceClassName={
            variant === 'compact' ? CONTEXT_MENU_SURFACE_CLASSES : undefined
          }
          bodyClassName={
            bodyClassName ??
            (variant === 'compact' ? CONTEXT_MENU_BODY_CLASSES : undefined)
          }
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

interface MenuRowNativeOverlayAction {
  label: string
  icon?: string
  pressed?: boolean
  disabled?: boolean
  onSelect: () => NativeOverlayActionResult
}

interface MenuRowProps {
  label: string
  disabled?: boolean
  onSelect?: () => NativeOverlayActionResult
  className?: string
  nativeOverlayIcon?: string
  nativeOverlayActive?: boolean
  nativeOverlayDetail?: string
  nativeOverlayFeedback?: 'copy'
  nativeOverlayCloseOnSelect?: boolean
  nativeOverlayActions?: readonly MenuRowNativeOverlayAction[]
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
  const nestedFocusRef = useRef<HTMLElement | null>(null)

  const select = (): void => {
    if (disabled) {
      return
    }

    void onSelect?.()
  }

  const handleKeyDown: KeyboardEventHandler<HTMLDivElement> = (event) => {
    const nestedControl =
      event.currentTarget === event.target
        ? nestedFocusRef.current
        : event.target instanceof Element
          ? event.target.closest(NESTED_CONTROL_SELECTOR)
          : null

    if (nestedControl !== null && nestedControl !== event.currentTarget) {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        event.stopPropagation()
        event.nativeEvent.stopImmediatePropagation()

        if (nestedControl instanceof HTMLElement) {
          nestedControl.focus()
          queueMicrotask(() => nestedControl.focus())
        }

        return
      }

      if (event.key === 'Enter' || event.key === ' ') {
        const activationTarget = nestedControl.closest(
          NESTED_ACTIVATION_SELECTOR
        )

        if (
          activationTarget instanceof HTMLElement &&
          activationTarget !== event.currentTarget
        ) {
          event.preventDefault()
          event.stopPropagation()
          event.nativeEvent.stopImmediatePropagation()
          activationTarget.click()

          return
        }
      }

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
    if (event.currentTarget !== event.target) {
      const target = event.target instanceof Element ? event.target : null
      const nestedControl = target?.closest(NESTED_CONTROL_SELECTOR)

      if (nestedControl !== null && nestedControl !== event.currentTarget) {
        if (nestedControl instanceof HTMLElement) {
          nestedFocusRef.current = nestedControl
        }

        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault()
          event.stopPropagation()
          event.nativeEvent.stopImmediatePropagation()

          if (target instanceof HTMLElement) {
            target.focus()
            queueMicrotask(() => target.focus())
          }

          return
        }

        if (event.key === 'Enter' || event.key === ' ') {
          const activationTarget = target?.closest(NESTED_ACTIVATION_SELECTOR)

          if (
            activationTarget instanceof HTMLElement &&
            activationTarget !== event.currentTarget
          ) {
            event.preventDefault()
            event.stopPropagation()
            event.nativeEvent.stopImmediatePropagation()
            activationTarget.click()

            return
          }
        }

        event.stopPropagation()
        event.nativeEvent.stopImmediatePropagation()
      }

      return
    }

    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
      return
    }

    event.stopPropagation()
  }

  const handleFocusCapture: FocusEventHandler<HTMLDivElement> = (
    focusEvent
  ) => {
    if (focusEvent.currentTarget === focusEvent.target) {
      const nestedFocus = nestedFocusRef.current

      if (nestedFocus !== null) {
        nestedFocus.focus()
        queueMicrotask(() => nestedFocus.focus())
      }

      return
    }

    const focusTarget =
      focusEvent.target instanceof Element ? focusEvent.target : null
    const nestedControl = focusTarget?.closest(NESTED_CONTROL_SELECTOR)

    if (
      nestedControl instanceof HTMLElement &&
      nestedControl !== focusEvent.currentTarget
    ) {
      nestedFocusRef.current = nestedControl
    }
  }

  const handleBlurCapture: FocusEventHandler<HTMLDivElement> = (blurEvent) => {
    const nextFocus =
      blurEvent.relatedTarget instanceof Node ? blurEvent.relatedTarget : null

    if (nextFocus !== null && blurEvent.currentTarget.contains(nextFocus)) {
      return
    }

    nestedFocusRef.current = null
  }

  const handleClick: MouseEventHandler<HTMLDivElement> = (event) => {
    const target = event.target instanceof Element ? event.target : null

    const nestedControl = target?.closest(NESTED_CONTROL_SELECTOR)

    if (nestedControl !== null && nestedControl !== event.currentTarget) {
      return
    }

    select()
  }

  return (
    <div
      role="menuitem"
      ref={ref}
      tabIndex={menu.activeIndex === index ? 0 : -1}
      aria-disabled={disabled ? true : undefined}
      aria-label={label}
      className={className}
      {...menu.getItemProps({
        onClick: handleClick,
        onKeyDown: handleKeyDown,
        onKeyDownCapture: handleKeyDownCapture,
        onFocusCapture: handleFocusCapture,
        onBlurCapture: handleBlurCapture,
      })}
    >
      {children}
    </div>
  )
}

interface MenuItemProps {
  icon?: string
  /** Rich leading visual (brand SVG / accent chip) for when a material-symbol `icon` isn't enough. */
  leadingIcon?: ReactNode
  shortcut?: ShortcutInput
  active?: boolean
  disabled?: boolean
  onSelect: () => void
  children: ReactNode
}

const MenuItem = ({
  icon = undefined,
  leadingIcon = undefined,
  shortcut = undefined,
  active = false,
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
      aria-current={active ? 'true' : undefined}
      aria-disabled={disabled ? true : undefined}
      className={`${ITEM_CLASSES} ${
        active ? 'bg-primary-container/15' : ''
      } ${DISABLED_ITEM_CLASSES}`}
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
      <span className="flex min-w-0 flex-1 items-center gap-2.5">
        {leadingIcon}
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
  'aria-label'?: string
  onChange: (next: boolean) => void
  children: ReactNode
}

const MenuCheckbox = ({
  icon = undefined,
  checked,
  disabled = false,
  'aria-label': ariaLabel = undefined,
  onChange,
  children,
}: MenuCheckboxProps): ReactElement => {
  const menu = useMenuContext()
  const label = ariaLabel ?? (typeof children === 'string' ? children : '')
  const { index, ref } = useMenuRow(disabled, label)

  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-label={ariaLabel}
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
  position: { x: number; y: number; width?: number; height?: number }
  placement?: Placement
  matchAnchorWidth?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  'aria-label': string
  nativeOverlay?: boolean
  surfaceTone?: NativeOverlayMenuSurfaceTone
  children: ReactNode
}

interface NativeMenuContextSpec {
  payload: NativeOverlayRequest['payload']
  actions: ReadonlyMap<string, NativeOverlayActionHandler>
  unsupportedReason: string | null
}

interface NativeMenuSerializedRow {
  item: NativeOverlayMenuItem
  action: NativeOverlayActionHandler
  extraActions?: ReadonlyMap<string, NativeOverlayActionHandler>
}

interface NativeMenuCompositeActions {
  actions: NativeOverlayMenuSubAction[]
  extraActions: ReadonlyMap<string, NativeOverlayActionHandler>
}

interface NativeMenuActionSpec {
  actions: ReadonlyMap<string, NativeOverlayActionHandler>
}

const invokeNativeMenuAction = (
  spec: NativeMenuActionSpec,
  actionId: string
): NativeOverlayActionResult => {
  const action = spec.actions.get(actionId)
  if (typeof action === 'function') {
    return action()
  }

  return action?.run()
}

const nativeMenuLiveAction = (
  specRef: MutableRefObject<NativeMenuActionSpec>,
  actionId: string
): NativeOverlayActionHandler => {
  const action = specRef.current.actions.get(actionId)

  if (typeof action === 'function') {
    return (): NativeOverlayActionResult =>
      invokeNativeMenuAction(specRef.current, actionId)
  }

  return {
    retainSession: true,
    run: (): NativeOverlayActionResult =>
      invokeNativeMenuAction(specRef.current, actionId),
  }
}

const nativeMenuSubActionFromRowAction = (
  nativeAction: MenuRowNativeOverlayAction,
  actionId: string
): NativeOverlayMenuSubAction => ({
  id: actionId,
  label: nativeAction.label,
  ...(nativeAction.icon === undefined ? {} : { icon: nativeAction.icon }),
  ...(nativeAction.pressed === undefined
    ? {}
    : { pressed: nativeAction.pressed }),
  ...(nativeAction.disabled === true ? { disabled: true } : {}),
})

const nativeMenuCompositeActionsFromRowActions = (
  nativeOverlayActions: readonly MenuRowNativeOverlayAction[],
  id: string,
  close: () => void
): NativeMenuCompositeActions => {
  const extraActions = new Map<string, () => NativeOverlayActionResult>()

  const actions = nativeOverlayActions.map((nativeAction, actionIndex) => {
    const actionId = `${id}:action:${String(actionIndex)}`
    extraActions.set(actionId, (): NativeOverlayActionResult => {
      if (nativeAction.disabled === true) {
        return
      }

      const result = nativeAction.onSelect()
      close()

      return result
    })

    return nativeMenuSubActionFromRowAction(nativeAction, actionId)
  })

  return { actions, extraActions }
}

const textFromSerializableNode = (node: ReactNode): string | null => {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return ''
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }

  if (Array.isArray(node)) {
    const parts = node.map(textFromSerializableNode)
    if (parts.some((part) => part === null)) {
      return null
    }

    return parts.filter((part) => part !== '').join(' ')
  }

  if (
    !isValidElement<{ children?: ReactNode; 'aria-hidden'?: boolean | 'true' }>(
      node
    )
  ) {
    return null
  }

  if (
    node.props['aria-hidden'] === true ||
    node.props['aria-hidden'] === 'true'
  ) {
    return ''
  }

  if (node.type === Fragment) {
    return textFromSerializableNode(node.props.children)
  }

  if (node.type !== 'span' && node.type !== 'kbd') {
    return null
  }

  return textFromSerializableNode(node.props.children)
}

const childTexts = (node: ReactNode): string[] | null => {
  const texts: string[] = []

  for (const child of Children.toArray(node)) {
    const text = textFromSerializableNode(child)
    if (text === null) {
      return null
    }

    if (text.trim().length > 0) {
      texts.push(text.trim())
    }
  }

  return texts
}

const nativeMenuRowFromElement = (
  element: ReactElement<MenuRowProps>,
  id: string,
  close: () => void
): NativeMenuSerializedRow | null => {
  const disabled = element.props.disabled === true
  const nativeOverlayActions = element.props.nativeOverlayActions
  if (nativeOverlayActions !== undefined && nativeOverlayActions.length > 0) {
    const { actions, extraActions } = nativeMenuCompositeActionsFromRowActions(
      nativeOverlayActions,
      id,
      close
    )

    return {
      item: {
        type: 'composite',
        id,
        label: element.props.label,
        ...(element.props.nativeOverlayIcon === undefined
          ? {}
          : { icon: element.props.nativeOverlayIcon }),
        ...(element.props.nativeOverlayActive === true ? { active: true } : {}),
        ...(disabled ? { disabled: true } : {}),
        actions,
      },
      action: (): NativeOverlayActionResult => {
        if (disabled) {
          return
        }

        const result = element.props.onSelect?.()
        close()

        return result
      },
      extraActions,
    }
  }

  if (element.props.nativeOverlayDetail !== undefined) {
    const closeOnSelect =
      element.props.nativeOverlayCloseOnSelect !== false &&
      element.props.nativeOverlayFeedback !== 'copy'

    const run = (): NativeOverlayActionResult => {
      if (!disabled) {
        const result = element.props.onSelect?.()
        if (closeOnSelect) {
          close()
        }

        return result
      }
    }

    return {
      item: {
        id,
        label: element.props.label,
        detail: element.props.nativeOverlayDetail,
        ...(element.props.nativeOverlayIcon === undefined
          ? {}
          : { icon: element.props.nativeOverlayIcon }),
        ...(element.props.nativeOverlayFeedback === undefined
          ? {}
          : { feedback: element.props.nativeOverlayFeedback }),
        ...(closeOnSelect ? {} : { closeOnSelect: false }),
        ...(disabled ? { disabled: true } : {}),
      },
      action: closeOnSelect ? run : { retainSession: true, run },
    }
  }

  const texts = childTexts(element.props.children)
  if (texts === null) {
    return null
  }

  const shortcut = [...texts]
    .reverse()
    .find((text) => text !== element.props.label)

  return {
    item: {
      id,
      label: element.props.label,
      ...(element.props.nativeOverlayIcon === undefined
        ? {}
        : { icon: element.props.nativeOverlayIcon }),
      ...(shortcut === undefined ? {} : { shortcut }),
      ...(disabled ? { disabled: true } : {}),
    },
    action: (): NativeOverlayActionResult => {
      if (!disabled) {
        const result = element.props.onSelect?.()
        close()

        return result
      }
    },
  }
}

const nativeMenuItemFromElement = (
  element: ReactElement<MenuItemProps>,
  id: string,
  close: () => void
): NativeMenuSerializedRow | null => {
  if (element.props.leadingIcon !== undefined) {
    return null
  }

  const label = textFromSerializableNode(element.props.children)
  if (label === null || label.trim().length === 0) {
    return null
  }

  const disabled = element.props.disabled === true

  return {
    item: {
      id,
      label: label.trim(),
      ...(element.props.icon === undefined ? {} : { icon: element.props.icon }),
      ...(element.props.shortcut === undefined
        ? {}
        : { shortcut: formatShortcut(element.props.shortcut) }),
      ...(disabled ? { disabled: true } : {}),
    },
    action: (): NativeOverlayActionResult => {
      if (disabled) {
        return
      }

      const result = element.props.onSelect()
      close()

      return result
    },
  }
}

const nativeMenuCheckboxFromElement = (
  element: ReactElement<MenuCheckboxProps>,
  id: string
): NativeMenuSerializedRow | null => {
  const label =
    element.props['aria-label'] ??
    textFromSerializableNode(element.props.children)
  if (label === null || label.trim().length === 0) {
    return null
  }

  const disabled = element.props.disabled === true

  return {
    item: {
      type: 'checkbox',
      id,
      label: label.trim(),
      ...(element.props.icon === undefined ? {} : { icon: element.props.icon }),
      checked: element.props.checked,
      ...(disabled ? { disabled: true } : {}),
    },
    action: {
      retainSession: true,
      run: (): void => {
        if (disabled) {
          return
        }

        element.props.onChange(!element.props.checked)
      },
    },
  }
}

const isSerializableSeparator = (element: ReactElement): boolean =>
  element.type === 'div'

const nativeMenuSectionFromElement = (
  surfaceId: string,
  element: ReactElement<MenuSectionProps>,
  sectionIndex: number,
  close: () => void
): {
  section: NativeOverlayMenuSection
  actions: ReadonlyMap<string, NativeOverlayActionHandler>
  unsupportedReason: string | null
} => {
  const items: NativeOverlayMenuItem[] = []
  const actions = new Map<string, NativeOverlayActionHandler>()

  for (const [itemIndex, child] of Children.toArray(
    element.props.children
  ).entries()) {
    if (!isValidElement(child)) {
      return {
        section: { label: element.props.label, items: [] },
        actions,
        unsupportedReason: 'non-element menu child',
      }
    }

    if (isSerializableSeparator(child)) {
      items.push({ type: 'separator' })

      continue
    }

    const id = `${surfaceId}:${String(sectionIndex)}:${String(itemIndex)}`

    const nativeRow =
      child.type === MenuItem
        ? nativeMenuItemFromElement(
            child as ReactElement<MenuItemProps>,
            id,
            close
          )
        : child.type === MenuCheckbox
          ? nativeMenuCheckboxFromElement(
              child as ReactElement<MenuCheckboxProps>,
              id
            )
          : child.type === MenuRow
            ? nativeMenuRowFromElement(
                child as ReactElement<MenuRowProps>,
                id,
                close
              )
            : null

    if (nativeRow === null) {
      return {
        section: { label: element.props.label, items: [] },
        actions,
        unsupportedReason: 'unsupported menu content',
      }
    }

    items.push(nativeRow.item)
    actions.set(id, nativeRow.action)
    nativeRow.extraActions?.forEach((action, actionId) => {
      actions.set(actionId, action)
    })
  }

  return {
    section: {
      ...(element.props.label === undefined
        ? {}
        : { label: element.props.label }),
      items,
    },
    actions,
    unsupportedReason: items.length === 0 ? 'empty menu section' : null,
  }
}

const nativeAnchoredMenuSpec = (
  surfaceId: string,
  ariaLabel: string | undefined,
  children: ReactNode,
  close: () => void
): NativeMenuContextSpec => {
  const sections: NativeOverlayMenuSection[] = []
  const actions = new Map<string, NativeOverlayActionHandler>()

  for (const [sectionIndex, child] of Children.toArray(children).entries()) {
    if (!isValidElement(child) || child.type !== MenuSection) {
      return {
        payload: { kind: NATIVE_OVERLAY_KINDS.menu, ariaLabel, sections: [] },
        actions,
        unsupportedReason: 'anchored native overlay menus require sections',
      }
    }

    const nativeSection = nativeMenuSectionFromElement(
      surfaceId,
      child as ReactElement<MenuSectionProps>,
      sectionIndex,
      close
    )

    if (nativeSection.unsupportedReason !== null) {
      return {
        payload: { kind: NATIVE_OVERLAY_KINDS.menu, ariaLabel, sections: [] },
        actions,
        unsupportedReason: nativeSection.unsupportedReason,
      }
    }

    sections.push(nativeSection.section)
    nativeSection.actions.forEach((action, id) => {
      actions.set(id, action)
    })
  }

  return {
    payload: { kind: NATIVE_OVERLAY_KINDS.menu, ariaLabel, sections },
    actions,
    unsupportedReason: sections.length === 0 ? 'empty menu' : null,
  }
}

const nativeMenuContextSpec = (
  surfaceId: string,
  ariaLabel: string,
  matchAnchorWidth: boolean,
  surfaceTone: NativeOverlayMenuSurfaceTone | undefined,
  children: ReactNode,
  close: () => void
): NativeMenuContextSpec => {
  const items: NativeOverlayMenuItem[] = []
  const actions = new Map<string, NativeOverlayActionHandler>()

  for (const [index, child] of Children.toArray(children).entries()) {
    if (!isValidElement(child)) {
      return {
        payload: {
          kind: NATIVE_OVERLAY_KINDS.menu,
          ariaLabel,
          ...(matchAnchorWidth ? { matchAnchorWidth: true } : {}),
          ...(surfaceTone === undefined ? {} : { surfaceTone }),
          items: [],
        },
        actions,
        unsupportedReason: 'non-element menu child',
      }
    }

    const id = `${surfaceId}:${String(index)}`

    const nativeRow =
      child.type === MenuRow
        ? nativeMenuRowFromElement(
            child as ReactElement<MenuRowProps>,
            id,
            close
          )
        : child.type === MenuCheckbox
          ? nativeMenuCheckboxFromElement(
              child as ReactElement<MenuCheckboxProps>,
              id
            )
          : child.type === MenuItem
            ? nativeMenuItemFromElement(
                child as ReactElement<MenuItemProps>,
                id,
                close
              )
            : null

    if (nativeRow === null) {
      return {
        payload: {
          kind: NATIVE_OVERLAY_KINDS.menu,
          ariaLabel,
          ...(matchAnchorWidth ? { matchAnchorWidth: true } : {}),
          ...(surfaceTone === undefined ? {} : { surfaceTone }),
          items: [],
        },
        actions,
        unsupportedReason: 'unsupported menu content',
      }
    }

    items.push(nativeRow.item)
    actions.set(id, nativeRow.action)
    nativeRow.extraActions?.forEach((action, actionId) => {
      actions.set(actionId, action)
    })
  }

  return {
    payload: {
      kind: NATIVE_OVERLAY_KINDS.menu,
      ariaLabel,
      ...(matchAnchorWidth ? { matchAnchorWidth: true } : {}),
      ...(surfaceTone === undefined ? {} : { surfaceTone }),
      items,
    },
    actions,
    unsupportedReason: items.length === 0 ? 'empty menu' : null,
  }
}

// Externally-controlled, cursor-anchored menu. Bakes the context-menu substrate
// config (offset 0, flip fallbacks, no autoUpdate / no ancestorScroll,
// openOnArrowKeyDown false, non-modal focus) so consumers pass only
// position/open/items. Covers TerminalContextMenu.
const MenuContextMenu = ({
  position,
  placement = 'bottom-start',
  matchAnchorWidth = false,
  open,
  onOpenChange,
  'aria-label': ariaLabel,
  nativeOverlay = false,
  surfaceTone = undefined,
  children,
}: MenuContextMenuProps): ReactElement | null => {
  const surfaceId = useId()
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  const [nativeAttempt, setNativeAttempt] = useState<
    'idle' | 'pending' | 'active' | 'failed'
  >('idle')
  const listRef = useRef<(HTMLElement | null)[]>([])
  const labelsRef = useRef<(string | null)[]>([])
  const closingRef = useRef(false)
  const nativeLifecycleActiveRef = useRef(false)

  const { disabledIndices, itemCount, setRowDisabled, clearRow } =
    useMenuDisabledIndices()

  const handleOpenChange = useCallback(
    (nextOpen: boolean): void => {
      if (!nextOpen) {
        if (closingRef.current) {
          return
        }

        closingRef.current = true
      } else {
        closingRef.current = false
      }

      if (!nextOpen) {
        setActiveIndex(null)
      }

      onOpenChange(nextOpen)
    },
    [onOpenChange]
  )
  const handleOpenChangeRef = useRef(handleOpenChange)
  handleOpenChangeRef.current = handleOpenChange

  const transport = selectFloatingTransport(nativeOverlay)

  const nativeSpec = nativeMenuContextSpec(
    surfaceId,
    ariaLabel,
    matchAnchorWidth,
    surfaceTone,
    children,
    () => handleOpenChangeRef.current(false)
  )
  const nativeSpecRef = useRef(nativeSpec)
  nativeSpecRef.current = nativeSpec
  const nativePayloadKey = JSON.stringify(nativeSpec.payload)

  const nativeActionsRef = useRef<{
    payloadKey: string
    actions: ReadonlyMap<string, NativeOverlayActionHandler>
  } | null>(null)
  if (nativeActionsRef.current?.payloadKey !== nativePayloadKey) {
    nativeActionsRef.current = {
      payloadKey: nativePayloadKey,
      actions: new Map(
        Array.from(nativeSpec.actions.keys(), (actionId) => [
          actionId,
          nativeMenuLiveAction(nativeSpecRef, actionId),
        ])
      ),
    }
  }

  const nativeActions = nativeActionsRef.current.actions
  const nativeUnsupportedReason = nativeSpec.unsupportedReason

  const canAttemptNative =
    open && transport === 'native-overlay' && nativeUnsupportedReason === null

  useEffect(() => {
    if (!open) {
      setNativeAttempt('idle')
      closingRef.current = false

      return
    }

    closingRef.current = false

    if (
      nativeOverlay &&
      transport === 'native-overlay' &&
      nativeUnsupportedReason !== null
    ) {
      warnNativeOverlayFallback(nativeUnsupportedReason)
    }
  }, [nativeOverlay, nativeUnsupportedReason, open, transport])

  useEffect(() => {
    if (!open) {
      return
    }

    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return
      }

      event.preventDefault()
      handleOpenChangeRef.current(false)
    }

    document.addEventListener('keydown', closeOnEscape, { capture: true })

    return (): void => {
      document.removeEventListener('keydown', closeOnEscape, { capture: true })
    }
  }, [open])

  useEffect(() => {
    if (!canAttemptNative) {
      nativeLifecycleActiveRef.current = false

      return
    }

    nativeLifecycleActiveRef.current = true

    return (): void => {
      nativeLifecycleActiveRef.current = false
      closeNativeOverlay(surfaceId)
    }
  }, [canAttemptNative, surfaceId])

  useEffect(() => {
    if (!canAttemptNative) {
      return
    }

    const cancelled = { current: false }
    setNativeAttempt('pending')

    void (async (): Promise<void> => {
      const accepted = await openNativeOverlay(
        {
          surfaceId,
          kind: NATIVE_OVERLAY_KINDS.menu,
          anchorRect: {
            x: position.x,
            y: position.y,
            width: position.width ?? 0,
            height: position.height ?? 0,
          },
          placement,
          payload: nativeSpecRef.current.payload,
          theme: nativeOverlayThemeSnapshot(),
        },
        {
          actions: nativeActions,
          onClose: (): void => handleOpenChangeRef.current(false),
        }
      )

      if (cancelled.current) {
        if (!nativeLifecycleActiveRef.current) {
          closeNativeOverlay(surfaceId)
        }

        return
      }

      setNativeAttempt(accepted ? 'active' : 'failed')
    })()

    return (): void => {
      cancelled.current = true
    }
  }, [
    canAttemptNative,
    nativeActions,
    nativePayloadKey,
    placement,
    position.x,
    position.y,
    position.width,
    position.height,
    surfaceId,
  ])

  const { refs, floatingStyles, context, getFloatingProps, getItemProps } =
    useFloatingSurface({
      open,
      onOpenChange: handleOpenChange,
      anchor: position,
      placement,
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

  if (canAttemptNative && nativeAttempt !== 'failed') {
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
      width={matchAnchorWidth ? position.width : undefined}
      ariaLabel={ariaLabel}
      focus={{ modal: false }}
      surfaceClassName={contextMenuSurfaceClasses(surfaceTone)}
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

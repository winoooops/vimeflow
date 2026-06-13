import {
  useEffect,
  useRef,
  type CSSProperties,
  type MutableRefObject,
} from 'react'
import {
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
  type ElementProps,
  type FloatingContext,
  type Placement,
  type UseFloatingReturn,
  type UseInteractionsReturn,
} from '@floating-ui/react'

interface FloatingSurfaceListOptions {
  ref: MutableRefObject<(HTMLElement | null)[]>
  activeIndex: number | null
  onNavigate: (index: number | null) => void
  loop?: boolean
  disabledIndices?: number[]
  focusItemOnOpen?: boolean
  openOnArrowKeyDown?: boolean
}

export interface FloatingSurfaceOptions {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Element OR virtual cursor point (context menus); null leaves the trigger ref to wire the anchor.
  anchor?: HTMLElement | { x: number; y: number } | null
  placement?: Placement
  offset?: number
  fallbackPlacements?: Placement[]
  role?: 'menu' | 'listbox' | 'dialog'
  middleware?: { autoUpdate?: boolean; ancestorScroll?: boolean }
  dismissWhen?: (event: MouseEvent) => boolean
  list?: FloatingSurfaceListOptions
}

export interface FloatingSurfaceApi {
  refs: UseFloatingReturn['refs']
  floatingStyles: CSSProperties
  context: FloatingContext
  getReferenceProps: UseInteractionsReturn['getReferenceProps']
  getFloatingProps: UseInteractionsReturn['getFloatingProps']
  getItemProps: UseInteractionsReturn['getItemProps']
}

const isVirtualPoint = (
  anchor: FloatingSurfaceOptions['anchor']
): anchor is { x: number; y: number } =>
  anchor !== null && anchor !== undefined && !(anchor instanceof HTMLElement)

// Builds a zero-size virtual reference rect at a cursor point (ported from
// TerminalContextMenu's getBoundingClientRect). Used for context menus.
const pointRect = (point: { x: number; y: number }): DOMRect => {
  const rect = {
    x: point.x,
    y: point.y,
    top: point.y,
    left: point.x,
    right: point.x,
    bottom: point.y,
    width: 0,
    height: 0,
  }

  return {
    ...rect,
    toJSON: (): typeof rect => rect,
  }
}

// The one floating-ui wiring every popover builds on: positioning + dismiss +
// role + optional list-nav. Ported and parameterized from the diff toolbar
// Dropdown and TerminalContextMenu. Only this file (with SurfacePanel) imports
// @floating-ui/react — features compose the public primitives above it.
export const useFloatingSurface = (
  opts: FloatingSurfaceOptions
): FloatingSurfaceApi => {
  const useAutoUpdate = opts.middleware?.autoUpdate !== false

  const element = opts.anchor instanceof HTMLElement ? opts.anchor : undefined

  const { refs, floatingStyles, context } = useFloating({
    open: opts.open,
    onOpenChange: opts.onOpenChange,
    placement: opts.placement ?? 'bottom-start',
    middleware: [
      offset(opts.offset ?? 4),
      flip({ fallbackPlacements: opts.fallbackPlacements }),
      shift({ padding: 8 }),
    ],
    elements: { reference: element },
    whileElementsMounted: useAutoUpdate ? autoUpdate : undefined,
  })

  // A {x,y} anchor becomes a virtual position reference; re-set when it moves.
  const point = isVirtualPoint(opts.anchor) ? opts.anchor : null
  const px = point?.x
  const py = point?.y
  useEffect(() => {
    if (px === undefined || py === undefined) {
      // Leaving virtual-point mode: clear the stale position reference so elements.reference (the trigger) regains precedence.
      refs.setPositionReference(null)

      return
    }

    refs.setPositionReference({
      getBoundingClientRect: (): DOMRect => pointRect({ x: px, y: py }),
    })
  }, [px, py, refs])

  const dismiss = useDismiss(context, {
    ancestorScroll: opts.middleware?.ancestorScroll !== false,
    outsidePress: opts.dismissWhen,
  })

  const role = useRole(context, { role: opts.role ?? 'menu' })

  // useListNavigation must run on every render (hooks rule); a noop list ref
  // keeps it inert when no list is configured, and it is only fed to
  // useInteractions when opts.list is present.
  const fallbackListRef = useRef<(HTMLElement | null)[]>([])

  const listNavigation = useListNavigation(context, {
    listRef: opts.list?.ref ?? fallbackListRef,
    activeIndex: opts.list?.activeIndex ?? null,
    onNavigate: opts.list?.onNavigate,
    loop: opts.list?.loop,
    disabledIndices: opts.list?.disabledIndices,
    focusItemOnOpen: opts.list?.focusItemOnOpen,
    openOnArrowKeyDown: opts.list?.openOnArrowKeyDown,
    enabled: opts.list !== undefined,
  })

  const interactions: ElementProps[] = [
    dismiss,
    role,
    ...(opts.list !== undefined ? [listNavigation] : []),
  ]

  const { getReferenceProps, getFloatingProps, getItemProps } =
    useInteractions(interactions)

  return {
    refs,
    floatingStyles,
    context,
    getReferenceProps,
    getFloatingProps,
    getItemProps,
  }
}

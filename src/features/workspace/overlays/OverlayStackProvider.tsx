import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'

export type OverlayPlane =
  | 'pane-chrome'
  | 'popover'
  | 'dialog'
  | 'palette'
  | 'drag'
  | 'toast'

export type NativeOcclusionPolicy = 'none' | 'intersects' | 'global'

interface BaseOverlayDescriptor {
  id: string
  plane: OverlayPlane
  isOpen: boolean
}

export type OverlayDescriptor =
  | (BaseOverlayDescriptor & {
      nativeOcclusion: 'none'
      getRect?: () => DOMRectReadOnly | null
    })
  | (BaseOverlayDescriptor & {
      nativeOcclusion: 'global'
      getRect?: () => DOMRectReadOnly | null
    })
  | (BaseOverlayDescriptor & {
      nativeOcclusion: 'intersects'
      getRect: () => DOMRectReadOnly | null
    })

export type NativeSurfaceOwner = 'browser-pane'

export interface NativeSurfaceDescriptor {
  id: string
  owner: NativeSurfaceOwner
  getRect: () => DOMRectReadOnly | null
  belowPlane: OverlayPlane
}

export interface NativeSurfaceState extends NativeSurfaceDescriptor {
  occluded: boolean
  occludingOverlayIds: readonly string[]
}

/**
 * Snapshot of the overlay stack and registered native surfaces.
 *
 * Note: live occlusion state is intentionally NOT pre-aggregated here.
 * `overlays` and `nativeSurfaces` only change when descriptors are registered
 * or unregistered; descriptor geometry is resolved lazily via stable `getRect`
 * callbacks. A pre-computed snapshot would therefore freeze occlusion at the
 * last registration moment and silently become stale when an open overlay or
 * native surface moves or resizes. Callers that need current occlusion must use
 * `getNativeSurfaceState(descriptor)` during render, which evaluates the live
 * rects.
 */
export interface OverlayStackSnapshot {
  overlays: readonly OverlayDescriptor[]
  nativeSurfaces: readonly NativeSurfaceDescriptor[]
}

interface OverlayStackContextValue extends OverlayStackSnapshot {
  registerOverlayDescriptor: (descriptor: OverlayDescriptor) => void
  unregisterOverlayDescriptor: (id: string) => void
  registerNativeSurfaceDescriptor: (descriptor: NativeSurfaceDescriptor) => void
  unregisterNativeSurfaceDescriptor: (id: string) => void
  /**
   * Returns the live occlusion state for a single native surface. This is the
   * only source of truth for current occlusion: it evaluates the latest
   * `getRect` callbacks, so it stays correct when geometry changes.
   */
  getNativeSurfaceState: (
    descriptor: NativeSurfaceDescriptor
  ) => NativeSurfaceState
}

export interface OverlayStackProviderProps {
  children: ReactNode
}

const overlayPlaneRanks: Record<OverlayPlane, number> = {
  'pane-chrome': 0,
  popover: 1,
  dialog: 2,
  palette: 3,
  drag: 4,
  toast: 5,
}

const OverlayStackContext = createContext<OverlayStackContextValue | null>(null)

const areOverlayDescriptorsEqual = (
  left: OverlayDescriptor,
  right: OverlayDescriptor
): boolean =>
  left.id === right.id &&
  left.plane === right.plane &&
  left.isOpen === right.isOpen &&
  left.nativeOcclusion === right.nativeOcclusion &&
  left.getRect === right.getRect

const areNativeSurfaceDescriptorsEqual = (
  left: NativeSurfaceDescriptor,
  right: NativeSurfaceDescriptor
): boolean =>
  left.id === right.id &&
  left.belowPlane === right.belowPlane &&
  left.getRect === right.getRect

export const isHigherOverlayPlane = (
  overlayPlane: OverlayPlane,
  belowPlane: OverlayPlane
): boolean => overlayPlaneRanks[overlayPlane] > overlayPlaneRanks[belowPlane]

export const rectsIntersect = (
  first: DOMRectReadOnly | null,
  second: DOMRectReadOnly | null
): boolean => {
  if (first === null || second === null) {
    return false
  }

  if (
    first.width <= 0 ||
    first.height <= 0 ||
    second.width <= 0 ||
    second.height <= 0
  ) {
    return false
  }

  return (
    first.left < second.right &&
    first.right > second.left &&
    first.top < second.bottom &&
    first.bottom > second.top
  )
}

const overlayOccludesNativeSurface = (
  overlay: OverlayDescriptor,
  surface: NativeSurfaceDescriptor
): boolean => {
  if (
    !overlay.isOpen ||
    overlay.nativeOcclusion === 'none' ||
    !isHigherOverlayPlane(overlay.plane, surface.belowPlane)
  ) {
    return false
  }

  if (overlay.nativeOcclusion === 'global') {
    return true
  }

  return rectsIntersect(overlay.getRect(), surface.getRect())
}

const nativeSurfaceStateFrom = (
  surface: NativeSurfaceDescriptor,
  overlays: readonly OverlayDescriptor[]
): NativeSurfaceState => {
  const occludingOverlayIds = overlays
    .filter((overlay) => overlayOccludesNativeSurface(overlay, surface))
    .map((overlay) => overlay.id)

  return {
    ...surface,
    occluded: occludingOverlayIds.length > 0,
    occludingOverlayIds,
  }
}

export const useOverlayStackContext = (): OverlayStackContextValue => {
  const context = useContext(OverlayStackContext)

  if (context === null) {
    throw new Error(
      'Overlay stack hooks must render inside OverlayStackProvider'
    )
  }

  return context
}

export const OverlayStackProvider = ({
  children,
}: OverlayStackProviderProps): ReactElement => {
  const [overlayDescriptors, setOverlayDescriptors] = useState<
    ReadonlyMap<string, OverlayDescriptor>
  >(new Map())

  const [nativeSurfaceDescriptors, setNativeSurfaceDescriptors] = useState<
    ReadonlyMap<string, NativeSurfaceDescriptor>
  >(new Map())

  const overlays = useMemo(
    () => Array.from(overlayDescriptors.values()),
    [overlayDescriptors]
  )

  const nativeSurfaces = useMemo(
    () => Array.from(nativeSurfaceDescriptors.values()),
    [nativeSurfaceDescriptors]
  )

  const registerOverlayDescriptor = useCallback(
    (descriptor: OverlayDescriptor): void => {
      setOverlayDescriptors((previous) => {
        const existing = previous.get(descriptor.id)

        if (
          existing !== undefined &&
          areOverlayDescriptorsEqual(existing, descriptor)
        ) {
          return previous
        }

        const next = new Map(previous)
        next.set(descriptor.id, descriptor)

        return next
      })
    },
    []
  )

  const unregisterOverlayDescriptor = useCallback((id: string): void => {
    setOverlayDescriptors((previous) => {
      if (!previous.has(id)) {
        return previous
      }

      const next = new Map(previous)
      next.delete(id)

      return next
    })
  }, [])

  const registerNativeSurfaceDescriptor = useCallback(
    (descriptor: NativeSurfaceDescriptor): void => {
      setNativeSurfaceDescriptors((previous) => {
        const existing = previous.get(descriptor.id)

        if (
          existing !== undefined &&
          areNativeSurfaceDescriptorsEqual(existing, descriptor)
        ) {
          return previous
        }

        const next = new Map(previous)
        next.set(descriptor.id, descriptor)

        return next
      })
    },
    []
  )

  const unregisterNativeSurfaceDescriptor = useCallback((id: string): void => {
    setNativeSurfaceDescriptors((previous) => {
      if (!previous.has(id)) {
        return previous
      }

      const next = new Map(previous)
      next.delete(id)

      return next
    })
  }, [])

  const getNativeSurfaceState = useCallback(
    (descriptor: NativeSurfaceDescriptor): NativeSurfaceState =>
      nativeSurfaceStateFrom(descriptor, overlays),
    [overlays]
  )

  const contextValue = useMemo(
    (): OverlayStackContextValue => ({
      overlays,
      nativeSurfaces,
      registerOverlayDescriptor,
      unregisterOverlayDescriptor,
      registerNativeSurfaceDescriptor,
      unregisterNativeSurfaceDescriptor,
      getNativeSurfaceState,
    }),
    [
      overlays,
      nativeSurfaces,
      registerOverlayDescriptor,
      unregisterOverlayDescriptor,
      registerNativeSurfaceDescriptor,
      unregisterNativeSurfaceDescriptor,
      getNativeSurfaceState,
    ]
  )

  return (
    <OverlayStackContext.Provider value={contextValue}>
      {children}
    </OverlayStackContext.Provider>
  )
}

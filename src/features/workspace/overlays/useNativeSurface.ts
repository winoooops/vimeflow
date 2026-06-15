import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import {
  type NativeSurfaceDescriptor,
  type NativeSurfaceState,
  useOverlayStackContext,
} from './OverlayStackProvider'

const areOcclusionStatesEqual = (
  left: NativeSurfaceState,
  right: NativeSurfaceState
): boolean =>
  left.id === right.id &&
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  left.owner === right.owner &&
  left.belowPlane === right.belowPlane &&
  left.getRect === right.getRect &&
  left.occluded === right.occluded &&
  left.occludingOverlayIds.length === right.occludingOverlayIds.length &&
  left.occludingOverlayIds.every(
    (value, index) => value === right.occludingOverlayIds[index]
  )

export const useNativeSurface = (
  descriptor: NativeSurfaceDescriptor
): NativeSurfaceState => {
  const {
    getNativeSurfaceState,
    overlays,
    registerNativeSurfaceDescriptor,
    unregisterNativeSurfaceDescriptor,
  } = useOverlayStackContext()
  const latestDescriptorRef = useRef(descriptor)
  latestDescriptorRef.current = descriptor

  const { id, owner, belowPlane } = descriptor
  const [, setLayoutRevision] = useState(0)

  const getRect = useCallback(
    (): DOMRectReadOnly | null => latestDescriptorRef.current.getRect(),
    []
  )

  useLayoutEffect(() => {
    registerNativeSurfaceDescriptor({
      id,
      owner,
      belowPlane,
      getRect,
    })

    return (): void => unregisterNativeSurfaceDescriptor(id)
  }, [
    id,
    owner,
    belowPlane,
    getRect,
    registerNativeSurfaceDescriptor,
    unregisterNativeSurfaceDescriptor,
  ])

  const nextState = getNativeSurfaceState({
    id,
    owner,
    belowPlane,
    getRect,
  })
  const stateRef = useRef(nextState)

  if (!areOcclusionStatesEqual(stateRef.current, nextState)) {
    stateRef.current = nextState
  }

  // Intersecting overlays can mount or move during the same commit that
  // re-rendered the native surface; re-check after layout so DOM rects are
  // committed before BrowserPane visibility decisions settle. This intentionally
  // runs after every commit because rect getter values can change even when
  // descriptor identity and overlay membership stay stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const hasOpenIntersectingOverlay = overlays.some(
      (overlay) => overlay.isOpen && overlay.nativeOcclusion === 'intersects'
    )

    if (!hasOpenIntersectingOverlay) {
      return
    }

    const committedState = getNativeSurfaceState({
      id,
      owner,
      belowPlane,
      getRect,
    })

    if (areOcclusionStatesEqual(stateRef.current, committedState)) {
      return
    }

    stateRef.current = committedState
    setLayoutRevision((revision) => revision + 1)
  })

  return stateRef.current
}

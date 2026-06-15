import { useCallback, useLayoutEffect, useRef } from 'react'
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
    registerNativeSurfaceDescriptor,
    unregisterNativeSurfaceDescriptor,
  } = useOverlayStackContext()
  const latestDescriptorRef = useRef(descriptor)
  latestDescriptorRef.current = descriptor

  const { id, owner, belowPlane } = descriptor

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

  return stateRef.current
}

import { useCallback, useLayoutEffect, useRef } from 'react'
import {
  type NativeSurfaceDescriptor,
  type NativeSurfaceState,
  useOverlayStackContext,
} from './OverlayStackProvider'

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

  return getNativeSurfaceState({
    id,
    owner,
    belowPlane,
    getRect,
  })
}

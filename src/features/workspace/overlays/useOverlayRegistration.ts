import { useLayoutEffect, useRef } from 'react'
import {
  type OverlayDescriptor,
  useOverlayStackContext,
} from './OverlayStackProvider'

export const useOverlayRegistration = (descriptor: OverlayDescriptor): void => {
  const { registerOverlayDescriptor, unregisterOverlayDescriptor } =
    useOverlayStackContext()
  const latestDescriptorRef = useRef(descriptor)
  latestDescriptorRef.current = descriptor

  const { id, plane, isOpen, nativeOcclusion } = descriptor

  useLayoutEffect(() => {
    registerOverlayDescriptor({
      id,
      plane,
      isOpen,
      nativeOcclusion,
      getRect: (): DOMRectReadOnly | null =>
        latestDescriptorRef.current.getRect?.() ?? null,
    })

    return (): void => unregisterOverlayDescriptor(id)
  }, [
    id,
    plane,
    isOpen,
    nativeOcclusion,
    registerOverlayDescriptor,
    unregisterOverlayDescriptor,
  ])
}

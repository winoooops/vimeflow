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

  const { id, plane, nativeOcclusion } = descriptor

  useLayoutEffect(() => {
    const getLatestRect = (): DOMRectReadOnly | null =>
      latestDescriptorRef.current.getRect?.() ?? null

    const overlayDescriptor: OverlayDescriptor = {
      id,
      plane,
      get isOpen(): boolean {
        return latestDescriptorRef.current.isOpen
      },
      nativeOcclusion,
      getRect: getLatestRect,
    }

    registerOverlayDescriptor(overlayDescriptor)

    return (): void => unregisterOverlayDescriptor(id)
  }, [
    id,
    plane,
    nativeOcclusion,
    registerOverlayDescriptor,
    unregisterOverlayDescriptor,
  ])
}

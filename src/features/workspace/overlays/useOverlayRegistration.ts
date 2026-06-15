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

  const { id, plane, nativeOcclusion, isOpen } = descriptor

  useLayoutEffect(() => {
    // `isOpen` is listed as a dep to force re-registration when the overlay
    // toggles, invalidating provider state so native-surface subscribers
    // re-render. The descriptor getter reads the live ref for the current value.
    void isOpen

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
    isOpen,
    registerOverlayDescriptor,
    unregisterOverlayDescriptor,
  ])
}

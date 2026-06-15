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

  const { id, plane } = descriptor

  useLayoutEffect(() => {
    const overlayDescriptor = {
      id,
      plane,
      get isOpen(): boolean {
        return latestDescriptorRef.current.isOpen
      },
      get nativeOcclusion() {
        return latestDescriptorRef.current.nativeOcclusion
      },
      getRect: (): DOMRectReadOnly | null =>
        latestDescriptorRef.current.getRect?.() ?? null,
    } as OverlayDescriptor

    registerOverlayDescriptor(overlayDescriptor)

    return (): void => unregisterOverlayDescriptor(id)
  }, [id, plane, registerOverlayDescriptor, unregisterOverlayDescriptor])
}

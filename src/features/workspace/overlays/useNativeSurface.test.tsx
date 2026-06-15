import { type ReactElement } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import {
  OverlayStackProvider,
  type NativeOcclusionPolicy,
} from './OverlayStackProvider'
import { useNativeSurface } from './useNativeSurface'
import { useOverlayRegistration } from './useOverlayRegistration'

const rect = (
  x: number,
  y: number,
  width: number,
  height: number
): DOMRectReadOnly => ({
  x,
  y,
  width,
  height,
  left: x,
  top: y,
  right: x + width,
  bottom: y + height,
  toJSON: (): Record<string, number> => ({
    x,
    y,
    width,
    height,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
  }),
})

interface OverlayProbeProps {
  nativeOcclusion: NativeOcclusionPolicy
  overlayRect: DOMRectReadOnly | null
}

const OverlayProbe = ({
  nativeOcclusion,
  overlayRect,
}: OverlayProbeProps): ReactElement | null => {
  useOverlayRegistration({
    id: 'overlay',
    plane: 'popover',
    isOpen: true,
    nativeOcclusion,
    getRect: () => overlayRect,
  })

  return null
}

interface NativeSurfaceStatusProps {
  surfaceRect: DOMRectReadOnly | null
}

const NativeSurfaceStatus = ({
  surfaceRect,
}: NativeSurfaceStatusProps): ReactElement => {
  const nativeSurface = useNativeSurface({
    id: 'surface',
    owner: 'browser-pane',
    belowPlane: 'pane-chrome',
    getRect: () => surfaceRect,
  })

  return (
    <div role="status" aria-label="Native surface occlusion">
      {nativeSurface.occluded
        ? nativeSurface.occludingOverlayIds.join(',')
        : 'clear'}
    </div>
  )
}

interface HarnessProps {
  nativeOcclusion: NativeOcclusionPolicy
  overlayRect: DOMRectReadOnly | null
  surfaceRect: DOMRectReadOnly | null
}

const Harness = ({
  nativeOcclusion,
  overlayRect,
  surfaceRect,
}: HarnessProps): ReactElement => (
  <OverlayStackProvider>
    <OverlayProbe nativeOcclusion={nativeOcclusion} overlayRect={overlayRect} />
    <NativeSurfaceStatus surfaceRect={surfaceRect} />
  </OverlayStackProvider>
)

const nativeSurfaceStatus = (): HTMLElement =>
  screen.getByRole('status', { name: /native surface occlusion/i })

describe('useNativeSurface', () => {
  test('occludes only when an intersects overlay overlaps the native surface', async () => {
    const { rerender } = render(
      <Harness
        nativeOcclusion="intersects"
        overlayRect={rect(120, 120, 40, 40)}
        surfaceRect={rect(0, 0, 100, 100)}
      />
    )

    await waitFor(() =>
      expect(nativeSurfaceStatus()).toHaveTextContent('clear')
    )

    rerender(
      <Harness
        nativeOcclusion="intersects"
        overlayRect={rect(80, 80, 40, 40)}
        surfaceRect={rect(0, 0, 100, 100)}
      />
    )

    await waitFor(() =>
      expect(nativeSurfaceStatus()).toHaveTextContent('overlay')
    )
  })

  test('global overlays occlude even when rectangles are unavailable', async () => {
    render(
      <Harness nativeOcclusion="global" overlayRect={null} surfaceRect={null} />
    )

    await waitFor(() =>
      expect(nativeSurfaceStatus()).toHaveTextContent('overlay')
    )
  })

  test('same-plane overlays do not occlude the native surface threshold', async () => {
    const SamePlaneOverlay = (): ReactElement | null => {
      useOverlayRegistration({
        id: 'pane-chrome',
        plane: 'pane-chrome',
        isOpen: true,
        nativeOcclusion: 'global',
      })

      return null
    }

    render(
      <OverlayStackProvider>
        <SamePlaneOverlay />
        <NativeSurfaceStatus surfaceRect={rect(0, 0, 100, 100)} />
      </OverlayStackProvider>
    )

    await waitFor(() =>
      expect(nativeSurfaceStatus()).toHaveTextContent('clear')
    )
  })
})

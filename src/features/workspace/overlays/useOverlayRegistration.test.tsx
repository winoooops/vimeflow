import { type ReactElement } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { OverlayStackProvider } from './OverlayStackProvider'
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

interface RegisteredOverlayProps {
  isOpen: boolean
  nativeOcclusion?: 'none' | 'global'
}

const RegisteredOverlay = ({
  isOpen,
  nativeOcclusion = 'global',
}: RegisteredOverlayProps): ReactElement | null => {
  useOverlayRegistration({
    id: 'overlay',
    plane: 'dialog',
    isOpen,
    nativeOcclusion,
  })

  return null
}

const NativeSurfaceStatus = (): ReactElement => {
  const nativeSurface = useNativeSurface({
    id: 'surface',
    owner: 'browser-pane',
    belowPlane: 'pane-chrome',
    getRect: () => rect(0, 0, 100, 100),
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
  isOpen?: boolean
  nativeOcclusion?: 'none' | 'global'
  hideOverlay?: boolean
}

const Harness = ({
  isOpen = false,
  nativeOcclusion = 'global',
  hideOverlay = false,
}: HarnessProps): ReactElement => (
  <OverlayStackProvider>
    {!hideOverlay ? (
      <RegisteredOverlay isOpen={isOpen} nativeOcclusion={nativeOcclusion} />
    ) : null}
    <NativeSurfaceStatus />
  </OverlayStackProvider>
)

const nativeSurfaceStatus = (): HTMLElement =>
  screen.getByRole('status', { name: /native surface occlusion/i })

describe('useOverlayRegistration', () => {
  test('updates native occlusion when an overlay opens and closes', async () => {
    const { rerender } = render(<Harness />)

    expect(nativeSurfaceStatus()).toHaveTextContent('clear')

    rerender(<Harness isOpen />)

    await waitFor(() =>
      expect(nativeSurfaceStatus()).toHaveTextContent('overlay')
    )

    rerender(<Harness />)

    await waitFor(() =>
      expect(nativeSurfaceStatus()).toHaveTextContent('clear')
    )
  })

  test('keeps native surfaces visible for non-occluding overlays', async () => {
    render(<Harness isOpen nativeOcclusion="none" />)

    await waitFor(() =>
      expect(nativeSurfaceStatus()).toHaveTextContent('clear')
    )
  })

  test('unregisters the overlay when the owner unmounts', async () => {
    const { rerender } = render(<Harness isOpen />)

    await waitFor(() =>
      expect(nativeSurfaceStatus()).toHaveTextContent('overlay')
    )

    rerender(<Harness isOpen hideOverlay />)

    await waitFor(() =>
      expect(nativeSurfaceStatus()).toHaveTextContent('clear')
    )
  })
})

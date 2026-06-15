import { useEffect, type ReactElement } from 'react'
import { render, waitFor } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import {
  isHigherOverlayPlane,
  OverlayStackProvider,
  rectsIntersect,
  useOverlayStackContext,
  type NativeSurfaceState,
  type OverlayStackSnapshot,
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

interface ProbeSnapshot extends OverlayStackSnapshot {
  nativeSurfaceState?: NativeSurfaceState
}

interface SnapshotProbeProps {
  onSnapshot: (snapshot: ProbeSnapshot) => void
}

const SnapshotProbe = ({
  onSnapshot,
}: SnapshotProbeProps): ReactElement | null => {
  const { overlays, nativeSurfaces, getNativeSurfaceState } =
    useOverlayStackContext()

  useEffect(() => {
    onSnapshot({
      overlays,
      nativeSurfaces,
      nativeSurfaceState: nativeSurfaces[0]
        ? getNativeSurfaceState(nativeSurfaces[0])
        : undefined,
    })
  }, [getNativeSurfaceState, nativeSurfaces, onSnapshot, overlays])

  return null
}

const OverlayProbe = (): ReactElement | null => {
  useOverlayRegistration({
    id: 'overlay',
    plane: 'dialog',
    isOpen: true,
    nativeOcclusion: 'global',
  })

  return null
}

const NativeSurfaceProbe = (): ReactElement | null => {
  useNativeSurface({
    id: 'surface',
    owner: 'browser-pane',
    belowPlane: 'pane-chrome',
    getRect: () => rect(0, 0, 100, 100),
  })

  return null
}

const latestSnapshotFrom = (
  snapshots: readonly ProbeSnapshot[]
): ProbeSnapshot | undefined => {
  if (snapshots.length === 0) {
    return undefined
  }

  return snapshots[snapshots.length - 1]
}

describe('OverlayStackProvider', () => {
  test('uses strict plane ordering', () => {
    expect(isHigherOverlayPlane('popover', 'pane-chrome')).toBe(true)
    expect(isHigherOverlayPlane('pane-chrome', 'pane-chrome')).toBe(false)
    expect(isHigherOverlayPlane('pane-chrome', 'popover')).toBe(false)
  })

  test('detects rectangle intersections', () => {
    expect(rectsIntersect(rect(0, 0, 20, 20), rect(10, 10, 20, 20))).toBe(true)
    expect(rectsIntersect(rect(0, 0, 20, 20), rect(20, 20, 20, 20))).toBe(false)
    expect(rectsIntersect(rect(0, 0, 0, 20), rect(0, 0, 20, 20))).toBe(false)
    expect(rectsIntersect(null, rect(0, 0, 20, 20))).toBe(false)
  })

  test('tracks registered descriptors and unregisters them on unmount', async () => {
    let snapshots: readonly ProbeSnapshot[] = []

    const onSnapshot = (snapshot: ProbeSnapshot): void => {
      snapshots = [...snapshots, snapshot]
    }

    const { rerender } = render(
      <OverlayStackProvider>
        <OverlayProbe />
        <NativeSurfaceProbe />
        <SnapshotProbe onSnapshot={onSnapshot} />
      </OverlayStackProvider>
    )

    await waitFor(() => {
      const snapshot = latestSnapshotFrom(snapshots)
      expect(snapshot?.overlays.map(({ id }) => id)).toEqual(['overlay'])
      expect(snapshot?.nativeSurfaces.map(({ id }) => id)).toEqual(['surface'])
      expect(snapshot?.nativeSurfaceState?.occluded).toBe(true)
    })

    rerender(
      <OverlayStackProvider>
        <SnapshotProbe onSnapshot={onSnapshot} />
      </OverlayStackProvider>
    )

    await waitFor(() => {
      const snapshot = latestSnapshotFrom(snapshots)
      expect(snapshot?.overlays).toEqual([])
      expect(snapshot?.nativeSurfaces).toEqual([])
      expect(snapshot?.nativeSurfaceState).toBeUndefined()
    })
  })

  test('keeps occluding overlay ids in deterministic order after re-registration', async () => {
    let snapshots: readonly ProbeSnapshot[] = []

    const onSnapshot = (snapshot: ProbeSnapshot): void => {
      snapshots = [...snapshots, snapshot]
    }

    interface OccludingOverlayProbeProps {
      id: string
      plane: 'dialog' | 'popover'
    }

    const OccludingOverlayProbe = ({
      id,
      plane,
    }: OccludingOverlayProbeProps): ReactElement | null => {
      useOverlayRegistration({
        id,
        plane,
        isOpen: true,
        nativeOcclusion: 'global',
      })

      return null
    }

    const { rerender } = render(
      <OverlayStackProvider>
        <OccludingOverlayProbe id="overlay-b" plane="dialog" />
        <OccludingOverlayProbe id="overlay-a" plane="dialog" />
        <NativeSurfaceProbe />
        <SnapshotProbe onSnapshot={onSnapshot} />
      </OverlayStackProvider>
    )

    await waitFor(() => {
      const snapshot = latestSnapshotFrom(snapshots)
      expect(snapshot?.nativeSurfaceState?.occludingOverlayIds).toEqual([
        'overlay-a',
        'overlay-b',
      ])
    })

    rerender(
      <OverlayStackProvider>
        <OccludingOverlayProbe id="overlay-b" plane="dialog" />
        <OccludingOverlayProbe id="overlay-a" plane="popover" />
        <NativeSurfaceProbe />
        <SnapshotProbe onSnapshot={onSnapshot} />
      </OverlayStackProvider>
    )

    await waitFor(() => {
      const snapshot = latestSnapshotFrom(snapshots)
      expect(snapshot?.nativeSurfaceState?.occludingOverlayIds).toEqual([
        'overlay-a',
        'overlay-b',
      ])
    })
  })
})

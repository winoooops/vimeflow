import { type ReactElement } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { OverlayStackProvider } from './OverlayStackProvider'
import { useNativeSurface } from './useNativeSurface'
import { WorkspaceOverlayRegistrations } from './WorkspaceOverlayRegistrations'

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

interface RectTargetProps {
  overlayId: string
  rectValue: DOMRectReadOnly
}

const RectTarget = ({
  overlayId,
  rectValue,
}: RectTargetProps): ReactElement => (
  <div
    data-workspace-overlay-id={overlayId}
    ref={(element): void => {
      if (element) {
        element.getBoundingClientRect = (): DOMRectReadOnly => rectValue
      }
    }}
  />
)

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
  commandPaletteOpen?: boolean
  unsavedChangesDialogOpen?: boolean
  newSessionDialogOpen?: boolean
  burnerTerminalOpen?: boolean
  paneRenameOpen?: boolean
  dragOverlayOpen?: boolean
  dockDragOverlayOpen?: boolean
  bannerOpen?: boolean
  paneRenameRect?: DOMRectReadOnly
  bannerRect?: DOMRectReadOnly
}

const Harness = ({
  commandPaletteOpen = false,
  unsavedChangesDialogOpen = false,
  newSessionDialogOpen = false,
  burnerTerminalOpen = false,
  paneRenameOpen = false,
  dragOverlayOpen = false,
  dockDragOverlayOpen = false,
  bannerOpen = false,
  paneRenameRect = rect(200, 0, 50, 50),
  bannerRect = rect(200, 0, 50, 50),
}: HarnessProps): ReactElement => (
  <OverlayStackProvider>
    <WorkspaceOverlayRegistrations
      commandPaletteOpen={commandPaletteOpen}
      unsavedChangesDialogOpen={unsavedChangesDialogOpen}
      newSessionDialogOpen={newSessionDialogOpen}
      burnerTerminalOpen={burnerTerminalOpen}
      paneRenameOpen={paneRenameOpen}
      dragOverlayOpen={dragOverlayOpen}
      dockDragOverlayOpen={dockDragOverlayOpen}
      bannerOpen={bannerOpen}
    />
    <RectTarget overlayId="pane-rename" rectValue={paneRenameRect} />
    <RectTarget overlayId="workspace-banners" rectValue={bannerRect} />
    <NativeSurfaceStatus />
  </OverlayStackProvider>
)

const nativeSurfaceStatus = (): HTMLElement =>
  screen.getByRole('status', { name: /native surface occlusion/i })

describe('WorkspaceOverlayRegistrations', () => {
  test('registers global workspace overlays that occlude native browser panes', async () => {
    const { rerender } = render(<Harness />)

    expect(nativeSurfaceStatus()).toHaveTextContent('clear')

    rerender(<Harness commandPaletteOpen />)

    await waitFor(() =>
      expect(nativeSurfaceStatus()).toHaveTextContent(/^command-palette$/u)
    )

    rerender(
      <Harness unsavedChangesDialogOpen burnerTerminalOpen dragOverlayOpen />
    )

    await waitFor(() => {
      expect(nativeSurfaceStatus()).toHaveTextContent(
        /^burner-terminal-popup,unsaved-changes-dialog,workspace-drag-overlay$/u
      )
    })

    rerender(<Harness />)

    await waitFor(() =>
      expect(nativeSurfaceStatus()).toHaveTextContent('clear')
    )
  })

  test('registers a separate dock-drag overlay that occludes native surfaces', async () => {
    const { rerender } = render(<Harness />)

    expect(nativeSurfaceStatus()).toHaveTextContent('clear')

    rerender(<Harness dockDragOverlayOpen />)

    await waitFor(() =>
      expect(nativeSurfaceStatus()).toHaveTextContent(/^dock-drag-overlay$/u)
    )

    rerender(<Harness />)

    await waitFor(() =>
      expect(nativeSurfaceStatus()).toHaveTextContent('clear')
    )
  })

  test('registers the new-session dialog overlay', async () => {
    const { rerender } = render(<Harness />)

    expect(nativeSurfaceStatus()).toHaveTextContent('clear')

    rerender(<Harness newSessionDialogOpen />)

    await waitFor(() =>
      expect(nativeSurfaceStatus()).toHaveTextContent(/^new-session-dialog$/u)
    )

    rerender(<Harness />)

    await waitFor(() =>
      expect(nativeSurfaceStatus()).toHaveTextContent('clear')
    )
  })

  test('registers intersecting pane rename and banner overlays', async () => {
    const { rerender } = render(
      <Harness
        paneRenameOpen
        bannerOpen
        paneRenameRect={rect(200, 0, 50, 50)}
        bannerRect={rect(20, 20, 60, 24)}
      />
    )

    await waitFor(() =>
      expect(nativeSurfaceStatus()).toHaveTextContent(/^workspace-banners$/u)
    )

    rerender(
      <Harness
        paneRenameOpen
        bannerOpen
        paneRenameRect={rect(10, 10, 40, 24)}
        bannerRect={rect(200, 0, 50, 50)}
      />
    )

    await waitFor(() =>
      expect(nativeSurfaceStatus()).toHaveTextContent(/^pane-rename$/u)
    )
  })
})

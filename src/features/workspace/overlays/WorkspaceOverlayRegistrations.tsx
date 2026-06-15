import type { ReactElement } from 'react'
import { useOverlayRegistration } from './useOverlayRegistration'

export interface WorkspaceOverlayRegistrationsProps {
  commandPaletteOpen: boolean
  unsavedChangesDialogOpen: boolean
  burnerTerminalOpen: boolean
  paneRenameOpen: boolean
  dragOverlayOpen: boolean
  bannerOpen: boolean
}

const rectForOverlayId = (overlayId: string): DOMRectReadOnly | null => {
  const element = document.querySelector<HTMLElement>(
    `[data-workspace-overlay-id="${overlayId}"]`
  )

  return element?.getBoundingClientRect() ?? null
}

const paneRenameRect = (): DOMRectReadOnly | null =>
  rectForOverlayId('pane-rename')

const bannerStackRect = (): DOMRectReadOnly | null =>
  rectForOverlayId('workspace-banners')

export const WorkspaceOverlayRegistrations = ({
  commandPaletteOpen,
  unsavedChangesDialogOpen,
  burnerTerminalOpen,
  paneRenameOpen,
  dragOverlayOpen,
  bannerOpen,
}: WorkspaceOverlayRegistrationsProps): ReactElement | null => {
  useOverlayRegistration({
    id: 'command-palette',
    plane: 'palette',
    isOpen: commandPaletteOpen,
    nativeOcclusion: 'global',
  })

  useOverlayRegistration({
    id: 'unsaved-changes-dialog',
    plane: 'dialog',
    isOpen: unsavedChangesDialogOpen,
    nativeOcclusion: 'global',
  })

  useOverlayRegistration({
    id: 'burner-terminal-popup',
    plane: 'dialog',
    isOpen: burnerTerminalOpen,
    nativeOcclusion: 'global',
  })

  useOverlayRegistration({
    id: 'workspace-drag-overlay',
    plane: 'drag',
    isOpen: dragOverlayOpen,
    nativeOcclusion: 'global',
  })

  useOverlayRegistration({
    id: 'pane-rename',
    plane: 'popover',
    isOpen: paneRenameOpen,
    nativeOcclusion: 'intersects',
    getRect: paneRenameRect,
  })

  useOverlayRegistration({
    id: 'workspace-banners',
    plane: 'toast',
    isOpen: bannerOpen,
    nativeOcclusion: 'intersects',
    getRect: bannerStackRect,
  })

  return null
}

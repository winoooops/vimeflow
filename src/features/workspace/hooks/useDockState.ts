import { useSyncExternalStore } from 'react'
import type { DockPosition } from '../components/DockSwitcher'
import type { DockTab } from '../utils/dockStore'
import {
  getDockState,
  setDockOpen,
  setDockPosition,
  setDockTab,
  subscribeDockState,
} from '../utils/dockStore'

export interface UseDockStateReturn {
  isDockOpen: boolean
  dockTab: DockTab
  dockPosition: DockPosition
  setDockOpen: (open: boolean) => void
  setDockTab: (tab: DockTab) => void
  setDockPosition: (position: DockPosition) => void
}

// Subscribes WorkspaceView to the workspace-global dock state. The store
// snapshot identity changes only on real changes, so re-renders stay scoped
// to actual dock mutations.
export const useDockState = (): UseDockStateReturn => {
  const state = useSyncExternalStore(
    subscribeDockState,
    getDockState,
    getDockState
  )

  return {
    isDockOpen: state.open,
    dockTab: state.tab,
    dockPosition: state.position,
    setDockOpen,
    setDockTab,
    setDockPosition,
  }
}

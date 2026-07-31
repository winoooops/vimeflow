import { useCallback, useSyncExternalStore } from 'react'
import {
  getActivityPanelCollapsed,
  setActivityPanelCollapsed,
  subscribeActivityPanelCollapsed,
} from '../utils/activityPanelCollapsedStore'

export interface UseActivityPanelCollapsedReturn {
  collapsed: boolean
  toggle: () => void
  setCollapsed: (collapsed: boolean) => void
}

// Subscribes any component to the workspace-global activity-panel collapse
// flag. Mirrors useSidebarCollapsed: the in-memory snapshot is seeded from
// localStorage at module load, so first paint and client agree.
export const useActivityPanelCollapsed =
  (): UseActivityPanelCollapsedReturn => {
    const collapsed = useSyncExternalStore(
      subscribeActivityPanelCollapsed,
      getActivityPanelCollapsed,
      getActivityPanelCollapsed
    )

    const toggle = useCallback((): void => {
      setActivityPanelCollapsed(!getActivityPanelCollapsed())
    }, [])

    return { collapsed, toggle, setCollapsed: setActivityPanelCollapsed }
  }

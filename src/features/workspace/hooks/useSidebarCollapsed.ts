import { useCallback, useSyncExternalStore } from 'react'
import {
  getSidebarCollapsed,
  setSidebarCollapsed,
  subscribeSidebarCollapsed,
} from '../utils/sidebarCollapsedStore'

export interface UseSidebarCollapsedReturn {
  collapsed: boolean
  toggle: () => void
  setCollapsed: (collapsed: boolean) => void
}

// Subscribes any component to the workspace-global sidebar-collapse flag.
// `getSidebarCollapsed` is passed for both the client and server snapshots —
// it returns the in-memory `current`, which is seeded from localStorage at
// module load, so SSR/first paint and client agree.
export const useSidebarCollapsed = (): UseSidebarCollapsedReturn => {
  const collapsed = useSyncExternalStore(
    subscribeSidebarCollapsed,
    getSidebarCollapsed,
    getSidebarCollapsed
  )

  const toggle = useCallback((): void => {
    setSidebarCollapsed(!getSidebarCollapsed())
  }, [])

  return { collapsed, toggle, setCollapsed: setSidebarCollapsed }
}

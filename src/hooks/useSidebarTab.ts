import { useState } from 'react'

export type SidebarTab = 'sessions' | 'files'

export const DEFAULT_SIDEBAR_TAB: SidebarTab = 'sessions'

export interface UseSidebarTabOptions {
  initial?: SidebarTab
}

export interface UseSidebarTabReturn {
  activeTab: SidebarTab
  setActiveTab: (tab: SidebarTab) => void
}

export const useSidebarTab = (
  options: UseSidebarTabOptions = {}
): UseSidebarTabReturn => {
  const [activeTab, setActiveTab] = useState<SidebarTab>(
    options.initial ?? DEFAULT_SIDEBAR_TAB
  )

  return { activeTab, setActiveTab }
}

// Design-sync bundle entry — the library surface of Vimeflow's shared
// primitives. The app itself has no package build; /design-sync bundles this
// file (see .design-sync/config.json `entry`). Add new shared primitives here
// AND to config.json `componentSrcMap` so they sync to claude.ai/design.
export { AgentGlyph } from '../src/components/AgentGlyph'
export { Button } from '../src/components/Button'
export { Chip } from '../src/components/Chip'
export { Dialog } from '../src/components/Dialog'
export { Dropdown } from '../src/components/Dropdown'
export { GlassSurface } from '../src/components/GlassSurface'
export { IconButton } from '../src/components/IconButton'
export { Menu } from '../src/components/Menu'
export { Popover } from '../src/components/Popover'
export { ProgressBar } from '../src/components/ProgressBar'
export { ResizeHandle } from '../src/components/ResizeHandle'
export { SegmentedControl } from '../src/components/SegmentedControl'
export { StatusBar } from '../src/components/StatusBar'
export { Toggle } from '../src/components/Toggle'
export { ToolbarButton } from '../src/components/ToolbarButton'
export { Tooltip } from '../src/components/Tooltip'
export { Sidebar } from '../src/components/sidebar/Sidebar'
export { SidebarTabs } from '../src/components/sidebar/SidebarTabs'

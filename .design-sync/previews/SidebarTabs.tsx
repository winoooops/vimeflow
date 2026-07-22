import { SidebarTabs } from 'vibm'

// SidebarTabs is the sidebar's 202px segmented view switcher (SegmentedControl
// variant="sidebar"): inset track on the lowest surface, sliding thumb, mono
// uppercase labels with Material Symbols icons. Data mirrors
// WorkspaceView's buildSidebarTabItems.
const surface = {
  background: 'var(--color-surface)',
  color: 'var(--color-on-surface)',
  padding: 24,
  borderRadius: 12,
  display: 'flex',
  flexWrap: 'wrap' as const,
  alignItems: 'center',
  gap: 16,
}

// The strip the control actually sits on in the app (sidebar surface).
const sidebarStrip = {
  background: 'var(--color-surface-container-low)',
  borderRadius: 10,
  padding: 12,
}

const noop = () => {}

const APP_TABS = [
  {
    id: 'sessions',
    label: 'SESSIONS',
    icon: 'view_agenda',
    tooltip: 'Sessions',
  },
  { id: 'files', label: 'FILES', icon: 'folder_open', tooltip: 'Files' },
] as const

export const SessionsActive = () => (
  <div style={surface}>
    <div style={sidebarStrip}>
      <SidebarTabs tabs={APP_TABS} activeId="sessions" onChange={noop} />
    </div>
  </div>
)

export const FilesActive = () => (
  <div style={surface}>
    <div style={sidebarStrip}>
      <SidebarTabs tabs={APP_TABS} activeId="files" onChange={noop} />
    </div>
  </div>
)

// The control generalizes past the app's two views: three segments share the
// same fixed 202px track.
export const ThreeSegments = () => (
  <div style={surface}>
    <div style={sidebarStrip}>
      <SidebarTabs
        tabs={[
          { id: 'sessions', label: 'SESS', icon: 'view_agenda' },
          { id: 'files', label: 'FILES', icon: 'folder_open' },
          { id: 'diff', label: 'DIFF', icon: 'difference' },
        ]}
        activeId="diff"
        onChange={noop}
      />
    </div>
  </div>
)

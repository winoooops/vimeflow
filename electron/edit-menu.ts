// cspell:ignore togglefullscreen
import { Menu, type MenuItemConstructorOptions } from 'electron'

// The workspace is an app shell, not a web page to be browsed, so it ships a
// trimmed View menu instead of the default `viewMenu` role. That role adds
// Reload (Cmd+R) and Force Reload (Cmd+Shift+R) — which collide with in-app
// keyboard shortcuts — plus Zoom In/Out (Cmd+±). The page-zoom items are how a
// stray Cmd+- persisted the <100% page zoom that drifted the sidebar toggle
// onto the macOS traffic lights (VIM-306). Drop all of them; keep the harmless,
// non-colliding actions (DevTools, Fullscreen).
const workspaceViewMenu: MenuItemConstructorOptions = {
  label: 'View',
  submenu: [
    { role: 'toggleDevTools' },
    { type: 'separator' },
    { role: 'togglefullscreen' },
  ],
}

export const createApplicationMenuTemplate = (
  platform = process.platform
): MenuItemConstructorOptions[] => {
  if (platform !== 'darwin') {
    return []
  }

  return [
    { role: 'appMenu' },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    workspaceViewMenu,
    { role: 'windowMenu' },
    { role: 'help' },
  ]
}

export const installApplicationEditMenu = (
  platform = process.platform
): void => {
  const template = createApplicationMenuTemplate(platform)
  if (template.length === 0) {
    return
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
